/**
 * What this suite proves: the HTTP contract of the lawyer's session, through
 * the application as it is really configured -- configureApp() is the very
 * function main.ts calls, so cookie-parser, the ValidationPipe, the proxy trust
 * and the global prefix are the production ones.
 *
 * What it does NOT prove: that the queries reach a real Postgres. PrismaService
 * is replaced by a double. The real chain is verified by `./install.sh` plus a
 * login through nginx (see ai-plans).
 */

import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import {
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from './../src/auth/auth-cookie';
import { INVALID_CREDENTIALS } from './../src/auth/auth.service';
import { hashSecret } from './../src/crypto/secrets';
import { PrismaService } from './../src/prisma/prisma.service';
import { StorageService } from './../src/storage/storage.service';

const PASSWORD = 'un-mot-de-passe-de-test';

describe('Auth (e2e)', () => {
  let app: NestExpressApplication;
  let jwt: JwtService;
  let loginPath: string;
  let logoutPath: string;
  let refreshPath: string;
  let mePath: string;
  let healthPath: string;

  const lawyer = {
    id: 'lawyer-1',
    name: 'Maitre Dupont',
    email: 'avocat@exemple.fr',
    passwordHash: '',
    createdAt: new Date(),
  };

  /**
   * Stands in for prisma.lawyer.findUnique, which both paths go through:
   * AuthService looks the account up by e-mail, JwtAuthGuard by identifier.
   * The double honours both so the suite exercises the real code, not a
   * shortcut.
   */
  const findUnique = jest.fn(
    ({ where }: { where: { id?: string; email?: string } }) => {
      if (where.id !== undefined) {
        return Promise.resolve(where.id === lawyer.id ? lawyer : null);
      }
      return Promise.resolve(where.email === lawyer.email ? lawyer : null);
    },
  );

  /**
   * An in-memory stand-in for the RefreshToken table, so that the suite drives
   * the REAL rotation logic rather than a stub of it: a double returning fixed
   * values would let a broken reuse detection pass.
   */
  let stored: Map<string, Record<string, unknown>>;

  const refreshFindUnique = jest.fn(
    ({ where }: { where: { tokenHash: string } }) =>
      Promise.resolve(stored.get(where.tokenHash) ?? null),
  );

  const refreshCreate = jest.fn(
    ({ data }: { data: Record<string, unknown> }) => {
      stored.set(data.tokenHash as string, {
        id: `t${stored.size}`,
        revokedAt: null,
        createdAt: new Date(),
        ...data,
      });
      return Promise.resolve({});
    },
  );

  const refreshUpdateMany = jest.fn(
    ({
      where,
      data,
    }: {
      where: { tokenHash?: string; familyId?: string; revokedAt?: null };
      data: { revokedAt: Date };
    }) => {
      // Without a discriminator the loop below would match every row, so a
      // call meant for one family would revoke every session in the store --
      // and the test would still pass. Fail loudly instead.
      if (where.tokenHash === undefined && where.familyId === undefined) {
        throw new Error('updateMany without tokenHash or familyId');
      }

      let count = 0;
      for (const row of stored.values()) {
        const matches =
          (where.tokenHash === undefined ||
            row.tokenHash === where.tokenHash) &&
          (where.familyId === undefined || row.familyId === where.familyId) &&
          (where.revokedAt !== null || row.revokedAt === null);
        if (matches) {
          row.revokedAt = data.revokedAt;
          count += 1;
        }
      }
      return Promise.resolve({ count });
    },
  );

  /** Deletes the rows whose ceiling has passed, like the real purge. */
  const refreshDeleteMany = jest.fn(
    ({ where }: { where: { expiresAt: { lt: Date } } }) => {
      let count = 0;
      for (const [hash, row] of stored) {
        if ((row.expiresAt as Date).getTime() < where.expiresAt.lt.getTime()) {
          stored.delete(hash);
          count += 1;
        }
      }
      return Promise.resolve({ count });
    },
  );

  /**
   * Reads the value of a Set-Cookie header by name, or null.
   *
   * `response.headers` is typed loosely by supertest, hence the explicit
   * narrowing: node returns a string when a single header was sent and an array
   * when several were, and both shapes occur here.
   */
  const namedCookie = (
    response: request.Response,
    name: string,
  ): string | null => {
    const raw: unknown = response.headers['set-cookie'];
    const cookies: string[] = Array.isArray(raw)
      ? (raw as string[])
      : typeof raw === 'string'
        ? [raw]
        : [];
    return cookies.find((c) => c.startsWith(`${name}=`)) ?? null;
  };

  const sessionCookie = (response: request.Response): string | null =>
    namedCookie(response, AUTH_COOKIE_NAME);

  const refreshCookie = (response: request.Response): string | null =>
    namedCookie(response, REFRESH_COOKIE_NAME);

  const login = (): request.Test =>
    request(app.getHttpServer())
      .post(loginPath)
      .send({ email: lawyer.email, password: PASSWORD });

  beforeAll(async () => {
    // Hashed at run time from a constant local to this file: no secret on disk,
    // and the real argon2id verification is exercised.
    lawyer.passwordHash = await hashSecret(PASSWORD);
  });

  beforeEach(async () => {
    [
      findUnique,
      refreshFindUnique,
      refreshCreate,
      refreshUpdateMany,
      refreshDeleteMany,
    ].forEach((m) => m.mockClear());
    stored = new Map();
    // Real timers by default; the deadline tests move the clock themselves.
    jest.useFakeTimers({ advanceTimers: true, doNotFake: ['nextTick'] });

    const prismaDouble: Record<string, unknown> = {
      lawyer: { findUnique },
      refreshToken: {
        findUnique: refreshFindUnique,
        create: refreshCreate,
        updateMany: refreshUpdateMany,
        deleteMany: refreshDeleteMany,
      },
      $queryRaw: jest.fn(),
      $connect: jest.fn(),
      $disconnect: jest.fn(),
    };
    // Interactive form, handing the same client back: the rotation then runs
    // its real sequence instead of a transaction-shaped stub.
    prismaDouble.$transaction = (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prismaDouble);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaDouble)
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

    jwt = app.get(JwtService);
    const prefix = app.get(ConfigService).getOrThrow<string>('API_PREFIX');
    loginPath = `${prefix}/auth/login`;
    logoutPath = `${prefix}/auth/logout`;
    refreshPath = `${prefix}/auth/refresh`;
    mePath = `${prefix}/auth/me`;
    healthPath = `${prefix}/health`;
  });

  afterEach(async () => {
    jest.useRealTimers();
    await app.close();
  });

  describe('POST /auth/login', () => {
    it('answers 200 with the profile and sets the session cookie', async () => {
      const response = await login().expect(200);

      expect(response.body).toEqual({
        id: 'lawyer-1',
        name: 'Maitre Dupont',
        email: 'avocat@exemple.fr',
      });

      const cookie = sessionCookie(response);
      expect(cookie).not.toBeNull();
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/');
      // 15 min, from JWT_EXPIRES: the cookie dies with the token it carries.
      expect(cookie).toContain('Max-Age=900');
    });

    // The whole point of the httpOnly cookie: if the token were also in the
    // body, the SPA would hold it in JavaScript and an XSS could read it.
    it('puts neither the token nor the hash in the response body', async () => {
      const response = await login().expect(200);

      const serialised = JSON.stringify(response.body);
      expect(serialised).not.toContain('argon2');
      expect(serialised).not.toMatch(/eyJ/); // a JWT always starts with eyJ
      expect(Object.keys(response.body as object)).toEqual([
        'id',
        'name',
        'email',
      ]);
    });

    it('accepts an address whose case differs', async () => {
      await request(app.getHttpServer())
        .post(loginPath)
        .send({ email: 'AVOCAT@Exemple.FR', password: PASSWORD })
        .expect(200);
    });

    it('answers 401 with no cookie on a wrong password', async () => {
      const response = await request(app.getHttpServer())
        .post(loginPath)
        .send({ email: lawyer.email, password: 'mauvais' })
        .expect(401);

      expect(sessionCookie(response)).toBeNull();
      expect((response.body as { message: string }).message).toBe(
        INVALID_CREDENTIALS,
      );
    });

    // Same status, same message as above: the API must not say which addresses
    // have an account.
    it('answers the same thing on an unknown address', async () => {
      const response = await request(app.getHttpServer())
        .post(loginPath)
        .send({ email: 'inconnu@exemple.fr', password: PASSWORD })
        .expect(401);

      expect(sessionCookie(response)).toBeNull();
      expect((response.body as { message: string }).message).toBe(
        INVALID_CREDENTIALS,
      );
    });

    it.each([
      ['a malformed address', { email: 'pas-une-adresse', password: PASSWORD }],
      ['a missing password', { email: 'avocat@exemple.fr' }],
      [
        'an extra field',
        { email: 'avocat@exemple.fr', password: PASSWORD, role: 'admin' },
      ],
      // The bound is the ONLY thing capping the cost of a login attempt, since
      // this route is anonymous and deliberately not rate-limited: argon2id's
      // cost grows with its input, so an unbounded field would let anyone ask
      // the server to hash a hundred kilobytes. Tested because dropping the
      // decorator would otherwise leave every other test green.
      [
        'an oversized password',
        { email: 'avocat@exemple.fr', password: 'x'.repeat(201) },
      ],
      [
        'an oversized address',
        { email: `${'x'.repeat(320)}@exemple.fr`, password: PASSWORD },
      ],
    ])('answers 400 on %s', async (_label, body) => {
      await request(app.getHttpServer()).post(loginPath).send(body).expect(400);
    });

    it('marks the cookie Secure when the request arrived over HTTPS', async () => {
      const response = await request(app.getHttpServer())
        .post(loginPath)
        .set('X-Forwarded-Proto', 'https')
        .send({ email: lawyer.email, password: PASSWORD })
        .expect(200);

      expect(sessionCookie(response)).toContain('Secure');
    });

    it('does not mark it Secure in cleartext, or the browser would drop it', async () => {
      const response = await login().expect(200);

      expect(sessionCookie(response)).not.toContain('Secure');
    });
  });

  describe('GET /auth/me', () => {
    it('answers 401 with no cookie', async () => {
      await request(app.getHttpServer()).get(mePath).expect(401);
    });

    it('answers the profile with the cookie obtained at login', async () => {
      const cookie = sessionCookie(await login().expect(200));

      const response = await request(app.getHttpServer())
        .get(mePath)
        .set('Cookie', cookie as string)
        .expect(200);

      expect(response.body).toEqual({
        id: 'lawyer-1',
        name: 'Maitre Dupont',
        email: 'avocat@exemple.fr',
      });
      expect(JSON.stringify(response.body)).not.toContain('argon2');
    });

    it('answers 401 on a token signed with another secret', async () => {
      const forged = new JwtService({
        secret: 'an-entirely-different-secret-of-the-right-length',
      }).sign({ sub: lawyer.id });

      await request(app.getHttpServer())
        .get(mePath)
        .set('Cookie', `${AUTH_COOKIE_NAME}=${forged}`)
        .expect(401);
    });

    it('answers 401 on an expired token', async () => {
      const expired = jwt.sign({ sub: lawyer.id }, { expiresIn: '-1s' });

      await request(app.getHttpServer())
        .get(mePath)
        .set('Cookie', `${AUTH_COOKIE_NAME}=${expired}`)
        .expect(401);
    });

    it('answers 401 on a valid token whose account no longer exists', async () => {
      const orphan = jwt.sign({ sub: 'deleted-lawyer' });

      await request(app.getHttpServer())
        .get(mePath)
        .set('Cookie', `${AUTH_COOKIE_NAME}=${orphan}`)
        .expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('answers 204 and clears the cookie with the same attributes', async () => {
      const response = await request(app.getHttpServer())
        .post(logoutPath)
        .expect(204);

      const cookie = sessionCookie(response);
      // Express deletes by way of an expiry in the past rather than Max-Age=0.
      // Both are valid; this asserts what is actually emitted, so the day the
      // mechanism changes the test says so instead of passing by luck.
      expect(cookie).toContain(`${AUTH_COOKIE_NAME}=;`);
      expect(cookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/');
    });

    // Public deliberately: a lawyer whose token has expired must still be able
    // to get rid of the cookie.
    it('works without a session', async () => {
      await request(app.getHttpServer()).post(logoutPath).expect(204);
    });
  });

  describe('POST /auth/refresh', () => {
    it('sets both cookies at login, the refresh one scoped to /auth', async () => {
      const response = await login().expect(200);

      expect(sessionCookie(response)).toContain('Max-Age=900'); // 15 min
      expect(refreshCookie(response)).toContain('Path=/api/v1/auth');
      expect(refreshCookie(response)).toContain('Max-Age=604800'); // 7 jours
      expect(refreshCookie(response)).toContain('HttpOnly');
    });

    it('answers a new pair and rotates the refresh token', async () => {
      const first = refreshCookie(await login().expect(200)) as string;

      const renewed = await request(app.getHttpServer())
        .post(refreshPath)
        .set('Cookie', first)
        .expect(200);

      expect(refreshCookie(renewed)).not.toBe(first);
      expect(sessionCookie(renewed)).not.toBeNull();
      expect(renewed.body).toEqual({
        id: 'lawyer-1',
        name: 'Maitre Dupont',
        email: 'avocat@exemple.fr',
      });
    });

    it('answers 401 with no refresh cookie', async () => {
      await request(app.getHttpServer()).post(refreshPath).expect(401);
    });

    // An empty value is what a half-cleared cookie leaves behind. It must be a
    // 401 like any other, never a lookup on the hash of an empty string.
    it.each(['', 'pas-un-jeton'])(
      'answers 401 on a malformed refresh cookie (%p)',
      async (value) => {
        await request(app.getHttpServer())
          .post(refreshPath)
          .set('Cookie', `${REFRESH_COOKIE_NAME}=${value}`)
          .expect(401);
      },
    );

    /**
     * The scenario the whole feature exists for: a cookie was copied, both the
     * thief and the lawyer use it, and whoever comes second is detected.
     */
    it('kills the session when a rotated token is presented again', async () => {
      const first = refreshCookie(await login().expect(200)) as string;
      const second = refreshCookie(
        await request(app.getHttpServer())
          .post(refreshPath)
          .set('Cookie', first)
          .expect(200),
      ) as string;

      // Beyond the race window, replaying the first token is an attack.
      jest.setSystemTime(new Date(Date.now() + 60_000));
      await request(app.getHttpServer())
        .post(refreshPath)
        .set('Cookie', first)
        .expect(401);

      // And the successor, which the attacker may hold too, is dead with it.
      await request(app.getHttpServer())
        .post(refreshPath)
        .set('Cookie', second)
        .expect(401);
    });

    /**
     * Two tabs refreshing at once. The refusal must NOT clear the cookies: the
     * browser shares them across tabs, so the one the other tab just obtained
     * is still valid and the retry succeeds. Clearing here would log the lawyer
     * out for having two tabs open -- what the race window exists to prevent.
     */
    it('refuses a concurrent replay without clearing the cookies', async () => {
      const first = refreshCookie(await login().expect(200)) as string;
      const second = refreshCookie(
        await request(app.getHttpServer())
          .post(refreshPath)
          .set('Cookie', first)
          .expect(200),
      ) as string;

      const raced = await request(app.getHttpServer())
        .post(refreshPath)
        .set('Cookie', first)
        .expect(401);

      expect(refreshCookie(raced)).toBeNull();
      expect(sessionCookie(raced)).toBeNull();

      // And the session is untouched: the cookie the other tab holds still works.
      await request(app.getHttpServer())
        .post(refreshPath)
        .set('Cookie', second)
        .expect(200);
    });

    // A terminal refusal, by contrast, must clear both: otherwise the SPA keeps
    // retrying a renewal that can never succeed.
    it('clears both cookies when the session is really over', async () => {
      const cookie = refreshCookie(await login().expect(200)) as string;

      jest.setSystemTime(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));
      const refused = await request(app.getHttpServer())
        .post(refreshPath)
        .set('Cookie', cookie)
        .expect(401);

      expect(refreshCookie(refused)).toContain('Expires=Thu, 01 Jan 1970');
      expect(sessionCookie(refused)).toContain('Expires=Thu, 01 Jan 1970');
    });

    it('refuses to renew past the 7-day ceiling', async () => {
      const cookie = refreshCookie(await login().expect(200)) as string;

      jest.setSystemTime(new Date(Date.now() + 8 * 24 * 60 * 60 * 1000));

      await request(app.getHttpServer())
        .post(refreshPath)
        .set('Cookie', cookie)
        .expect(401);
    });

    // Four days of silence: the ceiling has not been reached, the idle deadline
    // has. This is the case the ceiling alone would let through.
    it('refuses to renew a session left unused for four days', async () => {
      const cookie = refreshCookie(await login().expect(200)) as string;

      jest.setSystemTime(new Date(Date.now() + 4 * 24 * 60 * 60 * 1000));

      await request(app.getHttpServer())
        .post(refreshPath)
        .set('Cookie', cookie)
        .expect(401);
    });

    // The mirror image: coming back every two days keeps it alive. Without the
    // idle deadline being pushed back on rotation, the lawyer would be logged
    // out on the third day mid-work.
    it('keeps a session alive when it is used every two days', async () => {
      let cookie = refreshCookie(await login().expect(200)) as string;

      for (let round = 0; round < 3; round += 1) {
        jest.setSystemTime(new Date(Date.now() + 2 * 24 * 60 * 60 * 1000));
        const renewed = await request(app.getHttpServer())
          .post(refreshPath)
          .set('Cookie', cookie)
          .expect(200);
        cookie = refreshCookie(renewed) as string;
      }
    });
  });

  it('makes logout revoke the session server-side, not just the cookie', async () => {
    const cookie = refreshCookie(await login().expect(200)) as string;

    await request(app.getHttpServer())
      .post(logoutPath)
      .set('Cookie', cookie)
      .expect(204);

    // The whole point: the refresh token no longer works, even though the
    // client kept a copy of it.
    await request(app.getHttpServer())
      .post(refreshPath)
      .set('Cookie', cookie)
      .expect(401);
  });

  /**
   * The case that would go unnoticed and would cost the most: the global guard
   * closing the health probe. Docker would then declare the container unhealthy
   * and restart it in a loop, with nothing in the logs pointing at
   * authentication.
   */
  it('leaves the health probe open to unauthenticated callers', async () => {
    await request(app.getHttpServer()).get(healthPath).expect(200);
  });
});
