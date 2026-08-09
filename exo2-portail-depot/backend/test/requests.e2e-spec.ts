/**
 * What this suite proves: the HTTP contract of the creation route, through the
 * application as it is really configured -- configureApp() is the very function
 * main.ts calls, so the global guard, cookie-parser, the ValidationPipe and the
 * prefix are the production ones.
 *
 * What it does NOT prove: that the write reaches a real Postgres. PrismaService
 * is replaced by a double. That chain is verified by hand against the running
 * containers -- see ai-plans/2026-08-09-b2-creation-demande.md.
 */

import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { hashSecret } from './../src/crypto/secrets';
import { PrismaService } from './../src/prisma/prisma.service';
import { StorageService } from './../src/storage/storage.service';

const PASSWORD = 'un-mot-de-passe-de-test';

const VALID_BODY = {
  title: 'Dossier Martin, pieces 2026',
  items: ["Piece d'identite", 'Contrat de bail signe'],
  expiresInDays: 14,
};

interface WrittenData {
  title: string;
  lawyerId: string;
  items: { create: { label: string; position: number }[] };
  links: { create: Record<string, unknown> };
}

describe('Requests (e2e)', () => {
  let app: NestExpressApplication;
  let loginPath: string;
  let requestsPath: string;

  const lawyer = {
    id: 'lawyer-1',
    name: 'Maitre Dupont',
    email: 'avocat@exemple.fr',
    passwordHash: '',
    createdAt: new Date(),
  };

  // Honours both lookups: AuthService searches by e-mail, JwtAuthGuard by id.
  const lawyerFindUnique = jest.fn(
    ({ where }: { where: { id?: string; email?: string } }) => {
      if (where.id !== undefined) {
        return Promise.resolve(where.id === lawyer.id ? lawyer : null);
      }
      return Promise.resolve(where.email === lawyer.email ? lawyer : null);
    },
  );

  const requestCreate = jest.fn(({ data }: { data: WrittenData }) =>
    Promise.resolve({
      id: 'request-1',
      title: data.title,
      lawyerId: data.lawyerId,
      createdAt: new Date('2026-08-09T10:00:00.000Z'),
      items: data.items.create.map((item, index) => ({
        id: `item-${index}`,
        label: item.label,
        position: item.position,
      })),
    }),
  );

  const sessionCookie = async (): Promise<string> => {
    const response = await request(app.getHttpServer())
      .post(loginPath)
      .send({ email: lawyer.email, password: PASSWORD })
      .expect(200);

    const raw: unknown = response.headers['set-cookie'];
    const cookies: string[] = Array.isArray(raw)
      ? (raw as string[])
      : typeof raw === 'string'
        ? [raw]
        : [];
    return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
  };

  beforeAll(async () => {
    // Hashed at run time from a constant local to this file: no secret on disk,
    // and the real argon2id verification is exercised.
    lawyer.passwordHash = await hashSecret(PASSWORD);
  });

  beforeEach(async () => {
    lawyerFindUnique.mockClear();
    requestCreate.mockClear();

    const prismaDouble: Record<string, unknown> = {
      lawyer: { findUnique: lawyerFindUnique },
      depositRequest: { create: requestCreate },
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $queryRaw: jest.fn(),
      $connect: jest.fn(),
      $disconnect: jest.fn(),
    };
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

    const prefix = app.get(ConfigService).getOrThrow<string>('API_PREFIX');
    loginPath = `${prefix}/auth/login`;
    requestsPath = `${prefix}/requests`;
  });

  afterEach(async () => {
    await app.close();
  });

  // The controller carries no @UseGuards: this is what proves the GLOBAL guard
  // covers it. Whoever adds a @Public() there breaks this test.
  it('refuses an anonymous creation with 401', async () => {
    await request(app.getHttpServer())
      .post(requestsPath)
      .send(VALID_BODY)
      .expect(401);

    expect(requestCreate).not.toHaveBeenCalled();
  });

  it('answers 201 with the request, its pieces, the deposit URL and the PIN', async () => {
    const cookie = await sessionCookie();

    const response = await request(app.getHttpServer())
      .post(requestsPath)
      .set('Cookie', cookie)
      .send(VALID_BODY)
      .expect(201);

    expect(response.body).toMatchObject({
      id: 'request-1',
      title: 'Dossier Martin, pieces 2026',
      status: 'pending',
      items: [
        { id: 'item-0', label: "Piece d'identite", received: false },
        { id: 'item-1', label: 'Contrat de bail signe', received: false },
      ],
    });
    // supertest types the body as `any`; naming the shape is what the blocking
    // lint requires, and it documents what the SPA can rely on.
    const { link } = response.body as {
      link: Record<string, unknown> & { pin: string; url: string };
    };
    expect(link.pin).toMatch(/^\d{4}$/);
    // The origin comes from PUBLIC_BASE_URL (test/setup-env.ts), followed by
    // 32 bytes in base64url -- 43 characters over a URL-safe alphabet.
    expect(link.url).toMatch(
      /^https:\/\/portail\.example\.test\/depot\/[A-Za-z0-9_-]{43}$/,
    );
    // The bare token no longer travels: it exists only inside the URL. A field
    // reappearing here would be one more place for a bearer credential to leak.
    expect(link).not.toHaveProperty('token');
  });

  // The whole point of hashing: a response leaking a hash would hand an
  // attacker the material for an offline attack on a 4-digit PIN.
  it('never puts a hash in the response', async () => {
    const cookie = await sessionCookie();

    const response = await request(app.getHttpServer())
      .post(requestsPath)
      .set('Cookie', cookie)
      .send(VALID_BODY)
      .expect(201);

    const body = JSON.stringify(response.body);
    expect(body).not.toContain('Hash');
    expect(body).not.toContain('$argon2');
  });

  it('takes the owner from the session, refusing a body that names one', async () => {
    const cookie = await sessionCookie();

    await request(app.getHttpServer())
      .post(requestsPath)
      .set('Cookie', cookie)
      .send({ ...VALID_BODY, lawyerId: 'someone-else' })
      .expect(400);
    expect(requestCreate).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post(requestsPath)
      .set('Cookie', cookie)
      .send(VALID_BODY)
      .expect(201);

    const written = requestCreate.mock.calls[0][0].data;
    expect(written.lawyerId).toBe('lawyer-1');
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
    const cookie = await sessionCookie();

    await request(app.getHttpServer())
      .post(requestsPath)
      .set('Cookie', cookie)
      .send(body)
      .expect(400);

    expect(requestCreate).not.toHaveBeenCalled();
  });
});
