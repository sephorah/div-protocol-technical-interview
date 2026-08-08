import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { StorageService } from './../src/storage/storage.service';

/**
 * What these tests prove: the probe's HTTP contract. Both dependencies
 * answering yields 200, either one failing yields 503 naming which -- not an
 * optimistic 200, nor a 500 that would conflate the probe with an application
 * failure.
 *
 * What they do NOT prove: that connecting to a real Postgres or a real MinIO
 * works. Both services are replaced by doubles. The real chain is verified by
 * storage.int-spec.ts (testcontainers) and by `docker compose up` +
 * `curl /api/v1/health` (see ai-plans); a dedicated test database will come with
 * D1, once business queries exist.
 */
describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;
  let healthPath: string;
  const queryRaw = jest.fn();
  const ping = jest.fn();

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
      .overrideProvider(StorageService)
      .useValue({
        ping,
        // assertBucketExists is what onModuleInit calls: left real, it would
        // try to reach MinIO on every app.init() of this suite.
        assertBucketExists: jest.fn(),
        onModuleInit: jest.fn(),
        onModuleDestroy: jest.fn(),
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
    ping.mockReset();
    // Default: storage is up, so that each test only sets the failure it is
    // about.
    ping.mockResolvedValue(true);
    await createApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers 200 when the database and the storage both answer', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    await request(app.getHttpServer())
      .get(healthPath)
      .expect(200)
      .expect({ status: 'ok', db: 'up', storage: 'up' });

    // The probe must actually query both, not merely observe that the providers
    // exist: the Prisma connection is lazy and so is the S3 client.
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('answers 503 { db: down } when the database is unreachable', async () => {
    queryRaw.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:5432'),
    );

    await request(app.getHttpServer()).get(healthPath).expect(503).expect({
      status: 'error',
      db: 'down',
      storage: 'up',
    });
  });

  it('answers 503 { storage: down } when the object storage is unreachable', async () => {
    // A backend that cannot store anything is not healthy: every deposit would
    // fail. This is also the signal F2 alerts on ("MinIO unreachable").
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    ping.mockResolvedValue(false);

    await request(app.getHttpServer()).get(healthPath).expect(503).expect({
      status: 'error',
      db: 'up',
      storage: 'down',
    });
  });

  it('reports both failures at once', async () => {
    // Reporting only the first one would send whoever reads the probe after one
    // of the two problems.
    queryRaw.mockRejectedValue(new Error('down'));
    ping.mockResolvedValue(false);

    await request(app.getHttpServer()).get(healthPath).expect(503).expect({
      status: 'error',
      db: 'down',
      storage: 'down',
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
