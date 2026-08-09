/**
 * What these tests protect: the guard's default, which is "closed".
 *
 * The e2e suite covers the nominal paths through HTTP. What is checked here is
 * what an HTTP test would have trouble reaching: the absence of cookie-parser,
 * a token whose account has since disappeared, and the fact that @Public() is
 * read from the handler as well as from the controller.
 */

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { LawyersService } from '../lawyers/lawyers.service';
import { AUTH_COOKIE_NAME } from './auth-cookie';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  const verifyAsync = jest.fn();
  const findById = jest.fn();
  const getAllAndOverride = jest.fn();
  let guard: JwtAuthGuard;
  let request: Record<string, unknown>;

  const contextFor = (req: unknown): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    verifyAsync.mockReset();
    findById.mockReset();
    getAllAndOverride.mockReset();
    getAllAndOverride.mockReturnValue(undefined);

    request = { cookies: { [AUTH_COOKIE_NAME]: 'a.valid.token' } };
    guard = new JwtAuthGuard(
      { verifyAsync } as unknown as JwtService,
      { getAllAndOverride } as unknown as Reflector,
      { findById } as unknown as LawyersService,
    );
  });

  it('lets a valid token through and exposes the profile', async () => {
    verifyAsync.mockResolvedValue({ sub: 'lawyer-1' });
    findById.mockResolvedValue({
      id: 'lawyer-1',
      name: 'Maitre Dupont',
      email: 'avocat@exemple.fr',
      passwordHash: '$argon2id$fake',
      createdAt: new Date(),
    });

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(request.lawyer).toEqual({
      id: 'lawyer-1',
      name: 'Maitre Dupont',
      email: 'avocat@exemple.fr',
    });
  });

  it('does not expose the password hash on the request', async () => {
    verifyAsync.mockResolvedValue({ sub: 'lawyer-1' });
    findById.mockResolvedValue({
      id: 'lawyer-1',
      name: 'Maitre Dupont',
      email: 'avocat@exemple.fr',
      passwordHash: '$argon2id$fake',
      createdAt: new Date(),
    });

    await guard.canActivate(contextFor(request));

    expect(JSON.stringify(request.lawyer)).not.toContain('argon2');
  });

  it('refuses a request with no cookie', async () => {
    await expect(
      guard.canActivate(contextFor({ cookies: {} })),
    ).rejects.toThrow(UnauthorizedException);
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  // Without cookie-parser, request.cookies is undefined. The guard must refuse
  // rather than throw a TypeError, which would answer 500 instead of 401.
  it('refuses when cookie-parser is not wired', async () => {
    await expect(guard.canActivate(contextFor({}))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refuses an invalid or expired token', async () => {
    verifyAsync.mockRejectedValue(new Error('jwt expired'));

    await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
      UnauthorizedException,
    );
    expect(findById).not.toHaveBeenCalled();
  });

  /**
   * The reason the account is re-read on every request: a token signed before
   * the account was deleted stays cryptographically valid for as long as two
   * hours. Rebuilding the profile from the payload would keep letting it in.
   */
  it('refuses a valid token whose account no longer exists', async () => {
    verifyAsync.mockResolvedValue({ sub: 'deleted-lawyer' });
    findById.mockResolvedValue(null);

    await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // A token signed with our own secret but malformed: verifyAsync accepts it
  // (the signature is genuine), and only this check stops an undefined
  // identifier from reaching Prisma, which would answer 500 rather than 401.
  it.each([{}, { sub: '' }, { sub: 42 }])(
    'refuses a token whose payload carries no usable subject (%p)',
    async (payload) => {
      verifyAsync.mockResolvedValue(payload);

      await expect(guard.canActivate(contextFor(request))).rejects.toThrow(
        UnauthorizedException,
      );
      expect(findById).not.toHaveBeenCalled();
    },
  );

  it('lets a @Public() route through without looking at the cookie', async () => {
    getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(contextFor({}))).resolves.toBe(true);
    expect(verifyAsync).not.toHaveBeenCalled();
  });
});
