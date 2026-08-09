/**
 * What these tests protect: the two properties of the login path that no
 * "happy" test can see.
 *
 * 1. An unknown address and a wrong password are indistinguishable -- same
 *    message, and above all the same work performed, so the response time does
 *    not reveal which accounts exist.
 * 2. The password hash never leaves the service.
 */

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hashSecret } from '../crypto/secrets';
import { Lawyer } from '../generated/prisma/client';
import { LawyersService } from '../lawyers/lawyers.service';
import { AuthService, INVALID_CREDENTIALS } from './auth.service';

describe('AuthService', () => {
  const password = 'un-mot-de-passe-de-test';
  let lawyer: Lawyer;
  let service: AuthService;
  const findByEmail = jest.fn();
  const signAsync = jest.fn();
  // Answers per key rather than returning '2h' whatever it is asked: otherwise
  // the sessionMaxAgeMs test would still pass if the code read JWT_SECRET.
  const getOrThrow = jest.fn((key: string) => {
    if (key === 'JWT_EXPIRES') {
      return '2h';
    }
    throw new Error(`unexpected configuration key: ${key}`);
  });

  beforeAll(async () => {
    lawyer = {
      id: 'lawyer-1',
      name: 'Maitre Dupont',
      email: 'avocat@exemple.fr',
      // A real argon2id hash, computed here: no hash on disk, and the test
      // exercises the actual verification rather than a stub of it.
      passwordHash: await hashSecret(password),
      createdAt: new Date(),
    };
  });

  beforeEach(async () => {
    findByEmail.mockReset();
    signAsync.mockReset();
    signAsync.mockResolvedValue('signed.jwt.token');

    getOrThrow.mockClear();
    service = new AuthService(
      { findByEmail } as unknown as LawyersService,
      { signAsync } as unknown as JwtService,
      { getOrThrow } as unknown as ConfigService,
    );
    // The decoy hash is normally computed by Nest before the first request.
    await service.onModuleInit();
  });

  it('returns the profile on valid credentials', async () => {
    findByEmail.mockResolvedValue(lawyer);

    await expect(
      service.validateLawyer('avocat@exemple.fr', password),
    ).resolves.toEqual({
      id: 'lawyer-1',
      name: 'Maitre Dupont',
      email: 'avocat@exemple.fr',
    });
  });

  it('never returns the password hash', async () => {
    findByEmail.mockResolvedValue(lawyer);

    const profile = await service.validateLawyer('avocat@exemple.fr', password);

    expect(Object.keys(profile)).toEqual(['id', 'name', 'email']);
    expect(JSON.stringify(profile)).not.toContain('argon2');
  });

  it('rejects a wrong password', async () => {
    findByEmail.mockResolvedValue(lawyer);

    await expect(
      service.validateLawyer('avocat@exemple.fr', 'mauvais'),
    ).rejects.toThrow(new UnauthorizedException(INVALID_CREDENTIALS));
  });

  it('rejects an unknown address with the same message', async () => {
    findByEmail.mockResolvedValue(null);

    await expect(
      service.validateLawyer('inconnu@exemple.fr', password),
    ).rejects.toThrow(new UnauthorizedException(INVALID_CREDENTIALS));
  });

  /**
   * The point of the decoy hash, and the reason it cannot be asserted by
   * reading the code: what matters is that the argon2id verification runs even
   * when there is no account.
   *
   * Measured rather than timed: comparing durations would make the test flaky
   * on a loaded machine. The two paths are compared to each other with a wide
   * margin -- an early return would put the unknown-address case at well under
   * a millisecond, against tens of milliseconds for a real verification.
   */
  it('spends comparable time on an unknown address and a wrong password', async () => {
    findByEmail.mockResolvedValue(lawyer);
    const startKnown = performance.now();
    await service
      .validateLawyer('avocat@exemple.fr', 'mauvais')
      .catch(() => undefined);
    const knownMs = performance.now() - startKnown;

    findByEmail.mockResolvedValue(null);
    const startUnknown = performance.now();
    await service
      .validateLawyer('inconnu@exemple.fr', 'mauvais')
      .catch(() => undefined);
    const unknownMs = performance.now() - startUnknown;

    // A tenth of the known-account path is already far more than an early
    // return would cost.
    expect(unknownMs).toBeGreaterThan(knownMs / 10);
  });

  it('signs a token carrying the identifier and nothing else', async () => {
    await service.issueToken({
      id: 'lawyer-1',
      name: 'Maitre Dupont',
      email: 'avocat@exemple.fr',
    });

    expect(signAsync).toHaveBeenCalledWith({ sub: 'lawyer-1' });
  });

  it('derives the cookie lifetime from JWT_EXPIRES', () => {
    expect(service.sessionMaxAgeMs()).toBe(7_200_000);
    expect(getOrThrow).toHaveBeenCalledWith('JWT_EXPIRES');
  });
});
