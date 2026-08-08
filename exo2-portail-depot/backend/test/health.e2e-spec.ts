import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

/**
 * What these tests prove: the probe's HTTP contract. A successful SQL
 * round-trip yields 200 { db: 'up' }, a failing one yields 503 { db: 'down' } --
 * not an optimistic 200, nor a 500 that would conflate the probe with an
 * application failure.
 *
 * What they do NOT prove: that connecting to a real Postgres works.
 * PrismaService is replaced by a double. The real chain is verified with
 * `docker compose up` + `curl /api/v1/health` (see ai-plans), and a dedicated
 * test database will come with D1, once business queries exist.
 */
describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;
  let healthPath: string;
  const queryRaw = jest.fn();

  const createApp = async (): Promise<void> => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        $queryRaw: queryRaw,
        $connect: jest.fn(),
        $disconnect: jest.fn(),
      })
      .compile();

    // logger: false -- the failure cases make the probe log the driver stack.
    // That is the intended production behaviour, but it would drown the test
    // output under expected traces.
    app = moduleFixture.createNestApplication({ logger: false });

    // The global prefix is set in main.ts, which the tests do not go through.
    // Without this line the suite would hit /health and stay green while the
    // real probe lives under /api/v1/health -- precisely the address the docker
    // healthcheck and the nginx `deny all` rule depend on.
    const apiPrefix = app.get(ConfigService).getOrThrow<string>('API_PREFIX');
    app.setGlobalPrefix(apiPrefix);
    healthPath = `${apiPrefix}/health`;

    await app.init();
  };

  beforeEach(async () => {
    queryRaw.mockReset();
    await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers 200 { status: ok, db: up } when the database answers', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    await request(app.getHttpServer())
      .get(healthPath)
      .expect(200)
      .expect({ status: 'ok', db: 'up' });

    // The probe must actually query the database, not merely observe that the
    // provider exists: the Prisma connection is lazy.
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('answers 503 { status: error, db: down } when the database is unreachable', async () => {
    queryRaw.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:5432'),
    );

    await request(app.getHttpServer()).get(healthPath).expect(503).expect({
      status: 'error',
      db: 'down',
    });
  });

  it('no longer answers on /health, outside the prefix', async () => {
    // Guard rail on the coupling with the infrastructure: nginx explicitly
    // denies /api/v1/health and the docker healthcheck queries that same
    // address. Were the prefix to stop applying, the probe would become public
    // again without any other test noticing.
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('does not leak connection details in the error response', async () => {
    // A Postgres driver message contains the host, the port, the database and
    // sometimes the user. It belongs in the logs, not in the HTTP response.
    queryRaw.mockRejectedValue(
      new Error('password authentication failed for user "portail" at db:5432'),
    );

    const response = await request(app.getHttpServer())
      .get(healthPath)
      .expect(503);
    const body = JSON.stringify(response.body);

    expect(body).not.toContain('password');
    expect(body).not.toContain('portail');
    expect(body).not.toContain('5432');
  });
});
