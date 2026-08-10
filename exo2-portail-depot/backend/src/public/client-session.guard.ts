import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { isExpired } from '../requests/request-status';
import {
  CLIENT_COOKIE_NAME,
  ClientRequest,
  ClientSessionPayload,
} from './client-session';
import { refuseAccess } from './public.service';

/**
 * Guards the routes an unlocked client reaches. Applied per route rather than
 * globally: the global JwtAuthGuard is the lawyer's, and @Public() is what lets
 * a request reach this one at all.
 *
 * The JwtService injected here is PublicModule's, signed with
 * CLIENT_JWT_SECRET. Resolving the global one from AuthModule would make the
 * two secrets distinct on paper only.
 */
@Injectable()
export class ClientSessionGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (token === null) {
      throw refuseAccess();
    }

    let payload: ClientSessionPayload;
    try {
      payload = await this.jwt.verifyAsync<ClientSessionPayload>(token);
    } catch {
      throw refuseAccess();
    }

    // verifyAsync<T> is a cast, not a validation: a token signed with the right
    // secret but carrying no linkId would otherwise reach Prisma with an
    // undefined id and answer 500 where every other refusal is a 401.
    if (payload.typ !== 'client' || typeof payload.linkId !== 'string') {
      throw refuseAccess();
    }

    const link = await this.prisma.publicLink.findUnique({
      where: { id: payload.linkId },
      select: { id: true, requestId: true, expiresAt: true, revokedAt: true },
    });

    // Re-read on EVERY request, and this is the whole point of putting linkId
    // in the session: the token cannot be recalled, so a revocation or an
    // expiry only takes effect here.
    if (
      link === null ||
      link.revokedAt !== null ||
      isExpired(link.expiresAt, new Date())
    ) {
      throw refuseAccess();
    }

    // requestId comes from the row, not from the payload: the database is the
    // authority on which request a link belongs to.
    (request as ClientRequest).clientSession = {
      linkId: link.id,
      requestId: link.requestId,
      expiresAt: link.expiresAt,
    };
    return true;
  }

  // `req.cookies` comes from cookie-parser (app.setup.ts); the explicit shape
  // check keeps a missing middleware a 401 rather than a TypeError.
  private extractToken(request: Request): string | null {
    const cookies: unknown = request.cookies;
    if (typeof cookies !== 'object' || cookies === null) {
      return null;
    }

    const token = (cookies as Record<string, unknown>)[CLIENT_COOKIE_NAME];
    return typeof token === 'string' && token.length > 0 ? token : null;
  }
}
