import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** DeleteObjects accepts at most 1000 keys per call. */
const DELETE_BATCH_SIZE = 1000;

/**
 * Object storage behind an S3 interface. NOTHING here names MinIO -- only the
 * endpoint knows -- and no method ever touches the local filesystem.
 */
@Injectable()
export class StorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('STORAGE_BUCKET');
    this.client = new S3Client({
      endpoint: config.getOrThrow<string>('STORAGE_ENDPOINT'),
      region: config.getOrThrow<string>('STORAGE_REGION'),
      credentials: {
        accessKeyId: config.getOrThrow<string>('STORAGE_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow<string>('STORAGE_SECRET_KEY'),
      },
      // MinIO has no virtual-hosted DNS: `bucket.host` does not resolve, so the
      // bucket has to travel in the path.
      forcePathStyle: true,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.assertBucketExists();
  }

  onModuleDestroy(): void {
    this.client.destroy();
  }

  /**
   * Checks, and NEVER creates: provisioning belongs to minio-init, and creating
   * here would force this service to hold root credentials. Failing is also
   * what catches a misspelt STORAGE_BUCKET, which would otherwise create a
   * parallel bucket and appear to work.
   */
  async assertBucketExists(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      // The two causes need different messages: they send whoever reads the
      // startup failure to opposite places.
      if (this.isNotFound(error)) {
        throw new Error(
          `Bucket "${this.bucket}" does not exist. Provisioning (minio-init) ` +
            'has not run, or STORAGE_BUCKET does not name the provisioned bucket.',
        );
      }
      if (this.isForbidden(error)) {
        throw new Error(
          `Access to bucket "${this.bucket}" was denied. STORAGE_ACCESS_KEY / ` +
            'STORAGE_SECRET_KEY are wrong, or the portail-app policy is not attached.',
        );
      }
      throw error;
    }
  }

  /**
   * `Upload` and not `PutObjectCommand`: the latter requires ContentLength,
   * which could only come from the client's declared header -- the one value
   * that must not be trusted. Do not "simplify" it back.
   */
  async putObject(
    key: string,
    body: Readable,
    contentType: string,
  ): Promise<void> {
    await new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      },
    }).done();
  }

  async getObjectStream(key: string): Promise<Readable> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );

    if (response.Body === undefined) {
      throw new Error(`Object "${key}" has no body`);
    }

    return response.Body as Readable;
  }

  /**
   * For the one case where the key is still known: replacing a deposited file,
   * where the row carrying the old key is about to be overwritten. Idempotent
   * on S3, so a retry is safe.
   */
  async deleteObject(key: string): Promise<void> {
    if (key.length === 0) {
      throw new Error('deleteObject requires a non-empty key');
    }

    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  /**
   * By prefix and never by list of keys: UploadedFile rows cascade with their
   * request, so once the SQL delete has run no query can name the objects.
   */
  async deleteByPrefix(prefix: string): Promise<number> {
    if (prefix.length === 0) {
      // An empty prefix matches the whole bucket. Refusing beats deleting
      // everything because a caller passed an id it had not loaded yet.
      throw new Error('deleteByPrefix requires a non-empty prefix');
    }

    let deleted = 0;
    let continuationToken: string | undefined;

    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          MaxKeys: DELETE_BATCH_SIZE,
          ContinuationToken: continuationToken,
        }),
      );

      const keys = (listed.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => key !== undefined);

      if (keys.length > 0) {
        const result = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: keys.map((Key) => ({ Key })) },
          }),
        );

        // DeleteObjects does not throw on a per-key failure: it answers 200 with
        // the failures in Errors. Counting the keys sent would report objects as
        // erased while they are still there, and the caller would never know to
        // retry.
        const failures = result.Errors ?? [];
        if (failures.length > 0) {
          throw new Error(
            `Failed to delete ${String(failures.length)} object(s) under "${prefix}": ` +
              failures
                .map(
                  (failure) => `${failure.Key ?? '?'} (${failure.Code ?? '?'})`,
                )
                .join(', '),
          );
        }

        deleted += result.Deleted?.length ?? keys.length;
      }

      continuationToken = listed.IsTruncated
        ? listed.NextContinuationToken
        : undefined;
    } while (continuationToken !== undefined);

    return deleted;
  }

  /** Never throws: the health probe reports a state, it does not fail on one. */
  async ping(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch (error) {
      this.logger.error('Health probe: object storage is unreachable', error);
      return false;
    }
  }

  private isNotFound(error: unknown): boolean {
    // MinIO answers HeadBucket with a bodyless 404, so the SDK cannot always
    // name the error: the status code is the only reliable signal.
    return (
      this.statusOf(error) === 404 ||
      ['NotFound', 'NoSuchBucket'].includes(this.nameOf(error))
    );
  }

  private isForbidden(error: unknown): boolean {
    return (
      this.statusOf(error) === 403 ||
      ['AccessDenied', 'Forbidden', 'InvalidAccessKeyId'].includes(
        this.nameOf(error),
      )
    );
  }

  private statusOf(error: unknown): number | undefined {
    return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata
      ?.httpStatusCode;
  }

  private nameOf(error: unknown): string {
    return (error as { name?: string })?.name ?? '';
  }
}
