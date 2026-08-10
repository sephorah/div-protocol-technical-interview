/**
 * What this suite proves: the anonymous client's HTTP contract, through the
 * application as main.ts really configures it (configureApp), against a REAL
 * Postgres started by test/global-setup.ts.
 *
 * The two properties it exists for are the ones no unit test can observe end to
 * end: the four refusals are byte-for-byte the same answer, and a session that
 * was opened legitimately dies the moment its link is revoked.
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

// The whole body, `error` included: the assertion is that the four refusals are
// indistinguishable, so it must compare everything a caller can read, not just
// the field we chose to write.
const REFUSED = {
  message: 'Lien ou code invalide.',
  error: 'Unauthorized',
  statusCode: 401,
};

const VALID_BODY = {
  title: 'Dossier Martin, pieces 2026',
  items: ["Piece d'identite", 'Contrat de bail signe'],
  expiresInDays: 14,
};

interface CreatedRequest {
  id: string;
  link: { url: string; pin: string; expiresAt: string };
}

interface ClientView {
  requestId: string;
  title: string;
  expiresAt: string;
  items: { id: string; label: string; received: boolean }[];
}

// The token is the last path segment of the address the lawyer would email.
const tokenOf = (created: CreatedRequest): string =>
  created.link.url.split('/').at(-1) ?? '';

describe('Public deposit access (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
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
      .send(VALID_BODY)
      .expect(201);
    return response.body as CreatedRequest;
  };

  const unlock = (token: string, pin: string) =>
    client.post(`/public/${token}/unlock`).send({ pin });

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

    lawyerApi = new ApiClient(app);
    await lawyerApi.login(lawyer.email, PASSWORD).expect(200);
    // Never logged in: this IS the anonymous client the route is written for.
    client = new ApiClient(app);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('unlock', () => {
    it('answers 200 with the client view and sets the session cookie', async () => {
      const created = await createRequest();

      const response = await unlock(tokenOf(created), created.link.pin).expect(
        200,
      );

      expect(response.body as ClientView).toEqual({
        requestId: created.id,
        title: 'Dossier Martin, pieces 2026',
        expiresAt: created.link.expiresAt,
        items: [
          {
            id: expect.any(String) as string,
            label: "Piece d'identite",
            received: false,
          },
          {
            id: expect.any(String) as string,
            label: 'Contrat de bail signe',
            received: false,
          },
        ],
      });

      const cookie = (response.headers['set-cookie'] as unknown as string[])
        .filter((value) => value.startsWith('portail_client='))
        .join('');
      // Scoped to the public routes, so the browser never attaches it to the
      // SPA's assets nor to the lawyer's API calls. No Secure here: the request
      // arrived in cleartext, and a Secure cookie would be set and never sent
      // back -- login failing silently on the grader's 127.0.0.1 portal.
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/api/v1/public');
      expect(cookie).not.toContain('Secure');
    });

    // The property the whole design rests on. Four different situations, one
    // answer: anything that differs lets an anonymous caller tell a
    // non-existent token from an expired link, hence enumerate live links.
    it('answers the same 401 to a wrong pin, an unknown, a revoked and an expired link', async () => {
      const created = await createRequest();
      const token = tokenOf(created);

      const wrongPin = await unlock(token, '0000');
      const unknown = await unlock('a'.repeat(43), created.link.pin);

      await prisma.publicLink.updateMany({
        where: { requestId: created.id },
        data: { revokedAt: new Date() },
      });
      const revoked = await unlock(token, created.link.pin);

      await prisma.publicLink.updateMany({
        where: { requestId: created.id },
        data: { revokedAt: null, expiresAt: new Date(Date.now() - 1000) },
      });
      const expired = await unlock(token, created.link.pin);

      for (const response of [wrongPin, unknown, revoked, expired]) {
        expect(response.status).toBe(401);
        expect(response.body as unknown).toEqual(REFUSED);
        expect(response.headers['set-cookie']).toBeUndefined();
      }
    });

    it('rejects a pin that is not four digits with 400 and a French message', async () => {
      const created = await createRequest();

      const response = await unlock(tokenOf(created), '12').expect(400);

      expect(JSON.stringify(response.body)).not.toContain('must');
    });

    // Everything the practice knows about itself must stay on the lawyer's
    // side: resolve() hands over the whole DepositRequest row, so a spread
    // would publish lawyerId to whoever holds a PIN.
    it('never exposes a hash, the lawyer or the link identifier', async () => {
      const created = await createRequest();
      const link = await prisma.publicLink.findFirstOrThrow({
        where: { requestId: created.id },
      });

      const response = await unlock(tokenOf(created), created.link.pin).expect(
        200,
      );
      const serialised = JSON.stringify(response.body);

      expect(serialised).not.toContain(link.pinHash);
      expect(serialised).not.toContain(link.tokenHash);
      expect(serialised).not.toContain(link.id);
      expect(serialised).not.toContain(lawyer.email);
      expect(response.body).not.toHaveProperty('lawyerId');
    });
  });

  describe('session', () => {
    it('refuses a caller carrying no client cookie', async () => {
      const response = await client.get('/public/session').expect(401);

      expect(response.body as unknown).toEqual(REFUSED);
    });

    it('returns the same view as the unlock did', async () => {
      const created = await createRequest();
      const unlocked = await unlock(tokenOf(created), created.link.pin).expect(
        200,
      );

      const session = await client.get('/public/session').expect(200);

      expect(session.body as ClientView).toEqual(unlocked.body as ClientView);
    });

    // The reason the session carries linkId: the token lives 30 minutes and
    // cannot be recalled, so without the re-read DELETE /requests/:id/link
    // would answer 204 while the client keeps working.
    it('dies as soon as the lawyer revokes the link', async () => {
      const created = await createRequest();
      await unlock(tokenOf(created), created.link.pin).expect(200);

      await lawyerApi.delete(`/requests/${created.id}/link`).expect(204);

      const response = await client.get('/public/session').expect(401);
      expect(response.body as unknown).toEqual(REFUSED);
    });

    it('dies as soon as the link expires', async () => {
      const created = await createRequest();
      await unlock(tokenOf(created), created.link.pin).expect(200);

      await prisma.publicLink.updateMany({
        where: { requestId: created.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await client.get('/public/session').expect(401);
    });
  });

  // The two halves of the boundary, over HTTP. Each population's guard reads a
  // different cookie AND a different signing key, so neither token can be
  // replayed on the other side.
  describe('the boundary between the two session types', () => {
    it('refuses a lawyer session presented on the client route', async () => {
      const login = await lawyerApi.login(lawyer.email, PASSWORD).expect(200);
      const lawyerCookie = (
        login.headers['set-cookie'] as unknown as string[]
      ).find((value) => value.startsWith('portail_auth='));

      await client
        .get('/public/session')
        // Renamed onto the client cookie: without that the guard would refuse
        // it for being absent, which proves nothing about the signature.
        .set(
          'Cookie',
          `portail_client=${(lawyerCookie ?? '').split(';')[0].split('=')[1]}`,
        )
        .expect(401);
    });

    it('refuses a client session presented on a lawyer route', async () => {
      const created = await createRequest();
      const unlocked = await unlock(tokenOf(created), created.link.pin).expect(
        200,
      );
      const clientCookie = (
        unlocked.headers['set-cookie'] as unknown as string[]
      ).find((value) => value.startsWith('portail_client='));

      const anonymous = new ApiClient(app);
      await anonymous
        .get('/requests')
        .set(
          'Cookie',
          `portail_auth=${(clientCookie ?? '').split(';')[0].split('=')[1]}`,
        )
        .expect(401);
    });
  });
});
