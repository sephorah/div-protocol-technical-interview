import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { StorageService } from './../src/storage/storage.service';

/**
 * The only suite that talks to a real MinIO rather than to a mock's idea of
 * one. It is what proves the bytes make the round trip, that ensureBucket
 * actually creates a bucket, and that deleting one request's prefix leaves
 * another request's files alone.
 *
 * It needs Docker, which is why it lives behind its own runner
 * (`pnpm test:integration`, test/jest-int.json): `pnpm test` and
 * `pnpm test:e2e` must stay runnable on a bare machine and in CI.
 */
describe('StorageService (integration, real MinIO)', () => {
  const bucket = 'portail-depot-test';
  const accessKey = 'integration';
  const secretKey = 'integration-secret';

  let container: StartedTestContainer;
  let service: StorageService;

  const configFor = (endpoint: string): ConfigService =>
    ({
      getOrThrow: (key: string): string =>
        ({
          STORAGE_ENDPOINT: endpoint,
          STORAGE_REGION: 'us-east-1',
          STORAGE_BUCKET: bucket,
          STORAGE_ACCESS_KEY: accessKey,
          STORAGE_SECRET_KEY: secretKey,
        })[key] ?? '',
    }) as unknown as ConfigService;

  const collect = async (stream: Readable): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
    return Buffer.concat(chunks);
  };

  beforeAll(async () => {
    Logger.overrideLogger(false);

    container = await new GenericContainer(
      'minio/minio:RELEASE.2025-04-22T22-12-26Z',
    )
      .withCommand(['server', '/data'])
      .withEnvironment({
        MINIO_ROOT_USER: accessKey,
        MINIO_ROOT_PASSWORD: secretKey,
      })
      .withExposedPorts(9000)
      // Same probe as the compose healthcheck: MinIO accepts connections a
      // moment after the container is "started".
      .withWaitStrategy(
        Wait.forHttp('/minio/health/live', 9000).forStatusCode(200),
      )
      .start();

    const endpoint = `http://${container.getHost()}:${String(
      container.getMappedPort(9000),
    )}`;
    service = new StorageService(configFor(endpoint));
  });

  afterAll(async () => {
    service?.onModuleDestroy();
    await container?.stop();
  });

  describe('ensureBucket', () => {
    it('creates the bucket on a blank server, then is replayable', async () => {
      // The bucket does not exist yet: this is the very path the production
      // boot takes on first start.
      await expect(service.ensureBucket()).resolves.toBeUndefined();

      // Second call: a restart must not fail on a bucket it created itself.
      await expect(service.ensureBucket()).resolves.toBeUndefined();
    });
  });

  describe('round trip', () => {
    beforeAll(async () => {
      await service.ensureBucket();
    });

    it('returns the exact bytes that were written', async () => {
      const key = `requests/${randomUUID()}/items/i1/contrat.pdf`;
      const content = Buffer.from('contenu du contrat, accents inclus: éàü');

      await service.putObject(key, Readable.from([content]), 'application/pdf');

      const read = await collect(await service.getObjectStream(key));
      expect(read.equals(content)).toBe(true);
    });

    it('handles an object large enough to go through multipart', async () => {
      // lib-storage switches to multipart past its part-size threshold (5 MB).
      // Mocks never reach that branch: this is the only test that does.
      const key = `requests/${randomUUID()}/items/i1/scan.bin`;
      const content = Buffer.alloc(12 * 1024 * 1024, 7);

      await service.putObject(
        key,
        Readable.from([content]),
        'application/octet-stream',
      );

      const read = await collect(await service.getObjectStream(key));
      expect(read.length).toBe(content.length);
      expect(read.equals(content)).toBe(true);
    });
  });

  describe('deleteByPrefix', () => {
    it("erases one request's files and leaves another request's alone", async () => {
      // The regression this guards against -- a prefix that matches too much --
      // is silent: everything still "works", the other client's documents are
      // simply gone.
      await service.ensureBucket();
      const doomed = randomUUID();
      const spared = randomUUID();

      await service.putObject(
        `requests/${doomed}/items/a/one.txt`,
        Readable.from([Buffer.from('one')]),
        'text/plain',
      );
      await service.putObject(
        `requests/${doomed}/items/b/two.txt`,
        Readable.from([Buffer.from('two')]),
        'text/plain',
      );
      await service.putObject(
        `requests/${spared}/items/a/keep.txt`,
        Readable.from([Buffer.from('keep')]),
        'text/plain',
      );

      await expect(service.deleteByPrefix(`requests/${doomed}/`)).resolves.toBe(
        2,
      );

      await expect(
        service.getObjectStream(`requests/${doomed}/items/a/one.txt`),
      ).rejects.toThrow();

      const kept = await collect(
        await service.getObjectStream(`requests/${spared}/items/a/keep.txt`),
      );
      expect(kept.toString()).toBe('keep');
    });
  });

  describe('ping', () => {
    it('is true against a reachable bucket', async () => {
      await service.ensureBucket();

      await expect(service.ping()).resolves.toBe(true);
    });

    it('is false against an endpoint that answers nothing', async () => {
      // What /health reports when MinIO is down, without needing to stop the
      // container the other tests depend on.
      const unreachable = new StorageService(configFor('http://127.0.0.1:1'));

      await expect(unreachable.ping()).resolves.toBe(false);
      unreachable.onModuleDestroy();
    });
  });
});
