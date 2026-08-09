import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// `import type` is required, not stylistic: with isolatedModules and
// emitDecoratorMetadata, a type named in a @Req()/@Res() signature would
// otherwise be emitted as a runtime import (TS1272).
import type { Request, Response } from 'express';
import type { LawyerProfile } from '../lawyers/lawyer.types';
import {
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  buildAuthCookie,
  buildRefreshCookie,
  clearAuthCookie,
  clearRefreshCookie,
  refreshCookiePath,
} from './auth-cookie';
import { AuthService } from './auth.service';
import type { SessionTokens } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';

/**
 * The lawyer's session. The client side stays anonymous and unlocks a deposit
 * link with a PIN instead (C1).
 *
 * `@Res({ passthrough: true })` gives access to the response for the cookies
 * while leaving Nest in charge of serialising what the handler returns.
 */
@Controller('auth')
export class AuthController {
  private readonly refreshPath: string;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService,
  ) {
    this.refreshPath = refreshCookiePath(
      config.getOrThrow<string>('API_PREFIX'),
    );
  }

  // 200 and not Nest's default 201: nothing is created at a URL, a session opens.
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() credentials: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LawyerProfile> {
    const lawyer = await this.auth.validateLawyer(
      credentials.email,
      credentials.password,
    );

    this.setSessionCookies(
      request,
      response,
      await this.auth.openSession(lawyer),
    );

    // Neither token is repeated in the body: they would land in the SPA's
    // JavaScript, which is what httpOnly exists to prevent.
    return lawyer;
  }

  /**
   * @Public(): the access token is expired by definition when this is called --
   * that is the reason the route exists.
   *
   * Every refusal answers the same bare 401. Saying "reused" out loud would
   * tell an attacker their copy was noticed.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LawyerProfile> {
    const presented = this.readRefreshCookie(request);
    if (presented === null) {
      throw new UnauthorizedException();
    }

    const outcome = await this.auth.renewSession(presented);
    if (outcome.status === 'rejected') {
      // The session is over: leaving a dead cookie in place would make the SPA
      // keep retrying a renewal that can no longer succeed.
      this.clearSessionCookies(request, response);
      throw new UnauthorizedException();
    }

    this.setSessionCookies(request, response, outcome);
    return outcome.profile;
  }

  /**
   * @Public() on purpose: a lawyer whose access token has expired must still be
   * able to close their session. Unlike before, this now revokes server-side --
   * a copied cookie stops working immediately.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const presented = this.readRefreshCookie(request);
    if (presented !== null) {
      await this.auth.revokeSession(presented);
    }
    this.clearSessionCookies(request, response);
  }

  /**
   * What the SPA calls on load to know whether a session is open -- the cookies
   * being httpOnly, it cannot look for itself. The profile comes from the
   * guard, which already re-read the account.
   */
  @Get('me')
  me(@Req() request: AuthenticatedRequest): LawyerProfile {
    return request.lawyer;
  }

  private setSessionCookies(
    request: Request,
    response: Response,
    tokens: SessionTokens,
  ): void {
    response.cookie(
      AUTH_COOKIE_NAME,
      tokens.accessToken,
      buildAuthCookie(request.secure, this.auth.accessMaxAgeMs()),
    );
    response.cookie(
      REFRESH_COOKIE_NAME,
      tokens.refreshToken,
      buildRefreshCookie(
        request.secure,
        this.auth.sessionMaxAgeMs(),
        this.refreshPath,
      ),
    );
  }

  private clearSessionCookies(request: Request, response: Response): void {
    response.clearCookie(AUTH_COOKIE_NAME, clearAuthCookie(request.secure));
    response.clearCookie(
      REFRESH_COOKIE_NAME,
      clearRefreshCookie(request.secure, this.refreshPath),
    );
  }

  // Same defence as the guard: without cookie-parser the field is undefined,
  // and a missing middleware must answer 401 rather than throw a TypeError.
  private readRefreshCookie(request: Request): string | null {
    const cookies: unknown = request.cookies;
    if (typeof cookies !== 'object' || cookies === null) {
      return null;
    }

    const token = (cookies as Record<string, unknown>)[REFRESH_COOKIE_NAME];
    return typeof token === 'string' && token.length > 0 ? token : null;
  }
}
