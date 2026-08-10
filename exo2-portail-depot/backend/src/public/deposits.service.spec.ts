import {
  ConflictException,
  Logger,
  NotFoundException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DepositsService, IncomingFile } from './deposits.service';

/** The arguments of a mock's first call, typed by the caller. */
const firstCall = (mock: jest.Mock): unknown[] =>
  (mock.mock.calls as unknown[][])[0];

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '22222222-2222-4222-8222-222222222222';

const PDF: IncomingFile = {
  originalName: 'contrat.pdf',
  buffer: Buffer.from('%PDF-1.7\nbody'),
};

/**
 * What this suite protects: the six steps of a deposit in the order that keeps
 * a client from ever losing a file, and the ownership check that must happen
 * before a single byte is written.
 *
 * What it does NOT prove: that MinIO accepts the commands. That is
 * storage.int-spec.ts.
 */
describe('DepositsService', () => {
  let prisma: {
    requestedItem: { findFirst: jest.Mock };
    uploadedFile: { upsert: jest.Mock };
  };
  let storage: { putObject: jest.Mock; deleteObject: jest.Mock };
  let service: DepositsService;

  const storedRow = {
    originalName: 'contrat.pdf',
    mimeType: 'application/pdf',
    sizeBytes: PDF.buffer.length,
    createdAt: new Date('2026-08-10T09:00:00.000Z'),
  };

  beforeAll(() => {
    // The orphan path logs the storage error on purpose; without this the
    // expected trace drowns the test output.
    Logger.overrideLogger(false);
  });

  beforeEach(() => {
    prisma = {
      requestedItem: { findFirst: jest.fn() },
      uploadedFile: { upsert: jest.fn().mockResolvedValue(storedRow) },
    };
    storage = {
      putObject: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    service = new DepositsService(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
    );
  });

  const withItem = (file: { storageKey: string } | null): void => {
    prisma.requestedItem.findFirst.mockResolvedValue({ id: ITEM_ID, file });
  };

  describe('a first deposit', () => {
    it('stores the object then the row, and answers with the receipt', async () => {
      withItem(null);

      const view = await service.deposit(REQUEST_ID, ITEM_ID, PDF);

      expect(view).toEqual({
        itemId: ITEM_ID,
        originalName: 'contrat.pdf',
        mimeType: 'application/pdf',
        sizeBytes: PDF.buffer.length,
        receivedAt: storedRow.createdAt,
      });
      expect(storage.putObject).toHaveBeenCalledTimes(1);
      expect(storage.deleteObject).not.toHaveBeenCalled();
    });

    it('keys the object under the request and the piece', async () => {
      withItem(null);

      await service.deposit(REQUEST_ID, ITEM_ID, PDF);

      // The prefix is what makes deleting a request erase its objects even
      // after the SQL cascade has removed the rows carrying the keys.
      expect(firstCall(storage.putObject)[0] as string).toMatch(
        new RegExp(`^requests/${REQUEST_ID}/items/${ITEM_ID}/`),
      );
    });

    it('records the bytes it received, not a declared size', async () => {
      withItem(null);

      await service.deposit(REQUEST_ID, ITEM_ID, PDF);

      const upsert = firstCall(prisma.uploadedFile.upsert)[0] as {
        create: { sizeBytes: number; status: string };
      };
      expect(upsert.create.sizeBytes).toBe(PDF.buffer.length);
      expect(upsert.create.status).toBe('complete');
    });

    it('stores the type read from the bytes, not the name', async () => {
      withItem(null);

      await service.deposit(REQUEST_ID, ITEM_ID, {
        originalName: 'photo.png',
        buffer: Buffer.from('%PDF-1.7\n'),
      });

      const upsert = firstCall(prisma.uploadedFile.upsert)[0] as {
        create: { mimeType: string };
      };
      expect(upsert.create.mimeType).toBe('application/pdf');
    });
  });

  describe('a piece that is not the session"s to fill', () => {
    it('answers 404 and writes nothing at all', async () => {
      // findFirst returns null both for an unknown piece and for one belonging
      // to another request -- a 403 would confirm that the piece exists
      // somewhere else, which is enough to enumerate another client's file.
      prisma.requestedItem.findFirst.mockResolvedValue(null);

      await expect(
        service.deposit(REQUEST_ID, ITEM_ID, PDF),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(storage.putObject).not.toHaveBeenCalled();
      expect(prisma.uploadedFile.upsert).not.toHaveBeenCalled();
    });

    it('queries on the piece AND the request together', async () => {
      prisma.requestedItem.findFirst.mockResolvedValue(null);

      await expect(service.deposit(REQUEST_ID, ITEM_ID, PDF)).rejects.toThrow();

      expect(firstCall(prisma.requestedItem.findFirst)[0]).toMatchObject({
        where: { id: ITEM_ID, requestId: REQUEST_ID },
      });
    });
  });

  describe('a file whose bytes are not an allowed format', () => {
    it('answers 415 before writing anything', async () => {
      withItem(null);

      // An .exe renamed .pdf: the extension and the declared Content-Type both
      // say PDF, and the first bytes say MZ.
      await expect(
        service.deposit(REQUEST_ID, ITEM_ID, {
          originalName: 'contrat.pdf',
          buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00]),
        }),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);

      expect(storage.putObject).not.toHaveBeenCalled();
      expect(prisma.uploadedFile.upsert).not.toHaveBeenCalled();
    });

    it('leaves an already deposited file untouched', async () => {
      // The real failure: a refused replacement erasing a valid file. The
      // client would end up with nothing where they had something.
      withItem({ storageKey: 'requests/r/items/i/old-bail.pdf' });

      await expect(
        service.deposit(REQUEST_ID, ITEM_ID, {
          originalName: 'x.pdf',
          buffer: Buffer.from('not a pdf'),
        }),
      ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);

      expect(storage.deleteObject).not.toHaveBeenCalled();
    });
  });

  describe('a second deposit on the same piece', () => {
    const previousKey = 'requests/r/items/i/dead-old.pdf';

    it('deletes the previous object', async () => {
      // Without this the bucket keeps the first file forever: the row that
      // carried its key has just been overwritten, so no query can find it
      // again.
      withItem({ storageKey: previousKey });

      await service.deposit(REQUEST_ID, ITEM_ID, PDF);

      expect(storage.deleteObject).toHaveBeenCalledWith(previousKey);
    });

    it('deletes it only after the new one is written and recorded', async () => {
      // The order is the whole safety: reversed, a putObject that fails would
      // leave the piece with no file at all when it had one.
      withItem({ storageKey: previousKey });
      const order: string[] = [];
      storage.putObject.mockImplementation(() => {
        order.push('put');
        return Promise.resolve();
      });
      prisma.uploadedFile.upsert.mockImplementation(() => {
        order.push('upsert');
        return Promise.resolve(storedRow);
      });
      storage.deleteObject.mockImplementation(() => {
        order.push('delete');
        return Promise.resolve();
      });

      await service.deposit(REQUEST_ID, ITEM_ID, PDF);

      expect(order).toEqual(['put', 'upsert', 'delete']);
    });

    it('keeps the previous object when the new one cannot be written', async () => {
      withItem({ storageKey: previousKey });
      storage.putObject.mockRejectedValue(new Error('storage full'));

      await expect(service.deposit(REQUEST_ID, ITEM_ID, PDF)).rejects.toThrow(
        'storage full',
      );

      expect(storage.deleteObject).not.toHaveBeenCalled();
    });

    it('still answers 201 when erasing the previous object fails', async () => {
      // The deposit succeeded. A 500 here would make the client re-send a file
      // the portal already holds; what is left behind is one orphan, which
      // deleting the request still erases by prefix.
      withItem({ storageKey: previousKey });
      storage.deleteObject.mockRejectedValue(new Error('AccessDenied'));

      await expect(
        service.deposit(REQUEST_ID, ITEM_ID, PDF),
      ).resolves.toMatchObject({ itemId: ITEM_ID });
    });
  });

  describe('two deposits racing on the same piece', () => {
    /** What Prisma raises when the unique index on requestedItemId fires. */
    const uniqueViolation = Object.assign(
      new Error('Unique constraint failed on the fields: (`requestedItemId`)'),
      { code: 'P2002' },
    );

    it('answers 409 rather than 500 to the loser', async () => {
      // A double click on the send button: the upsert reads no row twice, both
      // insert, and the second hits the index. A 500 tells the client the
      // portal is broken when retrying is all it takes.
      withItem(null);
      prisma.uploadedFile.upsert.mockRejectedValue(uniqueViolation);

      await expect(
        service.deposit(REQUEST_ID, ITEM_ID, PDF),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('erases the object the loser just wrote', async () => {
      // Otherwise fixing the 500 creates the orphan it claims to avoid: the
      // winner's row names another key, so nothing points at this object ever
      // again.
      withItem(null);
      prisma.uploadedFile.upsert.mockRejectedValue(uniqueViolation);

      await expect(service.deposit(REQUEST_ID, ITEM_ID, PDF)).rejects.toThrow();

      const writtenKey = firstCall(storage.putObject)[0] as string;
      expect(storage.deleteObject).toHaveBeenCalledWith(writtenKey);
    });

    it('leaves any other database error untouched', async () => {
      // Swallowing every failure into a 409 would invite the client to retry a
      // call that can never succeed.
      withItem(null);
      prisma.uploadedFile.upsert.mockRejectedValue(
        Object.assign(new Error('column does not exist'), { code: 'P2022' }),
      );

      await expect(service.deposit(REQUEST_ID, ITEM_ID, PDF)).rejects.toThrow(
        'column does not exist',
      );
      await expect(
        service.deposit(REQUEST_ID, ITEM_ID, PDF),
      ).rejects.not.toBeInstanceOf(ConflictException);
    });
  });

  it('erases the object it just wrote when the row cannot be saved', async () => {
    // Otherwise the bucket grows an object no row will ever name, and this is
    // the last moment its key is known.
    withItem(null);
    prisma.uploadedFile.upsert.mockRejectedValue(new Error('deadlock'));

    await expect(service.deposit(REQUEST_ID, ITEM_ID, PDF)).rejects.toThrow(
      'deadlock',
    );

    const writtenKey = firstCall(storage.putObject)[0] as string;
    expect(storage.deleteObject).toHaveBeenCalledWith(writtenKey);
  });
});
