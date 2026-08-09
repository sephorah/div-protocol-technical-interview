import { ConfigService } from '@nestjs/config';
import { hashPublicToken } from '../crypto/secrets';
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
