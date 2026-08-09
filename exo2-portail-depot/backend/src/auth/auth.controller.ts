import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
// `import type` is required, not stylistic: with isolatedModules and
// emitDecoratorMetadata, a type named in a @Req()/@Res() signature would
// otherwise be emitted as a runtime import (TS1272).
import type { Request, Response } from 'express';
import type { LawyerProfile } from '../lawyers/lawyer.types';
import {
  AUTH_COOKIE_NAME,
  buildAuthCookie,
  clearAuthCookie,
} from './auth-cookie';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './auth.types';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';

/**
 * The lawyer's session. The client side stays anonymous and never comes
 * through here -- it will unlock a deposit link with a PIN (C1).
 *
 * `@Res({ passthrough: true })` throughout: it gives access to the response for
 * the cookie while leaving Nest in charge of serialising the returned value.
 * Without `passthrough`, the framework steps back entirely and every handler
 * has to call res.json() itself.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /**
   * 200 rather than the 201 Nest gives POST by default: nothing is created at
   * a URL here, a session is opened.
   */
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
    const token = await this.auth.issueToken(lawyer);

    response.cookie(
      AUTH_COOKIE_NAME,
      token,
      buildAuthCookie(request.secure, this.auth.sessionMaxAgeMs()),
    );

    // The token is NOT repeated in the body: it would land in the SPA's
    // JavaScript, which is exactly what httpOnly exists to prevent.
    return lawyer;
  }

  /**
   * Public on purpose, and this is not an oversight: a lawyer whose token has
   * expired must still be able to clear the cookie. Behind the guard, logging
   * out of a dead session would answer 401 and leave the stale cookie in the
   * browser.
   *
   * Its limit is stated in the README: erasing the cookie does not invalidate
   * the token. A copy taken beforehand stays usable until it expires. Real
   * revocation needs a list of revoked tokens, i.e. a round-trip to storage on
   * every request.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): void {
    response.clearCookie(AUTH_COOKIE_NAME, clearAuthCookie(request.secure));
  }

  /**
   * What the SPA calls on load to know whether a session is still open -- the
   * cookie being httpOnly, it cannot look for itself.
   *
   * The profile comes from the guard, which has already re-read the account:
   * no second query here.
   */
  @Get('me')
  me(@Req() request: AuthenticatedRequest): LawyerProfile {
    return request.lawyer;
  }
}
