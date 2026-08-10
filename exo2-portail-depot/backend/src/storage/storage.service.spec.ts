import { Readable } from 'node:stream';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

/**
 * What these tests prove: the commands the service sends, on the bucket it was
 * configured with. They mock S3Client.prototype.send, which is the single point
 * every command goes through -- Upload included, since lib-storage drives the
 * same client.
 *
 * What they do NOT prove: that a real server accepts these commands. That is
 * storage.int-spec.ts, against a MinIO container.
 */
describe('StorageService', () => {
  const bucket = 'portail-depot';
  let send: jest.SpyInstance;
  let service: StorageService;

  const notFound = (): Error =>
    Object.assign(new Error('Not Found'), {
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    });

  const config = {
    getOrThrow: (key: string): string =>
      ({
        STORAGE_BUCKET: bucket,
        STORAGE_ENDPOINT: 'http://minio:9000',
        STORAGE_REGION: 'us-east-1',
        STORAGE_ACCESS_KEY: 'access',
        STORAGE_SECRET_KEY: 'secret',
      })[key] ?? '',
  } as unknown as ConfigService;

  /** The commands sent so far: constructor name + input, in order. */
  const sentCommands = (): { type: string; input: unknown }[] =>
    send.mock.calls.map(([command]: [{ input: unknown }]) => ({
      type: command.constructor.name,
      input: command.input,
    }));

  beforeAll(() => {
    // The failure cases make the service log the S3 stack. That is the intended
    // production behaviour, but it would drown the test output under expected
    // traces.
    Logger.overrideLogger(false);
  });

  beforeEach(() => {
    send = jest.spyOn(S3Client.prototype, 'send');
    service = new StorageService(config);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('assertBucketExists', () => {
    it('never creates the bucket', async () => {
      // The guard rail of this whole design: provisioning belongs to
      // minio-init, and the application's credentials carry no
      // s3:CreateBucket. Reintroducing a creation here would silently require
      // root credentials again.
      send.mockRejectedValue(notFound());

      await expect(service.assertBucketExists()).rejects.toThrow();

      expect(
        sentCommands().some((command) =>
          command.type.startsWith('CreateBucket'),
        ),
      ).toBe(false);
    });

    it('fails differently on a denied access', async () => {
      // Wrong credentials and a missing bucket send whoever reads the startup
      // failure to opposite places; one message for both would waste that trip.
      send.mockRejectedValue(
        Object.assign(new Error('Forbidden'), {
          name: 'AccessDenied',
          $metadata: { httpStatusCode: 403 },
        }),
      );

      await expect(service.assertBucketExists()).rejects.toThrow(
        /denied.*STORAGE_ACCESS_KEY.*policy/s,
      );
    });

    it('rethrows anything it cannot classify', async () => {
      send.mockRejectedValue(new Error('connect ECONNREFUSED'));

      await expect(service.assertBucketExists()).rejects.toThrow(
        'connect ECONNREFUSED',
      );
    });

    it('is what onModuleInit runs, so a missing bucket stops the boot', async () => {
      send.mockRejectedValue(notFound());

      await expect(service.onModuleInit()).rejects.toThrow('does not exist');
    });
  });

  describe('putObject', () => {
    it('propagates a write failure instead of silently losing the file', async () => {
      send.mockRejectedValue(new Error('storage full'));

      await expect(
        service.putObject('k', Readable.from([Buffer.from('x')]), 'text/plain'),
      ).rejects.toThrow('storage full');
    });
  });

  describe('getObjectStream', () => {
    it('fails explicitly on a bodyless response', async () => {
      send.mockResolvedValue({});

      await expect(service.getObjectStream('k')).rejects.toThrow('no body');
    });
  });

  describe('deleteObject', () => {
    it('refuses an empty key', async () => {
      // An empty Key is not a no-op on every S3 implementation, and it would
      // arrive here from a row whose storageKey was never read.
      await expect(service.deleteObject('')).rejects.toThrow('non-empty');
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('deleteByPrefix', () => {
    it('follows the pagination', async () => {
      // A request with more than 1000 files would otherwise leave the remainder
      // behind, and nothing would say so.
      send
        .mockResolvedValueOnce({
          Contents: [{ Key: 'requests/r1/a' }],
          IsTruncated: true,
          NextContinuationToken: 'page2',
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          Contents: [{ Key: 'requests/r1/b' }],
          IsTruncated: false,
        })
        .mockResolvedValueOnce({});

      await expect(service.deleteByPrefix('requests/r1/')).resolves.toBe(2);

      const listings = sentCommands().filter(
        (command) => command.type === ListObjectsV2Command.name,
      );
      expect(listings).toHaveLength(2);
      expect(listings[1].input).toMatchObject({ ContinuationToken: 'page2' });
    });

    it('fails when the server reports a per-key failure', async () => {
      // DeleteObjects answers 200 with the failures in Errors. Trusting the
      // number of keys sent would report objects as erased while they are still
      // in the bucket.
      send
        .mockResolvedValueOnce({
          Contents: [{ Key: 'requests/r1/a' }, { Key: 'requests/r1/b' }],
          IsTruncated: false,
        })
        .mockResolvedValueOnce({
          Deleted: [{ Key: 'requests/r1/a' }],
          Errors: [{ Key: 'requests/r1/b', Code: 'AccessDenied' }],
        });

      await expect(service.deleteByPrefix('requests/r1/')).rejects.toThrow(
        /requests\/r1\/b \(AccessDenied\)/,
      );
    });

    it('counts what the server confirms, not what was requested', async () => {
      send
        .mockResolvedValueOnce({
          Contents: [{ Key: 'requests/r1/a' }, { Key: 'requests/r1/b' }],
          IsTruncated: false,
        })
        .mockResolvedValueOnce({ Deleted: [{ Key: 'requests/r1/a' }] });

      await expect(service.deleteByPrefix('requests/r1/')).resolves.toBe(1);
    });

    it('refuses an empty prefix, which would match the whole bucket', async () => {
      await expect(service.deleteByPrefix('')).rejects.toThrow('non-empty');
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('ping', () => {
    it('is false instead of throwing when the storage is unreachable', async () => {
      // The health probe reports a state; a throwing ping would turn a 503 into
      // a 500 and lose the "which dependency" information.
      send.mockRejectedValue(new Error('connect ECONNREFUSED'));

      await expect(service.ping()).resolves.toBe(false);
    });
  });
});
