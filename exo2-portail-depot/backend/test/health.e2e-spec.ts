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
 * The healthy case is no longer simulated: the database really answers, so a
 * probe that stopped querying it could not stay green by mocking. The failure
 * case still needs staging, and it is staged with a spy on the real client
 * rather than a double of the whole service -- see the comment on it.
 *
 * Storage remains a double: MinIO is exercised by storage.int-spec.ts, and a
 * second container here would only add startup time.
 */
describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let healthPath: string;
  const ping = jest.fn();

  const createApp = async (): Promise<void> => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
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
    prisma = app.get(PrismaService);
  };

  /**
   * Makes the database look down for one test.
   *
   * A spy on the real client, not a double of PrismaService: stopping the
   * container would be the faithful version, but the database is shared by
   * every suite of this run and the next test would find nothing to talk to.
   */
  const breakDatabase = (message: string): void => {
    jest.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error(message));
  };

  beforeEach(async () => {
    ping.mockReset();
    // Default: storage is up, so that each test only sets the failure it is
    // about.
    ping.mockResolvedValue(true);
    await createApp();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  it('answers 200 when the database and the storage both answer', async () => {
    // The probe must actually query both, not merely observe that the providers
    // exist: the Prisma connection is lazy and so is the S3 client. The spy
    // calls through, so the query really reaches Postgres.
    const queryRaw = jest.spyOn(prisma, '$queryRaw');

    await request(app.getHttpServer())
      .get(healthPath)
      .expect(200)
      .expect({ status: 'ok', db: 'up', storage: 'up' });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it('answers 503 { db: down } when the database is unreachable', async () => {
    breakDatabase('connect ECONNREFUSED 127.0.0.1:5432');

    await request(app.getHttpServer()).get(healthPath).expect(503).expect({
      status: 'error',
      db: 'down',
      storage: 'up',
    });
  });

  it('answers 503 { storage: down } when the object storage is unreachable', async () => {
    // A backend that cannot store anything is not healthy: every deposit would
    // fail. This is also the signal F2 alerts on ("MinIO unreachable").
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
    breakDatabase('down');
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
    await request(app.getHttpServer()).get('/health').expect(404);
  });

  it('does not leak connection details in the error response', async () => {
    // A Postgres driver message contains the host, the port, the database and
    // sometimes the user. It belongs in the logs, not in the HTTP response.
    breakDatabase(
      'password authentication failed for user "portail" at db:5432',
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
