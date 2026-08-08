import { Readable } from 'node:stream';
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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

  /** The command objects sent so far, in order. */
  const sent = (): object[] =>
    send.mock.calls.map(([command]: [object]) => command);

  /** The same, flattened to constructor name + input, for order assertions. */
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

  describe('ensureBucket', () => {
    it('does not recreate a bucket that already exists', async () => {
      send.mockResolvedValue({});

      await service.ensureBucket();

      expect(send).toHaveBeenCalledTimes(1);
      expect(sent()[0]).toBeInstanceOf(HeadBucketCommand);
    });

    it('creates the bucket when it is missing', async () => {
      send.mockRejectedValueOnce(notFound()).mockResolvedValueOnce({});

      await service.ensureBucket();

      const commands = sentCommands();
      expect(commands[1].type).toBe(CreateBucketCommand.name);
      expect(commands[1].input).toMatchObject({ Bucket: bucket });
    });

    it('rethrows an error that is not an absence', async () => {
      // A 403 means the credentials are wrong. Treating it as "missing" would
      // attempt a creation and hide the real cause behind a second failure.
      send.mockRejectedValue(
        Object.assign(new Error('Forbidden'), {
          name: 'Forbidden',
          $metadata: { httpStatusCode: 403 },
        }),
      );

      await expect(service.ensureBucket()).rejects.toThrow('Forbidden');
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('is what onModuleInit runs, so the bucket exists before Nest listens', async () => {
      send.mockResolvedValue({});

      await service.onModuleInit();

      expect(sent()[0]).toBeInstanceOf(HeadBucketCommand);
    });
  });

  describe('putObject', () => {
    it('writes the stream to the configured bucket and key', async () => {
      send.mockResolvedValue({ ETag: '"abc"' });

      await service.putObject(
        'requests/r1/items/i1/deadbeef-contrat.pdf',
        Readable.from([Buffer.from('hello')]),
        'application/pdf',
      );

      const commands = sentCommands();
      expect(commands[0].type).toBe(PutObjectCommand.name);
      expect(commands[0].input).toMatchObject({
        Bucket: bucket,
        Key: 'requests/r1/items/i1/deadbeef-contrat.pdf',
        ContentType: 'application/pdf',
      });
    });

    it('propagates a write failure instead of silently losing the file', async () => {
      send.mockRejectedValue(new Error('storage full'));

      await expect(
        service.putObject('k', Readable.from([Buffer.from('x')]), 'text/plain'),
      ).rejects.toThrow('storage full');
    });
  });

  describe('getObjectStream', () => {
    it('returns the object body', async () => {
      const body = Readable.from([Buffer.from('content')]);
      send.mockResolvedValue({ Body: body });

      await expect(service.getObjectStream('k')).resolves.toBe(body);
      expect(sent()[0]).toBeInstanceOf(GetObjectCommand);
    });

    it('fails explicitly on a bodyless response', async () => {
      send.mockResolvedValue({});

      await expect(service.getObjectStream('k')).rejects.toThrow('no body');
    });
  });

  describe('deleteByPrefix', () => {
    it('deletes every listed object', async () => {
      send
        .mockResolvedValueOnce({
          Contents: [{ Key: 'requests/r1/a' }, { Key: 'requests/r1/b' }],
          IsTruncated: false,
        })
        .mockResolvedValueOnce({});

      await expect(service.deleteByPrefix('requests/r1/')).resolves.toBe(2);

      const commands = sentCommands();
      expect(commands[0].type).toBe(ListObjectsV2Command.name);
      expect(commands[0].input).toMatchObject({ Prefix: 'requests/r1/' });
      expect(commands[1].type).toBe(DeleteObjectsCommand.name);
      expect(commands[1].input).toMatchObject({
        Delete: {
          Objects: [{ Key: 'requests/r1/a' }, { Key: 'requests/r1/b' }],
        },
      });
    });

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

    it('sends no deletion when the prefix matches nothing', async () => {
      send.mockResolvedValue({ Contents: [], IsTruncated: false });

      await expect(service.deleteByPrefix('requests/r1/')).resolves.toBe(0);
      expect(
        sentCommands().some(
          (command) => command.type === DeleteObjectsCommand.name,
        ),
      ).toBe(false);
    });

    it('refuses an empty prefix, which would match the whole bucket', async () => {
      await expect(service.deleteByPrefix('')).rejects.toThrow('non-empty');
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('ping', () => {
    it('is true when the bucket answers', async () => {
      send.mockResolvedValue({});

      await expect(service.ping()).resolves.toBe(true);
    });

    it('is false instead of throwing when the storage is unreachable', async () => {
      // The health probe reports a state; a throwing ping would turn a 503 into
      // a 500 and lose the "which dependency" information.
      send.mockRejectedValue(new Error('connect ECONNREFUSED'));

      await expect(service.ping()).resolves.toBe(false);
    });
  });
});
