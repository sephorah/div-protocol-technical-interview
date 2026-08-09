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
 * Registered globally in AuthModule, so every route is closed unless it carries
 * @Public(). Reads the cookie only: an Authorization header would mean holding
 * every protection on two paths, for a second one nothing here uses.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly lawyers: LawyersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // getAllAndOverride so @Public() works on a controller as well as on a
    // single handler, the handler winning.
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
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      // "malformed", "expired" and "bad signature" all answer the same 401:
      // the distinction only helps whoever is forging tokens.
      throw new UnauthorizedException();
    }

    // verifyAsync<JwtPayload> is a cast, not a validation. Without this check a
    // token carrying no `sub` reaches Prisma with an undefined id and answers
    // 500, where every other rejection here is a 401.
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new UnauthorizedException();
    }

    // Re-read rather than rebuilt from the payload: one indexed lookup buys the
    // only revocation this design has, a deleted account losing its still-valid
    // tokens.
    const lawyer = await this.lawyers.findById(payload.sub);
    if (lawyer === null) {
      throw new UnauthorizedException();
    }

    (request as AuthenticatedRequest).lawyer = toProfile(lawyer);
    return true;
  }

  // `req.cookies` comes from cookie-parser (app.setup.ts); the explicit shape
  // check keeps a missing middleware a 401 rather than a TypeError.
  private extractToken(request: Request): string | null {
    const cookies: unknown = request.cookies;
    if (typeof cookies !== 'object' || cookies === null) {
      return null;
    }

    const token = (cookies as Record<string, unknown>)[AUTH_COOKIE_NAME];
    return typeof token === 'string' && token.length > 0 ? token : null;
  }
}
