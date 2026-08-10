/**
 * What this suite proves: the deposit route's HTTP contract, through the
 * application as main.ts really configures it, against a REAL Postgres started
 * by test/global-setup.ts.
 *
 * StorageService is a double here, as in every e2e suite: no route needs a real
 * bucket to answer, and the commands it sends are covered against a real MinIO
 * by test/storage.int-spec.ts. What only this suite can see is the chain
 * multer -> guard -> validation -> service, and the codes it answers.
 */

import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { hashSecret } from './../src/crypto/secrets';
import { PrismaService } from './../src/prisma/prisma.service';
import { StorageService } from './../src/storage/storage.service';
import { ApiClient } from './api-client';
import { insertLawyer, resetDatabase } from './database';

const PASSWORD = 'un-mot-de-passe-de-test';

const REQUEST_BODY = {
  title: 'Dossier Martin, pieces 2026',
  items: ["Piece d'identite", 'Contrat de bail signe'],
  expiresInDays: 14,
};

/** A minimal payload whose first bytes really are a PDF signature. */
const pdf = (): Buffer => Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n');

interface CreatedRequest {
  id: string;
  link: { url: string; pin: string };
}

interface ClientView {
  requestId: string;
  items: { id: string; label: string; received: boolean }[];
}

interface DepositedFile {
  itemId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  receivedAt: string;
}

const tokenOf = (created: CreatedRequest): string =>
  created.link.url.split('/').at(-1) ?? '';

describe('Deposit of a file (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let storage: { putObject: jest.Mock; deleteObject: jest.Mock };
  let lawyerApi: ApiClient;
  let client: ApiClient;

  const lawyer = {
    name: 'Maitre Dupont',
    email: 'avocat@exemple.fr',
    passwordHash: '',
  };

  const createRequest = async (): Promise<CreatedRequest> => {
    const response = await lawyerApi
      .post('/requests')
      .send(REQUEST_BODY)
      .expect(201);
    return response.body as CreatedRequest;
  };

  /** Creates a request, unlocks it, and hands back the client's checklist. */
  const openSession = async (
    api: ApiClient = client,
  ): Promise<{ created: CreatedRequest; view: ClientView }> => {
    const created = await createRequest();
    const unlocked = await api
      .post(`/public/${tokenOf(created)}/unlock`)
      .send({ pin: created.link.pin })
      .expect(200);
    return { created, view: unlocked.body as ClientView };
  };

  beforeAll(async () => {
    lawyer.passwordHash = await hashSecret(PASSWORD);
  });

  beforeEach(async () => {
    storage = {
      putObject: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue({
        ...storage,
        ping: jest.fn().mockResolvedValue(true),
        assertBucketExists: jest.fn(),
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
      })
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      logger: false,
    });
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    await insertLawyer(prisma, lawyer);

    lawyerApi = new ApiClient(app);
    await lawyerApi.login(lawyer.email, PASSWORD).expect(200);
    client = new ApiClient(app);
  });

  afterEach(async () => {
    await app.close();
  });

  it('refuses a caller carrying no client session, before reading any byte', async () => {
    // The guard runs before the interceptor, which is what keeps an anonymous
    // caller from making the API buffer twenty megabytes.
    const response = await client
      .post('/public/files')
      .field('itemId', '11111111-1111-4111-8111-111111111111')
      .attach('file', pdf(), 'contrat.pdf')
      .expect(401);

    expect(response.body).toMatchObject({ message: 'Lien ou code invalide.' });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('accepts a PDF and answers the receipt', async () => {
    const { view } = await openSession();
    const itemId = view.items[0].id;

    const response = await client
      .post('/public/files')
      .field('itemId', itemId)
      .attach('file', pdf(), 'contrat.pdf')
      .expect(201);

    expect(response.body as DepositedFile).toEqual({
      itemId,
      originalName: 'contrat.pdf',
      mimeType: 'application/pdf',
      sizeBytes: pdf().length,
      receivedAt: expect.any(String) as string,
    });
  });

  it('ticks the piece on the client checklist and on the lawyer detail', async () => {
    const { created, view } = await openSession();

    await client
      .post('/public/files')
      .field('itemId', view.items[0].id)
      .attach('file', pdf(), 'contrat.pdf')
      .expect(201);

    const session = await client.get('/public/session').expect(200);
    expect((session.body as ClientView).items.map((item) => item.received)) //
      .toEqual([true, false]);

    const detail = await lawyerApi.get(`/requests/${created.id}`).expect(200);
    expect(detail.body).toMatchObject({
      status: 'pending',
      expectedCount: 2,
      receivedCount: 1,
    });
  });

  it('turns the request complete once every piece is in', async () => {
    const { created, view } = await openSession();

    for (const item of view.items) {
      await client
        .post('/public/files')
        .field('itemId', item.id)
        .attach('file', pdf(), 'piece.pdf')
        .expect(201);
    }

    const detail = await lawyerApi.get(`/requests/${created.id}`).expect(200);
    expect(detail.body).toMatchObject({ status: 'complete', receivedCount: 2 });
  });

  // C2's decision on the question B4 left open. Written through HTTP because
  // that is where it would be noticed: the lawyer reads "complete" and goes
  // looking for a piece the portal never accepted.
  it('does not count a failed file as received', async () => {
    const { created, view } = await openSession();

    for (const item of view.items) {
      await client
        .post('/public/files')
        .field('itemId', item.id)
        .attach('file', pdf(), 'piece.pdf')
        .expect(201);
    }
    await prisma.uploadedFile.updateMany({
      where: { requestedItemId: view.items[0].id },
      data: { status: 'failed' },
    });

    const detail = await lawyerApi.get(`/requests/${created.id}`).expect(200);
    expect(detail.body).toMatchObject({
      status: 'pending',
      receivedCount: 1,
    });

    const session = await client.get('/public/session').expect(200);
    expect((session.body as ClientView).items[0].received).toBe(false);
  });

  it('refuses an executable renamed .pdf with 415', async () => {
    const { view } = await openSession();

    const response = await client
      .post('/public/files')
      .field('itemId', view.items[0].id)
      // MZ, a Windows PE header, announced as a PDF. Trusting the declared
      // type or the extension would store it and hand it to the lawyer.
      .attach('file', Buffer.from([0x4d, 0x5a, 0x90, 0x00]), {
        filename: 'contrat.pdf',
        contentType: 'application/pdf',
      })
      .expect(415);

    expect(response.body).toMatchObject({
      message: 'Format refusé. PDF, JPG ou PNG uniquement.',
    });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('refuses a file over twenty megabytes with 413 and a French message', async () => {
    const { view } = await openSession();
    // Just past the 20 MiB limit, so multer aborts the request rather than
    // buffering it whole.
    const oversized = Buffer.concat([pdf(), Buffer.alloc(21 * 1024 * 1024)]);

    const response = await client
      .post('/public/files')
      .field('itemId', view.items[0].id)
      .attach('file', oversized, 'gros.pdf');

    // Not .expect(413): the server aborts the upload, and supertest can see the
    // socket close before the response on some kernels.
    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({
      message: 'Fichier trop volumineux (20 Mo maximum).',
    });
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('refuses a piece belonging to another request with 404', async () => {
    // The session is opened on the first request; the piece named belongs to
    // the second. A 403 would confirm that the piece exists, which is enough to
    // enumerate another client's file.
    const other = await createRequest();
    const otherItem = await prisma.requestedItem.findFirstOrThrow({
      where: { requestId: other.id },
    });
    const { view } = await openSession();
    expect(view.items.map((item) => item.id)).not.toContain(otherItem.id);

    await client
      .post('/public/files')
      .field('itemId', otherItem.id)
      .attach('file', pdf(), 'contrat.pdf')
      .expect(404);

    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('refuses a body with no file part', async () => {
    const { view } = await openSession();

    await client
      .post('/public/files')
      .field('itemId', view.items[0].id)
      .expect(400);
  });

  it('refuses an itemId that is not an identifier', async () => {
    await openSession();

    await client
      .post('/public/files')
      .field('itemId', 'pas-un-uuid')
      .attach('file', pdf(), 'contrat.pdf')
      .expect(400);
  });

  it('replaces on a second deposit: one row, and the old object erased', async () => {
    const { view } = await openSession();
    const itemId = view.items[0].id;

    await client
      .post('/public/files')
      .field('itemId', itemId)
      .attach('file', pdf(), 'premier.pdf')
      .expect(201);
    const first = await prisma.uploadedFile.findUniqueOrThrow({
      where: { requestedItemId: itemId },
    });

    await client
      .post('/public/files')
      .field('itemId', itemId)
      .attach('file', pdf(), 'second.pdf')
      .expect(201);

    const rows = await prisma.uploadedFile.findMany({
      where: { requestedItemId: itemId },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].originalName).toBe('second.pdf');
    expect(rows[0].storageKey).not.toBe(first.storageKey);
    // Without this the first file stays in the bucket forever: the row that
    // carried its key has just been overwritten.
    expect(storage.deleteObject).toHaveBeenCalledWith(first.storageKey);
  });

  it('dies with the link: a revoked session can no longer deposit', async () => {
    const { created, view } = await openSession();

    await lawyerApi.delete(`/requests/${created.id}/link`).expect(204);

    await client
      .post('/public/files')
      .field('itemId', view.items[0].id)
      .attach('file', pdf(), 'contrat.pdf')
      .expect(401);
  });

  it('never exposes the storage key', async () => {
    // It names an object the client must never address directly, and it is one
    // spread away from the response.
    const { view } = await openSession();

    const response = await client
      .post('/public/files')
      .field('itemId', view.items[0].id)
      .attach('file', pdf(), 'contrat.pdf')
      .expect(201);

    const stored = await prisma.uploadedFile.findUniqueOrThrow({
      where: { requestedItemId: view.items[0].id },
    });
    expect(JSON.stringify(response.body)).not.toContain(stored.storageKey);
  });
});
