/**
 * What this suite proves: the HTTP contract of the two dashboard routes, over a
 * REAL Postgres. The counters, the ordering and the ownership filter are all
 * statements about rows, which a Prisma double cannot make.
 *
 * The UploadedFile rows are inserted directly: C2 does not exist yet, so there
 * is no HTTP path that deposits a file. That is the one place where this suite
 * writes without going through the API, and it is deliberate.
 *
 * What it still does NOT prove: that the dashboard works through nginx and the
 * frontend.
 */

import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { hashSecret } from './../src/crypto/secrets';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from './../src/requests/dto/list-requests.dto';
import { StorageService } from './../src/storage/storage.service';
import { ApiClient } from './api-client';
import { insertLawyer, resetDatabase } from './database';

const PASSWORD = 'un-mot-de-passe-de-test';

const VALID_BODY = {
  title: 'Dossier Martin, pieces 2026',
  items: ["Piece d'identite", 'Contrat de bail signe'],
  expiresInDays: 14,
};

const FILE = {
  originalName: 'bail.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 184320,
};

interface CreatedRequest {
  id: string;
  items: { id: string; label: string }[];
}

interface SummaryBody {
  id: string;
  title: string;
  status: string;
  expectedCount: number;
  receivedCount: number;
  link: { state: string; expiresAt: string };
}

interface PageBody {
  items: SummaryBody[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface DetailBody extends SummaryBody {
  items: {
    id: string;
    label: string;
    received: boolean;
    file: typeof FILE | null;
  }[];
}

describe('Dashboard (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let api: ApiClient;
  let anonymous: ApiClient;

  const lawyer = {
    name: 'Maitre Dupont',
    email: 'avocat@exemple.fr',
    passwordHash: '',
  };

  const createRequest = async (title: string): Promise<CreatedRequest> => {
    const response = await api
      .post('/requests')
      .send({ ...VALID_BODY, title })
      .expect(201);
    return response.body as CreatedRequest;
  };

  // C2 does not exist yet, so there is no HTTP way to deposit. Writing the row
  // directly is what lets the counters and the timestamps be exercised at all.
  const attachFile = (requestedItemId: string) =>
    prisma.uploadedFile.create({
      data: {
        ...FILE,
        requestedItemId,
        storageKey: `requests/test/items/${requestedItemId}/bail.pdf`,
      },
    });

  const otherLawyerRequest = async (title: string): Promise<string> => {
    const other = await insertLawyer(prisma, {
      name: 'Maitre Autre',
      email: 'autre@exemple.fr',
      passwordHash: 'peu-importe',
    });
    const hidden = await prisma.depositRequest.create({
      data: { title, lawyerId: other.id },
    });
    return hidden.id;
  };

  const listPage = async (query = ''): Promise<PageBody> => {
    const response = await api.get(`/requests${query}`).expect(200);
    return response.body as PageBody;
  };

  beforeAll(async () => {
    lawyer.passwordHash = await hashSecret(PASSWORD);
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue({
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

  // The controller carries no @UseGuards: this is what proves the GLOBAL guard
  // covers the two read routes too.
  it('refuses an anonymous caller on the list', () =>
    anonymous.get('/requests').expect(401));

  it('refuses an anonymous caller on the detail', () =>
    anonymous.get('/requests/peu-importe').expect(401));

  it('answers an empty page rather than an error when nothing exists', async () => {
    expect(await listPage()).toEqual({
      items: [],
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      total: 0,
      totalPages: 0,
    });
  });

  it('lists the newest request first', async () => {
    await createRequest('Dossier A');
    await createRequest('Dossier B');

    const page = await listPage();

    expect(page.items.map((item) => item.title)).toEqual([
      'Dossier B',
      'Dossier A',
    ]);
  });

  // The whole point of the ownership filter: another practice's caseload must
  // not appear, not even as a count.
  it('never shows a lawyer another practice requests', async () => {
    await createRequest('Dossier A');
    await otherLawyerRequest('Dossier confidentiel');

    const page = await listPage();

    expect(page.total).toBe(1);
    expect(page.items.map((item) => item.title)).toEqual(['Dossier A']);
  });

  it('cuts the list into pages', async () => {
    await createRequest('Dossier A');
    await createRequest('Dossier B');
    await createRequest('Dossier C');

    const page = await listPage('?page=2&pageSize=2');

    expect(page.items).toHaveLength(1);
    expect(page).toMatchObject({
      page: 2,
      pageSize: 2,
      total: 3,
      totalPages: 2,
    });
  });

  // Asking beyond the last page is not an error: it is what a stale bookmark
  // does, and the total is what tells the caller where to go back to.
  it('answers an empty page past the last one', async () => {
    await createRequest('Dossier A');

    const page = await listPage('?page=9');

    expect(page.items).toEqual([]);
    expect(page.total).toBe(1);
  });

  it('refuses a page size above the ceiling', () =>
    api.get(`/requests?pageSize=${MAX_PAGE_SIZE + 1}`).expect(400));

  // forbidNonWhitelisted covers the query string too: a filter nobody
  // implemented must fail loudly rather than be silently ignored.
  it('refuses an unknown query parameter', () =>
    api.get('/requests?status=expired').expect(400));

  it('counts a piece as received once a file hangs off it', async () => {
    const created = await createRequest('Dossier A');
    await attachFile(created.items[0].id);

    const page = await listPage();

    expect(page.items[0]).toMatchObject({
      expectedCount: 2,
      receivedCount: 1,
      status: 'pending',
    });
  });

  it('reports a request as complete once every piece arrived', async () => {
    const created = await createRequest('Dossier A');
    await attachFile(created.items[0].id);
    await attachFile(created.items[1].id);

    const page = await listPage();

    expect(page.items[0].status).toBe('complete');
  });

  it('reports a request whose deadline has passed as expired', async () => {
    const created = await createRequest('Dossier A');
    await prisma.publicLink.updateMany({
      where: { requestId: created.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const page = await listPage();

    expect(page.items[0].status).toBe('expired');
  });

  // B3 revokes by dating revokedAt, so the deadline survives. The status keeps
  // describing the file; `link` is what says nobody can deposit any more.
  it('keeps a three-valued status after the link was revoked', async () => {
    const created = await createRequest('Dossier A');
    await api.delete(`/requests/${created.id}/link`).expect(204);

    const page = await listPage();

    expect(page.items[0].status).toBe('pending');
    expect(page.items[0].link.state).toBe('revoked');
  });

  // A regeneration revokes and inserts inside ONE transaction, so Postgres
  // dates both rows identically. The active one must still win.
  it('shows the active link after a regeneration', async () => {
    const created = await createRequest('Dossier A');
    await api
      .post(`/requests/${created.id}/link`)
      .send({ expiresInDays: 30 })
      .expect(201);

    const page = await listPage();

    expect(page.items[0].link.state).toBe('active');
  });

  it('gives the pieces of one request in the order the lawyer typed them', async () => {
    const created = await createRequest('Dossier A');
    await attachFile(created.items[0].id);

    const response = await api.get(`/requests/${created.id}`).expect(200);
    const detail = response.body as DetailBody;

    expect(detail.items.map((item) => item.label)).toEqual([
      "Piece d'identite",
      'Contrat de bail signe',
    ]);
    expect(detail.items[0]).toMatchObject({ received: true, file: FILE });
    expect(detail.items[1]).toMatchObject({ received: false, file: null });
  });

  it('answers 404, not 403, on another practice request', async () => {
    const hidden = await otherLawyerRequest('Dossier confidentiel');

    await api.get(`/requests/${hidden}`).expect(404);
  });

  it('answers the same 404 on an id that exists nowhere', () =>
    api.get('/requests/11111111-1111-1111-1111-111111111111').expect(404));

  // The dashboard is the widest read surface of the API. A column added to
  // PublicLink or UploadedFile must not reach it by accident.
  it('never lets a hash, a token or a PIN reach the response', async () => {
    const created = await createRequest('Dossier A');

    const list = await api.get('/requests').expect(200);
    const detail = await api.get(`/requests/${created.id}`).expect(200);

    for (const body of [list.body, detail.body]) {
      expect(JSON.stringify(body)).not.toMatch(/hash|token|"pin"/i);
    }
  });
});
