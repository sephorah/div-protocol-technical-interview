import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hashPublicToken, verifySecret } from '../crypto/secrets';
import { PrismaService } from '../prisma/prisma.service';
import { PublicLinksService } from './public-links.service';

const ORIGIN = 'https://portail.example.test';
const NOW = new Date('2026-08-09T12:00:00.000Z');
const LATER = new Date('2026-08-20T12:00:00.000Z');
const TOKEN = 'a-token';

const configDouble = (): ConfigService =>
  ({ getOrThrow: () => ORIGIN }) as unknown as ConfigService;

/**
 * What this suite protects: that expiry and revocation are actually applied.
 * Before B3, expiresAt was written at creation and read by nobody -- a link
 * stayed usable forever, and no test failed.
 */
describe('PublicLinksService.resolve', () => {
  const findUnique = jest.fn();
  const prisma = { publicLink: { findUnique } } as unknown as PrismaService;
  const service = new PublicLinksService(prisma, configDouble());

  const row = {
    id: 'link-1',
    tokenHash: hashPublicToken(TOKEN),
    pinHash: 'hash',
    expiresAt: LATER,
    revokedAt: null as Date | null,
    createdAt: NOW,
    requestId: 'request-1',
    request: { id: 'request-1', title: 'Dossier Martin' },
  };

  beforeEach(() => findUnique.mockReset());

  it('looks the link up by the HASH of the token, never by the token', async () => {
    findUnique.mockResolvedValue(row);
    await service.resolve(TOKEN, NOW);

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashPublicToken(TOKEN) } }),
    );
  });

  it('resolves an active link', async () => {
    findUnique.mockResolvedValue(row);
    await expect(service.resolve(TOKEN, NOW)).resolves.toMatchObject({
      outcome: 'ok',
      request: { id: 'request-1' },
    });
  });

  it('hands back only what a caller needs, tokenHash excluded', async () => {
    // pinHash is here because verifying the PIN is exactly what C1 does with
    // it. tokenHash is not, and neither is anything else the table may gain:
    // an exhaustive key list is what stops a future column from reaching an
    // anonymous response.
    findUnique.mockResolvedValue(row);
    const result = await service.resolve(TOKEN, NOW);

    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') return;
    expect(Object.keys(result.link).sort()).toEqual([
      'expiresAt',
      'id',
      'pinHash',
    ]);
  });

  it('reports an unknown token', async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.resolve(TOKEN, NOW)).resolves.toEqual({
      outcome: 'unknown',
    });
  });

  it('reports a revoked link', async () => {
    findUnique.mockResolvedValue({ ...row, revokedAt: NOW });
    await expect(service.resolve(TOKEN, NOW)).resolves.toEqual({
      outcome: 'revoked',
    });
  });

  it('reports an expired link', async () => {
    findUnique.mockResolvedValue({ ...row, expiresAt: NOW });
    await expect(
      service.resolve(TOKEN, new Date(NOW.getTime() + 1)),
    ).resolves.toEqual({ outcome: 'expired' });
  });

  it('still resolves at the exact expiry instant', async () => {
    findUnique.mockResolvedValue({ ...row, expiresAt: NOW });
    await expect(service.resolve(TOKEN, NOW)).resolves.toMatchObject({
      outcome: 'ok',
    });
  });

  it('prefers "revoked" over "expired" on a link that is both', async () => {
    // Revocation is a decision, expiry is the clock. Reporting the decision
    // first is what will let G2 tell "the lawyer cut it" from "time ran out".
    findUnique.mockResolvedValue({ ...row, revokedAt: NOW, expiresAt: NOW });
    await expect(
      service.resolve(TOKEN, new Date(NOW.getTime() + 1)),
    ).resolves.toEqual({ outcome: 'revoked' });
  });
});

/**
 * What this suite protects: that regenerating really REPLACES -- old link
 * revoked, new secrets drawn -- and that a request belonging to someone else is
 * indistinguishable from one that does not exist.
 */
describe('PublicLinksService.regenerate', () => {
  const findFirst = jest.fn();
  const updateMany = jest.fn();
  const create = jest.fn();

  const prismaDouble = {
    depositRequest: { findFirst },
    publicLink: { updateMany, create },
    $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(prismaDouble),
  };
  const prisma = prismaDouble as unknown as PrismaService;
  const service = new PublicLinksService(prisma, configDouble());

  /** The row handed to Prisma by the call under test. */
  interface WrittenLink {
    requestId: string;
    tokenHash: string;
    pinHash: string;
    expiresAt: Date;
  }

  const written = (call = 0): WrittenLink => {
    const [{ data }] = create.mock.calls[call] as [{ data: WrittenLink }];
    return data;
  };

  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue({ id: 'request-1' });
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    create.mockReset().mockResolvedValue({ id: 'link-2' });
  });

  it('answers 404 on a request owned by another lawyer', async () => {
    // 404 and not 403: a 403 confirms the id exists somewhere, which is enough
    // to enumerate another practice's caseload.
    findFirst.mockResolvedValue(null);

    await expect(
      service.regenerate('request-1', 'lawyer-2', 14),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(create).not.toHaveBeenCalled();
  });

  it('scopes the ownership lookup to the caller', async () => {
    await service.regenerate('request-1', 'lawyer-1', 14);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'request-1', lawyerId: 'lawyer-1' },
      }),
    );
  });

  it('revokes the active link before creating the new one', async () => {
    await service.regenerate('request-1', 'lawyer-1', 14);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requestId: 'request-1', revokedAt: null },
      }),
    );
    expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      create.mock.invocationCallOrder[0],
    );
  });

  it('stores hashes, never the token nor the PIN it returns', async () => {
    const issued = await service.regenerate('request-1', 'lawyer-1', 14);
    const link = written();

    expect(link.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(link.tokenHash).toBe(
      hashPublicToken(
        decodeURIComponent(issued.url.slice(`${ORIGIN}/depot/`.length)),
      ),
    );
    await expect(verifySecret(issued.pin, link.pinHash)).resolves.toBe(true);
    // Exhaustive, so that a future column carrying a secret cannot join the
    // write unnoticed.
    expect(Object.keys(link).sort()).toEqual([
      'expiresAt',
      'pinHash',
      'requestId',
      'tokenHash',
    ]);
  });

  it('draws a different token and PIN on every call', async () => {
    const first = await service.regenerate('request-1', 'lawyer-1', 14);
    const second = await service.regenerate('request-1', 'lawyer-1', 14);

    expect(first.url).not.toBe(second.url);
    expect(written(0).tokenHash).not.toBe(written(1).tokenHash);
    expect(written(0).pinHash).not.toBe(written(1).pinHash);
  });

  it('dates the expiry from now, not from the previous link', async () => {
    const before = Date.now();
    const issued = await service.regenerate('request-1', 'lawyer-1', 2);

    expect(issued.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 2 * 24 * 60 * 60 * 1000,
    );
    expect(written().expiresAt).toEqual(issued.expiresAt);
  });

  it('succeeds on a request that has no link left to revoke', async () => {
    // The path a revoked request takes: updateMany touches nothing, and the
    // creation must still go through.
    updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.regenerate('request-1', 'lawyer-1', 14),
    ).resolves.toMatchObject({
      pin: expect.stringMatching(/^\d{4}$/) as string,
    });
  });

  it('translates the partial unique index violation into a 409', async () => {
    // Two concurrent regenerations: the partial unique index is what forbids
    // two active links, and the loser must not surface as an opaque 500.
    create.mockRejectedValue(
      Object.assign(new Error('unique constraint'), { code: 'P2002' }),
    );

    await expect(
      service.regenerate('request-1', 'lawyer-1', 14),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lets any other database error through unchanged', async () => {
    // Swallowing everything into a 409 would tell the lawyer to retry a call
    // that can never succeed.
    create.mockRejectedValue(new Error('connection refused'));

    await expect(
      service.regenerate('request-1', 'lawyer-1', 14),
    ).rejects.toThrow('connection refused');
  });
});

describe('PublicLinksService.revoke', () => {
  const findFirst = jest.fn();
  const updateMany = jest.fn();
  const prisma = {
    depositRequest: { findFirst },
    publicLink: { updateMany },
  } as unknown as PrismaService;
  const service = new PublicLinksService(prisma, configDouble());

  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue({ id: 'request-1' });
    updateMany.mockReset().mockResolvedValue({ count: 1 });
  });

  it('answers 404 on a request owned by another lawyer', async () => {
    findFirst.mockResolvedValue(null);

    await expect(
      service.revoke('request-1', 'lawyer-2'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('revokes only the active link of that request', async () => {
    await service.revoke('request-1', 'lawyer-1');

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requestId: 'request-1', revokedAt: null },
      }),
    );
  });

  it('is idempotent: revoking twice does not fail', async () => {
    // A double click must not read as an error: the requested outcome --
    // nobody gets in -- holds either way.
    updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.revoke('request-1', 'lawyer-1'),
    ).resolves.toBeUndefined();
  });
});
