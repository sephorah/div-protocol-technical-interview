/**
 * What this suite proves: the HTTP contract of the creation and link routes,
 * through the application as it is really configured -- configureApp() is the
 * very function main.ts calls, so the global guard, cookie-parser, the
 * ValidationPipe and the prefix are the production ones.
 *
 * The writes reach a REAL Postgres, started by test/global-setup.ts. That is
 * what turns the assertions below from "the service called Prisma with these
 * arguments" into "these rows exist", and it is the only way to exercise the
 * partial unique index, the item ordering and the cascade -- none of which a
 * double can carry.
 *
 * What it still does NOT prove: that the portal works through nginx and the
 * frontend.
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

const VALID_BODY = {
  title: 'Dossier Martin, pieces 2026',
  items: ["Piece d'identite", 'Contrat de bail signe'],
  expiresInDays: 14,
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

interface CreatedRequest {
  id: string;
  title: string;
  status: string;
  items: { id: string; label: string; received: boolean }[];
  link: { url: string; pin: string; expiresAt: string };
}

describe('Requests (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let api: ApiClient;
  let anonymous: ApiClient;
  let lawyerId: string;

  const lawyer = {
    name: 'Maitre Dupont',
    email: 'avocat@exemple.fr',
    passwordHash: '',
  };

  const linkPath = (requestId: string): string => `/requests/${requestId}/link`;

  const createRequest = async (): Promise<CreatedRequest> => {
    const response = await api.post('/requests').send(VALID_BODY).expect(201);
    return response.body as CreatedRequest;
  };

  beforeAll(async () => {
    // Hashed at run time from a constant local to this file: no secret on disk,
    // and the real argon2id verification is exercised.
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
    lawyerId = (await insertLawyer(prisma, lawyer)).id;

    anonymous = new ApiClient(app);
    api = new ApiClient(app);
    await api.login(lawyer.email, PASSWORD).expect(200);
  });

  afterEach(async () => {
    await app.close();
  });

  // The controller carries no @UseGuards: this is what proves the GLOBAL guard
  // covers it. Whoever adds a @Public() there breaks this test.
  it('refuses an anonymous creation with 401', async () => {
    await anonymous.post('/requests').send(VALID_BODY).expect(401);

    await expect(prisma.depositRequest.count()).resolves.toBe(0);
  });

  it('answers 201 with the request, its pieces, the deposit URL and the PIN', async () => {
    const body = await createRequest();

    expect(body).toMatchObject({
      title: 'Dossier Martin, pieces 2026',
      status: 'pending',
      items: [
        { label: "Piece d'identite", received: false },
        { label: 'Contrat de bail signe', received: false },
      ],
    });
    expect(body.link.pin).toMatch(/^\d{4}$/);
    // The origin comes from PUBLIC_BASE_URL (test/setup-env.ts), followed by
    // 32 bytes in base64url -- 43 characters over a URL-safe alphabet.
    expect(body.link.url).toMatch(
      /^https:\/\/portail\.example\.test\/deposit\/[A-Za-z0-9_-]{43}$/,
    );
    // The bare token no longer travels: it exists only inside the URL. A field
    // reappearing here would be one more place for a bearer credential to leak.
    expect(body.link).not.toHaveProperty('token');
  });

  // The whole point of hashing: what the client received in clear must exist
  // nowhere in the database. A mock could only check the arguments handed to
  // Prisma; this reads the row that was actually written.
  it('stores the token and the PIN hashed, never in clear', async () => {
    const body = await createRequest();

    const link = await prisma.publicLink.findFirstOrThrow({
      where: { requestId: body.id },
    });

    expect(link.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(link.pinHash).toMatch(/^\$argon2id\$/);
    expect(link.pinHash).not.toContain(body.link.pin);
    // The token travels inside the URL only, so that is where to look for it.
    const token = body.link.url.split('/').pop() as string;
    expect(link.tokenHash).not.toContain(token);
  });

  it('never puts a hash in the response', async () => {
    const response = await api.post('/requests').send(VALID_BODY).expect(201);

    const body = JSON.stringify(response.body);
    expect(body).not.toContain('Hash');
    expect(body).not.toContain('$argon2');
  });

  /**
   * position exists because createdAt cannot order these rows: they are written
   * in one nested insert and share a timestamp to the millisecond, so Postgres
   * is free to hand them back in any order. Reading them back with an explicit
   * orderBy is the only way to catch the column being dropped -- the double
   * returned them in insertion order by construction, and proved nothing.
   */
  it('keeps the pieces in the order they were asked for', async () => {
    const body = await createRequest();

    const items = await prisma.requestedItem.findMany({
      where: { requestId: body.id },
      orderBy: { position: 'asc' },
    });

    expect(items.map((item) => item.label)).toEqual(VALID_BODY.items);
    expect(items.map((item) => item.position)).toEqual([0, 1]);
  });

  it('takes the owner from the session, refusing a body that names one', async () => {
    await api
      .post('/requests')
      .send({ ...VALID_BODY, lawyerId: 'someone-else' })
      .expect(400);
    await expect(prisma.depositRequest.count()).resolves.toBe(0);

    const body = await createRequest();

    const written = await prisma.depositRequest.findUniqueOrThrow({
      where: { id: body.id },
    });
    expect(written.lawyerId).toBe(lawyerId);
  });

  it.each([
    ['an empty list of pieces', { ...VALID_BODY, items: [] }],
    [
      'twenty-one pieces',
      {
        ...VALID_BODY,
        items: Array.from({ length: 21 }, (_, index) => `Piece ${index}`),
      },
    ],
    [
      'two identical labels',
      { ...VALID_BODY, items: ['Contrat de bail', 'contrat de bail'] },
    ],
    ['a validity of zero days', { ...VALID_BODY, expiresInDays: 0 }],
    ['a validity of ninety-one days', { ...VALID_BODY, expiresInDays: 91 }],
    [
      'a missing validity',
      { title: VALID_BODY.title, items: VALID_BODY.items },
    ],
    ['an empty title', { ...VALID_BODY, title: '   ' }],
  ])('answers 400 on %s', async (_label, body) => {
    await api.post('/requests').send(body).expect(400);

    await expect(prisma.depositRequest.count()).resolves.toBe(0);
  });

  /**
   * What these cases prove: the link routes are closed by the SAME global
   * guard, that a request belonging to someone else is indistinguishable from
   * one that does not exist, and that revoking twice is not an error.
   */
  describe('POST /requests/:id/link', () => {
    it('refuses an anonymous caller with 401', async () => {
      const { id } = await createRequest();

      await anonymous
        .post(linkPath(id))
        .send({ expiresInDays: 14 })
        .expect(401);

      await expect(prisma.publicLink.count()).resolves.toBe(1);
    });

    it("answers 404 on another lawyer's request", async () => {
      // A real row, owned by someone else: 404 rather than 403, or the id being
      // rejected would itself confirm the case exists.
      const other = await insertLawyer(prisma, {
        email: 'autre@exemple.fr',
        name: 'Maitre Durand',
        passwordHash: lawyer.passwordHash,
      });
      const foreign = await prisma.depositRequest.create({
        data: { title: 'Dossier de quelqu un d autre', lawyerId: other.id },
      });

      await api
        .post(linkPath(foreign.id))
        .send({ expiresInDays: 14 })
        .expect(404);

      await expect(prisma.publicLink.count()).resolves.toBe(0);
    });

    it('issues a new URL and a new PIN, revoking the previous one', async () => {
      const created = await createRequest();

      const response = await api
        .post(linkPath(created.id))
        .send({ expiresInDays: 14 })
        .expect(201);

      const body = response.body as { url: string; pin: string };
      expect(body.url).toMatch(
        /^https:\/\/portail\.example\.test\/deposit\/[A-Za-z0-9_-]{43}$/,
      );
      expect(body.pin).toMatch(/^\d{4}$/);
      expect(body.url).not.toBe(created.link.url);

      // The old link is revoked, not deleted: its row is what makes a replay of
      // the old token recognisable rather than merely unknown.
      const links = await prisma.publicLink.findMany({
        where: { requestId: created.id },
      });
      expect(links).toHaveLength(2);
      expect(links.filter((link) => link.revokedAt === null)).toHaveLength(1);
    });

    it('never puts a hash in the response', async () => {
      const { id } = await createRequest();

      const response = await api
        .post(linkPath(id))
        .send({ expiresInDays: 14 })
        .expect(201);

      const body = JSON.stringify(response.body);
      expect(body).not.toContain('Hash');
      expect(body).not.toContain('$argon2');
    });

    it.each([
      ['a validity of zero days', { expiresInDays: 0 }],
      ['a validity of ninety-one days', { expiresInDays: 91 }],
      ['a missing validity', {}],
      ['a body naming the owner', { expiresInDays: 14, lawyerId: 'lawyer-2' }],
    ])('answers 400 on %s', async (_label, body) => {
      const { id } = await createRequest();

      const response = await api.post(linkPath(id)).send(body).expect(400);

      // French messages, like the creation route: the library's English
      // defaults would surface here as soon as a decorator loses its message.
      expect(JSON.stringify(response.body)).not.toMatch(/must be/);
      // Still the one link the creation issued: nothing was written.
      await expect(prisma.publicLink.count()).resolves.toBe(1);
    });

    /**
     * The partial unique index is written BY HAND in the initial migration:
     * Prisma cannot express a conditional index, and regenerating the migration
     * drops it in silence. Nothing else in this suite would notice -- the
     * regeneration route revokes before it inserts, so it never collides.
     *
     * Losing the index means two active links on one request, i.e. an old PIN
     * surviving a regeneration meant to replace it.
     */
    it('forbids a second active link, by index', async () => {
      const { id } = await createRequest();

      await expect(
        prisma.publicLink.create({
          data: {
            requestId: id,
            tokenHash: 'a'.repeat(64),
            pinHash: '$argon2id$fake',
            expiresAt: new Date(Date.now() + DAY_IN_MS),
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    /**
     * The other half of the same rule: the index is PARTIAL. Were it total,
     * regenerating a second time would fail and the revocation history would be
     * impossible -- which is the whole reason PublicLink is a table rather than
     * three columns on the request.
     */
    it('allows many revoked links alongside the active one', async () => {
      const { id } = await createRequest();

      await api.post(linkPath(id)).send({ expiresInDays: 14 }).expect(201);
      await api.post(linkPath(id)).send({ expiresInDays: 14 }).expect(201);

      const links = await prisma.publicLink.findMany({
        where: { requestId: id },
      });
      expect(links).toHaveLength(3);
      expect(links.filter((link) => link.revokedAt === null)).toHaveLength(1);
    });
  });

  describe('DELETE /requests/:id/link', () => {
    it('refuses an anonymous caller with 401', async () => {
      const { id } = await createRequest();

      await anonymous.delete(linkPath(id)).expect(401);

      const link = await prisma.publicLink.findFirstOrThrow({
        where: { requestId: id },
      });
      expect(link.revokedAt).toBeNull();
    });

    it("answers 404 on another lawyer's request", async () => {
      const other = await insertLawyer(prisma, {
        email: 'autre@exemple.fr',
        name: 'Maitre Durand',
        passwordHash: lawyer.passwordHash,
      });
      const foreign = await prisma.depositRequest.create({
        data: { title: 'Dossier de quelqu un d autre', lawyerId: other.id },
      });

      await api.delete(linkPath(foreign.id)).expect(404);
    });

    it('answers 204 with no body, twice in a row', async () => {
      const { id } = await createRequest();

      const first = await api.delete(linkPath(id)).expect(204);
      expect(first.body).toEqual({});

      const link = await prisma.publicLink.findFirstOrThrow({
        where: { requestId: id },
      });
      expect(link.revokedAt).not.toBeNull();

      // Idempotent: the second call has nothing left to revoke and must still
      // succeed, or a double click reads as an error.
      await api.delete(linkPath(id)).expect(204);
    });
  });

  /**
   * onDelete: Cascade is declared in the schema and applied by Postgres. No
   * unit test can reach it, and an orphaned RequestedItem would keep a deleted
   * case alive in the lawyer's dashboard.
   */
  it('erases the pieces and the links when the request goes', async () => {
    const { id } = await createRequest();

    await prisma.depositRequest.delete({ where: { id } });

    await expect(
      prisma.requestedItem.count({ where: { requestId: id } }),
    ).resolves.toBe(0);
    await expect(
      prisma.publicLink.count({ where: { requestId: id } }),
    ).resolves.toBe(0);
  });
});
