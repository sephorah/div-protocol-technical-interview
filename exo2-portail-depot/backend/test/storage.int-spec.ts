import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  ListBucketsCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { StorageService } from './../src/storage/storage.service';

/**
 * The only suite that talks to a real MinIO rather than to a mock's idea of
 * one, and the only one that runs under the *restricted* policy the application
 * actually gets in production.
 *
 * That second point is what makes it worth its cost: a permission missing from
 * infra/minio/app-policy.json fails here instead of failing on a lawyer's first
 * upload. The policy file is read from infra/, not copied -- one source.
 *
 * It needs Docker, which is why it lives behind its own runner
 * (`pnpm test:integration`, test/jest-int.json): `pnpm test` and
 * `pnpm test:e2e` must stay runnable on a bare machine and in CI.
 */
describe('StorageService (integration, real MinIO)', () => {
  const bucket = 'portail-depot-test';
  const rootUser = 'integration-root';
  const rootPassword = 'integration-root-secret';
  const appAccessKey = 'integration-app';
  const appSecretKey = 'integration-app-secret';

  const policyTemplate = readFileSync(
    join(__dirname, '..', '..', 'infra', 'minio', 'app-policy.json'),
    'utf8',
  );

  let container: StartedTestContainer;
  let endpoint: string;
  let service: StorageService;

  const configFor = (
    overrides: Partial<Record<string, string>> = {},
  ): ConfigService => {
    const values: Record<string, string> = {
      STORAGE_ENDPOINT: endpoint,
      STORAGE_REGION: 'us-east-1',
      STORAGE_BUCKET: bucket,
      STORAGE_ACCESS_KEY: appAccessKey,
      STORAGE_SECRET_KEY: appSecretKey,
      ...overrides,
    };

    return {
      getOrThrow: (key: string): string => values[key] ?? '',
    } as unknown as ConfigService;
  };

  const run = async (command: string[]): Promise<void> => {
    const result = await container.exec(command);
    if (result.exitCode !== 0) {
      throw new Error(
        `${command.join(' ')} exited ${String(result.exitCode)}: ${result.output}`,
      );
    }
  };

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
        MINIO_ROOT_USER: rootUser,
        MINIO_ROOT_PASSWORD: rootPassword,
      })
      .withExposedPorts(9000)
      // Same probe as the compose healthcheck: MinIO accepts connections a
      // moment after the container is "started".
      .withWaitStrategy(
        Wait.forHttp('/minio/health/live', 9000).forStatusCode(200),
      )
      .start();

    endpoint = `http://${container.getHost()}:${String(
      container.getMappedPort(9000),
    )}`;

    // Same five steps as infra/minio/provision.sh, run through the mc the MinIO
    // image ships. Reproduced rather than invoked because the script targets the
    // compose network; the policy itself is the shared artefact.
    await run([
      'mc',
      'alias',
      'set',
      'local',
      'http://127.0.0.1:9000',
      rootUser,
      rootPassword,
    ]);
    await run(['mc', 'mb', '--ignore-existing', `local/${bucket}`]);
    await run([
      'sh',
      '-c',
      `cat > /tmp/app-policy.json <<'POLICY'\n${policyTemplate.replaceAll('__BUCKET__', bucket)}\nPOLICY`,
    ]);
    await run([
      'mc',
      'admin',
      'policy',
      'create',
      'local',
      'portail-app',
      '/tmp/app-policy.json',
    ]);
    await run([
      'mc',
      'admin',
      'user',
      'add',
      'local',
      appAccessKey,
      appSecretKey,
    ]);
    await run([
      'mc',
      'admin',
      'policy',
      'attach',
      'local',
      'portail-app',
      '--user',
      appAccessKey,
    ]);

    service = new StorageService(configFor());
  });

  afterAll(async () => {
    service?.onModuleDestroy();
    await container?.stop();
  });

  describe('assertBucketExists', () => {
    it('passes against the provisioned bucket', async () => {
      await expect(service.assertBucketExists()).resolves.toBeUndefined();
    });

    it('fails when the bucket was never provisioned', async () => {
      // The misspelt-STORAGE_BUCKET case, end to end: the application must not
      // create what it cannot find.
      const wrong = new StorageService(
        configFor({ STORAGE_BUCKET: 'portail-depot-absent' }),
      );

      await expect(wrong.assertBucketExists()).rejects.toThrow(
        /does not exist|denied/,
      );
      wrong.onModuleDestroy();
    });
  });

  describe('least privilege', () => {
    // A raw client carrying the application's credentials, to attempt what the
    // service deliberately offers no method for.
    const appClient = (): S3Client =>
      new S3Client({
        endpoint,
        region: 'us-east-1',
        credentials: {
          accessKeyId: appAccessKey,
          secretAccessKey: appSecretKey,
        },
        forcePathStyle: true,
      });

    it('is denied when it tries to create a bucket', async () => {
      // The point of the whole revision. If this ever succeeds, the application
      // holds administrative rights again and the rest is decoration.
      const client = appClient();

      await expect(
        client.send(new CreateBucketCommand({ Bucket: 'stolen' })),
      ).rejects.toMatchObject({ name: 'AccessDenied' });
      client.destroy();
    });

    it('sees its own bucket and no other', async () => {
      await run(['mc', 'mb', '--ignore-existing', 'local/autre-dossier']);
      const client = appClient();

      const listed = await client.send(new ListBucketsCommand({}));
      const names = (listed.Buckets ?? []).map((entry) => entry.Name);

      // Both assertions matter: without the first, an empty listing -- a broken
      // client, a wrong endpoint -- would satisfy the second and the test would
      // prove nothing.
      expect(names).toContain(bucket);
      expect(names).not.toContain('autre-dossier');
      client.destroy();
    });
  });

  describe('round trip', () => {
    it('returns the exact bytes that were written', async () => {
      const key = `requests/${randomUUID()}/items/i1/contrat.pdf`;
      const content = Buffer.from('contenu du contrat, accents inclus: éàü');

      await service.putObject(key, Readable.from([content]), 'application/pdf');

      const read = await collect(await service.getObjectStream(key));
      expect(read.equals(content)).toBe(true);
    });

    it('handles an object large enough to go through multipart', async () => {
      // lib-storage switches to multipart past its part-size threshold (5 MB).
      // This is the only test that exercises s3:ListMultipartUploadParts, and
      // therefore the only thing standing between us and a policy that works on
      // small files and fails on real documents.
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

  describe('deleteObject', () => {
    it('erases the replaced object under the restricted policy', async () => {
      // The path C2 takes when a client re-deposits a piece. Its failure is
      // SILENT in production -- the deposit answers 201 and the orphan is only
      // a log line -- so a policy missing s3:DeleteObject has to fail here.
      const key = `requests/${randomUUID()}/items/i1/premier.pdf`;
      await service.putObject(
        key,
        Readable.from([Buffer.from('%PDF-1.7')]),
        'application/pdf',
      );

      await service.deleteObject(key);

      await expect(service.getObjectStream(key)).rejects.toThrow();
    });
  });

  describe('deleteByPrefix', () => {
    it("erases one request's files and leaves another request's alone", async () => {
      // The regression this guards against -- a prefix that matches too much --
      // is silent: everything still "works", the other client's documents are
      // simply gone.
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
      await expect(service.ping()).resolves.toBe(true);
    });

    it('is false against an endpoint that answers nothing', async () => {
      // What /health reports when MinIO is down, without needing to stop the
      // container the other tests depend on.
      const unreachable = new StorageService(
        configFor({ STORAGE_ENDPOINT: 'http://127.0.0.1:1' }),
      );

      await expect(unreachable.ping()).resolves.toBe(false);
      unreachable.onModuleDestroy();
    });
  });
});
