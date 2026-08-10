/**
 * What this suite proves: the HTTP contract of the lawyer's download route, and
 * above all the three ways it must refuse -- another practice's request, an
 * anonymous caller, and a file the portal itself rejected. It runs against a
 * REAL Postgres, because the ownership filter is a statement about rows.
 *
 * StorageService is a double here on purpose: this suite is about who may read
 * the bytes and how they are named, not about MinIO answering. That the
 * commands work under the restricted policy is storage.int-spec.ts.
 *
 * The UploadedFile rows are inserted directly rather than deposited over HTTP:
 * a real multipart deposit would drag the anonymous client session into every
 * fixture of a suite that is entirely about the lawyer's side.
 */

import { Readable } from 'node:stream';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { hashSecret } from './../src/crypto/secrets';
import { UploadStatus } from './../src/generated/prisma/client';
import { PrismaService } from './../src/prisma/prisma.service';
import { StorageService } from './../src/storage/storage.service';
import { ApiClient } from './api-client';
import { insertLawyer, resetDatabase } from './database';

const PASSWORD = 'un-mot-de-passe-de-test';

const BYTES = Buffer.from('%PDF-1.7\nle contenu du bail');

const VALID_BODY = {
  title: 'Dossier Martin, pieces 2026',
  items: ["Piece d'identite", 'Contrat de bail signe'],
  expiresInDays: 14,
};

interface CreatedRequest {
  id: string;
  items: { id: string; label: string }[];
}

describe('Download a deposited piece (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let api: ApiClient;
  let anonymous: ApiClient;
  let getObjectStream: jest.Mock;

  const lawyer = {
    name: 'Maitre Dupont',
    email: 'avocat@exemple.fr',
    passwordHash: '',
  };

  const createRequest = async (): Promise<CreatedRequest> => {
    const response = await api.post('/requests').send(VALID_BODY).expect(201);
    return response.body as CreatedRequest;
  };

  const attachFile = (
    requestedItemId: string,
    overrides: { originalName?: string; status?: UploadStatus } = {},
  ) =>
    prisma.uploadedFile.create({
      data: {
        originalName: 'bail.pdf',
        mimeType: 'application/pdf',
        sizeBytes: BYTES.length,
        status: 'complete',
        requestedItemId,
        storageKey: `requests/test/items/${requestedItemId}/bail.pdf`,
        ...overrides,
      },
    });

  const filePath = (requestId: string, itemId: string): string =>
    `/requests/${requestId}/items/${itemId}/file`;

  beforeAll(async () => {
    lawyer.passwordHash = await hashSecret(PASSWORD);
  });

  beforeEach(async () => {
    // A fresh Readable per call: a stream is consumed once, so a shared one
    // would make the second test of a run read an already-drained body.
    getObjectStream = jest
      .fn()
      .mockImplementation(() => Promise.resolve(Readable.from([BYTES])));

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue({
        getObjectStream,
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

    anonymous = new ApiClient(app);
    api = new ApiClient(app);
    await api.login(lawyer.email, PASSWORD).expect(200);
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves the bytes with the type they were stored under', async () => {
    const created = await createRequest();
    await attachFile(created.items[0].id);

    const response = await api
      .get(filePath(created.id, created.items[0].id))
      .expect(200);

    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.body as Buffer).toEqual(BYTES);
    // The key comes from the row, never from the request path.
    expect(getObjectStream).toHaveBeenCalledWith(
      `requests/test/items/${created.items[0].id}/bail.pdf`,
    );
  });

  it('names the file as an attachment', async () => {
    const created = await createRequest();
    await attachFile(created.items[0].id);

    const response = await api
      .get(filePath(created.id, created.items[0].id))
      .expect(200);

    expect(response.headers['content-disposition']).toBe(
      "attachment; filename*=UTF-8''bail.pdf",
    );
  });

  /**
   * originalName comes from the client. A quote closes the quoted form and a
   * newline closes the header itself: unencoded, the second one lets the client
   * append a header of their choosing to a response the lawyer's browser
   * trusts. Node also refuses to send a header containing a newline, so the
   * unencoded version would turn every download of that file into a 500.
   */
  it('does not let a crafted file name break the header out', async () => {
    const created = await createRequest();
    await attachFile(created.items[0].id, {
      originalName: 'bail".pdf\nX-Injected: yes',
    });

    const response = await api
      .get(filePath(created.id, created.items[0].id))
      .expect(200);

    expect(response.headers['x-injected']).toBeUndefined();
    expect(response.headers['content-disposition']).toBe(
      "attachment; filename*=UTF-8''bail%22.pdf%0AX-Injected%3A%20yes",
    );
  });

  /**
   * The scenario C4 will create: a file the antivirus refused. Served anyway,
   * the portal hands the lawyer exactly the file it had just rejected.
   */
  it('answers 404 for a file whose status is failed', async () => {
    const created = await createRequest();
    await attachFile(created.items[0].id, { status: 'failed' });

    await api.get(filePath(created.id, created.items[0].id)).expect(404);
    expect(getObjectStream).not.toHaveBeenCalled();
  });

  it('answers 404 for a piece nothing has been deposited against', async () => {
    const created = await createRequest();

    await api.get(filePath(created.id, created.items[1].id)).expect(404);
    expect(getObjectStream).not.toHaveBeenCalled();
  });

  /**
   * 404 and never 403: a 403 would confirm that the id exists in another
   * practice, which is enough to enumerate a colleague's caseload.
   */
  it('answers 404, not 403, on another practice piece', async () => {
    const other = await insertLawyer(prisma, {
      name: 'Maitre Autre',
      email: 'autre@exemple.fr',
      passwordHash: 'peu-importe',
    });
    const hidden = await prisma.depositRequest.create({
      data: {
        title: 'Dossier confidentiel',
        lawyerId: other.id,
        items: { create: { label: 'Bail', position: 0 } },
      },
      include: { items: true },
    });
    await attachFile(hidden.items[0].id);

    await api.get(filePath(hidden.id, hidden.items[0].id)).expect(404);
    expect(getObjectStream).not.toHaveBeenCalled();
  });

  /**
   * The piece is the caller's, the request id in the path is not. Without both
   * criteria in one query the ownership check would pass on the request while
   * the piece came from elsewhere.
   */
  it('answers 404 when the piece does not belong to the request in the path', async () => {
    const first = await createRequest();
    const second = await createRequest();
    await attachFile(second.items[0].id);

    await api.get(filePath(first.id, second.items[0].id)).expect(404);
    expect(getObjectStream).not.toHaveBeenCalled();
  });

  // The controller carries no @UseGuards: this proves the GLOBAL guard covers
  // the download route too.
  it('refuses an anonymous caller', async () => {
    const created = await createRequest();
    await attachFile(created.items[0].id);

    await anonymous.get(filePath(created.id, created.items[0].id)).expect(401);
    expect(getObjectStream).not.toHaveBeenCalled();
  });
});
