import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { toProfile } from '../lawyers/lawyer.types';
import { LawyersService } from '../lawyers/lawyers.service';
import { AUTH_COOKIE_NAME } from './auth-cookie';
import { AuthenticatedRequest, JwtPayload } from './auth.types';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * The portal's single authentication guard, registered globally in AuthModule.
 *
 * It reads the token from the cookie only, never from an Authorization header:
 * supporting both would mean every protection (expiry, CSRF stance, cookie
 * attributes) has to hold on two paths, for a second one nothing here uses.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly lawyers: LawyersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // getAllAndOverride, not get: @Public() must work on a whole controller as
    // well as on a single handler, the handler winning.
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic === true) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (token === null) {
      throw new UnauthorizedException();
    }

    let payload: JwtPayload;
    try {
      // verifyAsync checks the signature AND the expiry, and throws on either.
      // The secret comes from the JwtModule registration, so it is configured
      // in one place.
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      // The cause is deliberately swallowed: "malformed", "expired" and "bad
      // signature" all answer the same 401. The distinction only helps whoever
      // is forging tokens.
      throw new UnauthorizedException();
    }

    // verifyAsync<JwtPayload> is a cast, not a validation: it proves the
    // signature and the expiry, nothing about the shape. A token signed with
    // our secret but carrying no `sub` would reach findUnique with an undefined
    // identifier, which Prisma answers with an exception -- a 500 where every
    // other rejection on this path is a 401.
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new UnauthorizedException();
    }

    // The account is re-read on each request rather than rebuilt from the
    // payload. It costs one indexed lookup, and it buys the only revocation
    // this design has: a deleted account stops being able to use tokens issued
    // before its deletion, which would otherwise stay valid for two hours. It
    // is also what lets /auth/me answer a full profile without the name having
    // to travel inside the token.
    const lawyer = await this.lawyers.findById(payload.sub);
    if (lawyer === null) {
      throw new UnauthorizedException();
    }

    (request as AuthenticatedRequest).lawyer = toProfile(lawyer);
    return true;
  }

  /**
   * `req.cookies` is populated by cookie-parser (main.ts). Without that
   * middleware the field is undefined and every authenticated request answers
   * 401 -- hence the explicit check rather than an optional chain that would
   * make the misconfiguration look like a missing token.
   */
  private extractToken(request: Request): string | null {
    const cookies: unknown = request.cookies;
    if (typeof cookies !== 'object' || cookies === null) {
      return null;
    }

    const token = (cookies as Record<string, unknown>)[AUTH_COOKIE_NAME];
    return typeof token === 'string' && token.length > 0 ? token : null;
  }
}
