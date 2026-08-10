/**
 * What this suite protects: the boundary between the two populations, and the
 * fact that a revocation cuts a session that is ALREADY open.
 *
 * Both failures are silent in production. A client token accepted by the
 * lawyer's guard reads a dashboard and nothing logs it; a revoked link whose
 * holder keeps depositing makes DELETE /requests/:id/link a button that
 * answers 204 and does nothing.
 */

import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AUTH_COOKIE_NAME } from '../auth/auth-cookie';
import { PrismaService } from '../prisma/prisma.service';
import { CLIENT_COOKIE_NAME, ClientSessionPayload } from './client-session';
import { ClientSessionGuard } from './client-session.guard';

const LAWYER_SECRET = 'lawyer-secret-of-at-least-32-characters';
const CLIENT_SECRET = 'client-secret-of-at-least-32-characters';

const LINK_ID = 'link-1';
const REQUEST_ID = 'request-1';

const IN_ONE_HOUR = new Date(Date.now() + 60 * 60 * 1000);
const AN_HOUR_AGO = new Date(Date.now() - 60 * 60 * 1000);

// getHandler/getClass return real objects: Reflector reads metadata off them,
// and `undefined` makes Reflect.getMetadata throw before any guard logic runs.
class NoHandler {}
const noHandler = (): void => undefined;

const contextWith = (cookies: Record<string, string>): ExecutionContext => {
  const request = { cookies };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => noHandler,
    getClass: () => NoHandler,
  } as unknown as ExecutionContext;
};

describe('ClientSessionGuard', () => {
  const clientJwt = new JwtService({ secret: CLIENT_SECRET });
  const lawyerJwt = new JwtService({ secret: LAWYER_SECRET });

  const payload: ClientSessionPayload = {
    typ: 'client',
    linkId: LINK_ID,
    requestId: REQUEST_ID,
  };

  let prisma: { publicLink: { findUnique: jest.Mock } };
  let guard: ClientSessionGuard;

  const activeLink = {
    id: LINK_ID,
    requestId: REQUEST_ID,
    expiresAt: IN_ONE_HOUR,
    revokedAt: null,
  };

  beforeEach(() => {
    prisma = { publicLink: { findUnique: jest.fn() } };
    guard = new ClientSessionGuard(
      clientJwt,
      prisma as unknown as PrismaService,
    );
  });

  const activateWith = (token: string): Promise<boolean> =>
    guard.canActivate(contextWith({ [CLIENT_COOKIE_NAME]: token }));

  it('opens the route and exposes the link read from the database', async () => {
    prisma.publicLink.findUnique.mockResolvedValue(activeLink);
    const context = contextWith({
      [CLIENT_COOKIE_NAME]: await clientJwt.signAsync(payload),
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(context.switchToHttp().getRequest<object>()).toMatchObject({
      clientSession: {
        linkId: LINK_ID,
        requestId: REQUEST_ID,
        expiresAt: IN_ONE_HOUR,
      },
    });
  });

  // RFC 8725 (BCP 225) section 3.8: distinct keys per population. Signed with
  // the lawyer's secret, the refusal happens in the cryptography rather than in
  // an `if` a refactor can delete without any signature test noticing.
  it('refuses a session token signed with the lawyer secret', async () => {
    const forged = await lawyerJwt.signAsync(payload);

    await expect(activateWith(forged)).rejects.toThrow(UnauthorizedException);
    expect(prisma.publicLink.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a payload that is not a client session', async () => {
    const lawyerShaped = await clientJwt.signAsync({ sub: 'lawyer-1' });

    await expect(activateWith(lawyerShaped)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refuses a request carrying no client cookie', async () => {
    await expect(guard.canActivate(contextWith({}))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // The reason the session carries linkId and not just requestId: the token is
  // valid for 30 minutes and cannot be recalled, so the only thing that makes a
  // revocation effective is re-reading the link on every request.
  it('refuses a session whose link has been revoked since the unlock', async () => {
    prisma.publicLink.findUnique.mockResolvedValue({
      ...activeLink,
      revokedAt: new Date(),
    });

    await expect(activateWith(await clientJwt.signAsync(payload))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refuses a session whose link has expired since the unlock', async () => {
    prisma.publicLink.findUnique.mockResolvedValue({
      ...activeLink,
      expiresAt: AN_HOUR_AGO,
    });

    await expect(activateWith(await clientJwt.signAsync(payload))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refuses a session whose link no longer exists', async () => {
    prisma.publicLink.findUnique.mockResolvedValue(null);

    await expect(activateWith(await clientJwt.signAsync(payload))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

// The other direction of the same boundary. Written here, next to its twin, so
// that a change of secret cannot satisfy one half while breaking the other.
describe('JwtAuthGuard faced with a client session', () => {
  it('refuses a client token presented as a lawyer session', async () => {
    const clientJwt = new JwtService({ secret: CLIENT_SECRET });
    const lawyers = { findById: jest.fn() };
    const guard = new JwtAuthGuard(
      new JwtService({ secret: LAWYER_SECRET }),
      new Reflector(),
      lawyers as never,
    );

    const context = contextWith({
      [AUTH_COOKIE_NAME]: await clientJwt.signAsync({
        typ: 'client',
        linkId: LINK_ID,
        requestId: REQUEST_ID,
      }),
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(lawyers.findById).not.toHaveBeenCalled();
  });
});
