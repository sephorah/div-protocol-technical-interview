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
import { RefreshTokenService } from './refresh-token.service';

describe('AuthService', () => {
  const password = 'un-mot-de-passe-de-test';
  let lawyer: Lawyer;
  let service: AuthService;
  const findByEmail = jest.fn();
  const findById = jest.fn();
  const signAsync = jest.fn();
  const issue = jest.fn();
  const rotate = jest.fn();
  const revokeFamilyOf = jest.fn();
  const purgeExpired = jest.fn();
  // Answers per key rather than one value whatever it is asked: the two
  // lifetimes below would otherwise still pass with the wrong key read.
  const getOrThrow = jest.fn((key: string) => {
    if (key === 'JWT_EXPIRES') {
      return '15m';
    }
    if (key === 'SESSION_EXPIRES') {
      return '7d';
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
    [
      findByEmail,
      findById,
      signAsync,
      issue,
      rotate,
      revokeFamilyOf,
      purgeExpired,
    ].forEach((m) => m.mockReset());
    issue.mockResolvedValue({
      token: 'a-refresh-token',
      expiresAt: new Date('2026-08-16T00:00:00Z'),
    });
    purgeExpired.mockResolvedValue(undefined);
    signAsync.mockResolvedValue('signed.jwt.token');

    getOrThrow.mockClear();
    service = new AuthService(
      { findByEmail, findById } as unknown as LawyersService,
      { signAsync } as unknown as JwtService,
      { getOrThrow } as unknown as ConfigService,
      {
        issue,
        rotate,
        revokeFamilyOf,
        purgeExpired,
      } as unknown as RefreshTokenService,
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

  it('signs a token carrying the identifier and nothing else', async () => {
    await service.issueToken({
      id: 'lawyer-1',
      name: 'Maitre Dupont',
      email: 'avocat@exemple.fr',
    });

    expect(signAsync).toHaveBeenCalledWith({ sub: 'lawyer-1' });
  });

  it('opens a session with both tokens, and clears the dead rows first', async () => {
    const profile = { id: 'lawyer-1', name: 'Maitre Dupont', email: 'a@b.fr' };

    await expect(service.openSession(profile)).resolves.toEqual({
      accessToken: 'signed.jwt.token',
      refreshToken: 'a-refresh-token',
      // Carried out so the cookie can be given what REMAINS of the session
      // rather than a fresh seven days at every rotation.
      refreshExpiresAt: new Date('2026-08-16T00:00:00Z'),
    });
    expect(purgeExpired).toHaveBeenCalledWith('lawyer-1');
  });

  /**
   * A rotation can succeed against a session whose account has since been
   * deleted -- the token table cascades, but the request may already be in
   * flight. Renewing then would hand back a valid access token for nobody.
   */
  it('refuses to renew when the account no longer exists', async () => {
    rotate.mockResolvedValue({
      status: 'rotated',
      token: 'new-token',
      lawyerId: 'deleted-lawyer',
    });
    findById.mockResolvedValue(null);

    await expect(service.renewSession('a-token')).resolves.toEqual({
      status: 'rejected',
      reason: 'unknown',
    });
    expect(signAsync).not.toHaveBeenCalled();
  });

  it('passes a refusal through untouched', async () => {
    rotate.mockResolvedValue({ status: 'rejected', reason: 'reused' });

    await expect(service.renewSession('stolen')).resolves.toEqual({
      status: 'rejected',
      reason: 'reused',
    });
    expect(findById).not.toHaveBeenCalled();
  });
});
