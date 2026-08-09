/**
 * What these tests protect: the rotation rules of RFC 9700. A "happy path"
 * suite sees none of them -- rotation, reuse detection and family revocation
 * only show up on the paths where something has gone wrong.
 */

import { ConfigService } from '@nestjs/config';
import { hashPublicToken } from '../crypto/secrets';
import { PrismaService } from '../prisma/prisma.service';
import { RefreshTokenService } from './refresh-token.service';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('RefreshTokenService', () => {
  const findUnique = jest.fn();
  const create = jest.fn();
  const updateMany = jest.fn();
  const deleteMany = jest.fn();
  let service: RefreshTokenService;

  const prisma = {
    refreshToken: { findUnique, create, updateMany, deleteMany },
  } as unknown as PrismaService;

  const storedToken = (overrides: Record<string, unknown> = {}) => ({
    id: 'token-1',
    familyId: 'family-1',
    lawyerId: 'lawyer-1',
    expiresAt: new Date(Date.now() + DAY_MS),
    idleExpiresAt: new Date(Date.now() + 3_600_000),
    revokedAt: null,
    createdAt: new Date(),
    ...overrides,
  });

  const createdData = (): Record<string, unknown> =>
    (create.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;

  beforeEach(() => {
    [findUnique, create, updateMany, deleteMany].forEach((m) => m.mockReset());
    create.mockResolvedValue({});
    updateMany.mockResolvedValue({ count: 1 });

    service = new RefreshTokenService(prisma, {
      getOrThrow: (key: string) => {
        if (key === 'SESSION_EXPIRES') return '7d';
        if (key === 'SESSION_IDLE_EXPIRES') return '3d';
        throw new Error(`unexpected configuration key: ${key}`);
      },
    } as unknown as ConfigService);
  });

  it('stores only the hash of the token it hands out', async () => {
    const token = await service.issue('lawyer-1');

    expect(token).toHaveLength(43); // 32 bytes in base64url
    expect(createdData().tokenHash).toBe(hashPublicToken(token));
    expect(JSON.stringify(createdData())).not.toContain(token);
  });

  it('sets both deadlines at issue: the 7-day ceiling and the 3-day idle', async () => {
    const before = Date.now();
    await service.issue('lawyer-1');

    const { expiresAt, idleExpiresAt } = createdData() as {
      expiresAt: Date;
      idleExpiresAt: Date;
    };
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 7 * DAY_MS - 1000,
    );
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS);
    expect(idleExpiresAt.getTime()).toBeGreaterThanOrEqual(
      before + 3 * DAY_MS - 1000,
    );
    expect(idleExpiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 3 * DAY_MS,
    );
  });

  it('rotates: revokes the presented token and issues a successor in the family', async () => {
    findUnique.mockResolvedValue(storedToken());

    const outcome = await service.rotate('a-token');

    expect(outcome).toEqual({
      status: 'rotated',
      token: expect.any(String) as string,
      lawyerId: 'lawyer-1',
    });
    // Claimed by an atomic compare-and-set, never by a read-then-write.
    expect(updateMany).toHaveBeenCalledWith({
      where: { tokenHash: hashPublicToken('a-token'), revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });
    expect(createdData().familyId).toBe('family-1');
  });

  // The successor must not outlive the session: otherwise a chain rotating
  // every 15 minutes never expires, and "7 days" means nothing.
  it('copies the ceiling onto the successor rather than restarting it', async () => {
    const expiresAt = new Date(Date.now() + 3_600_000);
    findUnique.mockResolvedValue(storedToken({ expiresAt }));

    await service.rotate('a-token');

    expect(createdData().expiresAt).toEqual(expiresAt);
  });

  // The other half of the asymmetry: using the session is precisely what must
  // push the idle deadline back. Copied like the ceiling, the lawyer would be
  // logged out three days after logging in, mid-work.
  it('pushes the idle deadline back on every rotation', async () => {
    findUnique.mockResolvedValue(
      storedToken({ idleExpiresAt: new Date(Date.now() + 60_000) }),
    );

    await service.rotate('a-token');

    const { idleExpiresAt } = createdData() as { idleExpiresAt: Date };
    expect(idleExpiresAt.getTime()).toBeGreaterThan(Date.now() + 2 * DAY_MS);
  });

  it('rejects an unknown token without touching anything', async () => {
    findUnique.mockResolvedValue(null);

    await expect(service.rotate('nope')).resolves.toEqual({
      status: 'rejected',
      reason: 'unknown',
    });
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects a token past the ceiling', async () => {
    findUnique.mockResolvedValue(
      storedToken({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(service.rotate('old')).resolves.toEqual({
      status: 'rejected',
      reason: 'expired',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a token left unused past the idle deadline', async () => {
    findUnique.mockResolvedValue(
      storedToken({ idleExpiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(service.rotate('dormant')).resolves.toEqual({
      status: 'rejected',
      reason: 'expired',
    });
    expect(create).not.toHaveBeenCalled();
  });

  /** THE test of this file: a rotated token presented again means a copy exists. */
  it('revokes the whole family when a rotated token comes back', async () => {
    findUnique.mockResolvedValue(
      storedToken({ revokedAt: new Date(Date.now() - 60_000) }),
    );

    await expect(service.rotate('stolen')).resolves.toEqual({
      status: 'rejected',
      reason: 'reused',
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });
    expect(create).not.toHaveBeenCalled();
  });

  // Two tabs refreshing at once: the second carries the value the first has
  // just rotated. Killing the family here would log the lawyer out for using
  // the application normally.
  it('does not kill the family on a token rotated seconds ago', async () => {
    findUnique.mockResolvedValue(storedToken({ revokedAt: new Date() }));

    await expect(service.rotate('just-rotated')).resolves.toEqual({
      status: 'rejected',
      reason: 'raced',
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  // The compare-and-set lost: another request rotated the same token between
  // the read and the write. Same situation as above, detected differently.
  it('does not kill the family when the claim is lost', async () => {
    findUnique.mockResolvedValue(storedToken());
    updateMany.mockResolvedValue({ count: 0 });

    await expect(service.rotate('contended')).resolves.toEqual({
      status: 'rejected',
      reason: 'raced',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('revokes every active token of the family on logout', async () => {
    findUnique.mockResolvedValue(storedToken());

    await service.revokeFamilyOf('a-token');

    expect(updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });
  });

  it('ignores an unknown token on logout', async () => {
    findUnique.mockResolvedValue(null);

    await expect(service.revokeFamilyOf('nope')).resolves.toBeUndefined();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('purges rows past either deadline', async () => {
    await service.purgeExpired('lawyer-1');

    const [{ where }] = deleteMany.mock.calls[0] as [
      { where: { lawyerId: string; OR: Record<string, unknown>[] } },
    ];
    expect(where.lawyerId).toBe('lawyer-1');
    expect(where.OR).toHaveLength(2);
  });
});
