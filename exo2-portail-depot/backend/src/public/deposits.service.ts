import { Readable } from 'node:stream';
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { buildStorageKey } from '../crypto/secrets';
import { MetricsService } from '../metrics/metrics.service';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { detectFileType } from './file-type';
import { DepositedFileView } from './public.types';
import {
  AllowedMimeType,
  DEPOSIT_RACED,
  FILE_TYPE_REJECTED,
  ITEM_NOT_FOUND,
  isAllowedMimeType,
} from './upload.constants';

/**
 * The bytes, detached from the way they were received: this service knows
 * nothing of multipart, of multer or of Express. That is what lets its tests
 * drive it with a Buffer.
 */
export interface IncomingFile {
  originalName: string;
  buffer: Buffer;
}

/** The columns a deposit response is built from, and no others. */
interface StoredFileRow {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}

@Injectable()
export class DepositsService {
  private readonly logger = new Logger(DepositsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    // MetricsModule is @Global, so no import is added to PublicModule.
    private readonly metrics: MetricsService,
  ) {}

  /**
   * The one accounting point of the route: a branch added to `store` later is
   * counted without anyone remembering to. `rejected_size` is absent on
   * purpose -- multer refuses before this service is reached.
   */
  async deposit(
    requestId: string,
    itemId: string,
    file: IncomingFile,
  ): Promise<DepositedFileView> {
    try {
      const view = await this.store(requestId, itemId, file);
      this.metrics.recordDeposit('success');
      return view;
    } catch (error) {
      this.metrics.recordDeposit(
        error instanceof UnsupportedMediaTypeException
          ? 'rejected_type'
          : 'error',
      );
      throw error;
    }
  }

  /**
   * The order of the steps is load-bearing: the ownership check first, so not a
   * byte is written for a piece the caller does not own; the previous object
   * erased AFTER the new row is written, or a failed putObject would leave the
   * piece with nothing where it had something.
   */
  private async store(
    requestId: string,
    itemId: string,
    file: IncomingFile,
  ): Promise<DepositedFileView> {
    // findFirst on BOTH criteria, never a lookup followed by a comparison:
    // there is then no branch in which the ownership check can be forgotten.
    // A piece belonging to another request answers 404 and not 403 -- a 403
    // would confirm to an anonymous caller that the piece exists elsewhere.
    const item = await this.prisma.requestedItem.findFirst({
      where: { id: itemId, requestId },
      select: { id: true, file: { select: { storageKey: true } } },
    });

    if (item === null) {
      throw new NotFoundException(ITEM_NOT_FOUND);
    }

    // The bytes decide, never the declared Content-Type nor the extension.
    const detected = detectFileType(file.buffer);
    if (detected === null || !isAllowedMimeType(detected)) {
      throw new UnsupportedMediaTypeException(FILE_TYPE_REJECTED);
    }

    const storageKey = buildStorageKey(requestId, itemId, file.originalName);
    const previousKey = item.file?.storageKey ?? null;

    await this.storage.putObject(
      storageKey,
      Readable.from(file.buffer),
      detected,
    );

    const stored = await this.record(itemId, storageKey, file, detected);

    // Only a piece that had nothing can complete the request. Counted on the
    // transition and not on the state after, or a replacement deposit on an
    // already-complete request would count it a second time.
    if (previousKey === null) {
      await this.countIfCompleted(requestId);
    }

    if (previousKey !== null && previousKey !== storageKey) {
      await this.forget(previousKey);
    }

    return {
      itemId,
      originalName: stored.originalName,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      receivedAt: stored.createdAt,
    };
  }

  /**
   * One query, asking how many pieces are still waiting rather than comparing
   * two counts. "Waiting" must mean the SAME thing as isReceived: no file, or a
   * file that is not `complete` -- counting a `failed` one would report a
   * request as completed while the dashboard still shows it pending.
   *
   * Swallowed on failure -- a metric must never turn an accepted deposit into
   * a 500 the client would answer by re-sending the file.
   */
  private async countIfCompleted(requestId: string): Promise<void> {
    try {
      const stillMissing = await this.prisma.requestedItem.count({
        where: { requestId, NOT: { file: { is: { status: 'complete' } } } },
      });

      if (stillMissing === 0) {
        this.metrics.recordRequestCompleted();
      }
    } catch (error) {
      this.logger.error(
        `Could not tell whether request ${requestId} is complete`,
        error,
      );
    }
  }

  /**
   * A second deposit REPLACES, it does not version. The upsert is a read then a
   * write, so it is NOT atomic: the unique index stops the loser with a P2002.
   */
  private async record(
    itemId: string,
    storageKey: string,
    file: IncomingFile,
    mimeType: AllowedMimeType,
  ): Promise<StoredFileRow> {
    const columns = {
      storageKey,
      originalName: file.originalName,
      mimeType,
      // The bytes actually received, not the declared Content-Length: the one
      // number the client must not be trusted on.
      sizeBytes: file.buffer.length,
      status: 'complete',
    } as const;

    try {
      return await this.prisma.uploadedFile.upsert({
        where: { requestedItemId: itemId },
        create: { requestedItemId: itemId, ...columns },
        // createdAt is refreshed on purpose: what the lawyer reads is the
        // receipt time of the file they can open, not of the one it replaced.
        update: { ...columns, createdAt: new Date() },
        select: {
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
      });
    } catch (error) {
      // The object is in the bucket and no row will ever name it. This is the
      // last moment its key is known -- and it runs before the branch below, so
      // turning the race into a 409 cannot create the orphan it exists to
      // avoid.
      await this.forget(storageKey);

      // The loser of a double click deserves a retryable answer rather than an
      // opaque 500. Only P2002: any other database error is rethrown, or we
      // would be telling the client to retry a call that can never succeed.
      if (isUniqueViolation(error)) {
        throw new ConflictException(DEPOSIT_RACED);
      }
      throw error;
    }
  }

  /**
   * Deletes an object nothing points at any more. Logged and swallowed: the
   * deposit itself succeeded, and a 500 here would make the client re-send a
   * file the portal has already accepted. What is left behind is one orphaned
   * object, which deleting the request still erases by prefix.
   */
  private async forget(storageKey: string): Promise<void> {
    try {
      await this.storage.deleteObject(storageKey);
    } catch (error) {
      this.logger.error(
        `Orphaned object left in the bucket: ${storageKey}`,
        error,
      );
    }
  }
}
