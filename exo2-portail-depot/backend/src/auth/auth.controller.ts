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
 * The lawyer's session. The client side stays anonymous and unlocks a deposit
 * link with a PIN instead (C1).
 *
 * `@Res({ passthrough: true })` gives access to the response for the cookie
 * while leaving Nest in charge of serialising what the handler returns.
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
    const token = await this.auth.issueToken(lawyer);

    response.cookie(
      AUTH_COOKIE_NAME,
      token,
      buildAuthCookie(request.secure, this.auth.sessionMaxAgeMs()),
    );

    // Never repeated in the body: it would land in the SPA's JavaScript, which
    // is what httpOnly exists to prevent.
    return lawyer;
  }

  /**
   * @Public() on purpose: a lawyer whose token has expired must still be able
   * to clear the cookie. Erasing it does not invalidate the token -- a limit
   * stated in the README.
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
   * What the SPA calls on load to know whether a session is open -- the cookie
   * being httpOnly, it cannot look for itself. The profile comes from the
   * guard, which already re-read the account.
   */
  @Get('me')
  me(@Req() request: AuthenticatedRequest): LawyerProfile {
    return request.lawyer;
  }
}
