import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
// `import type` is required, not stylistic: with isolatedModules and
// emitDecoratorMetadata, a type named in a @Req()/@Res() signature would
// otherwise be emitted as a runtime import (TS1272).
import type { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import {
  CLIENT_COOKIE_NAME,
  buildClientCookie,
  clientCookiePath,
} from './client-session';
import type { ClientRequest, ClientSessionPayload } from './client-session';
import { ClientSessionGuard } from './client-session.guard';
import { PublicService } from './public.service';
import type { PublicRequestView } from './public.types';
import { UnlockDto } from './dto/unlock.dto';

/**
 * The anonymous client's side of the portal. @Public() on the class because the
 * global JwtAuthGuard closes everything by default; the client's own guard is
 * applied per route below.
 */
@Public()
@Controller('public')
export class PublicController {
  private readonly cookiePath: string;

  constructor(
    private readonly clients: PublicService,
    // PublicModule's JwtService, signed with CLIENT_JWT_SECRET -- not
    // AuthModule's.
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.cookiePath = clientCookiePath(config.getOrThrow<string>('API_PREFIX'));
  }

  /**
   * 200 and not Nest's default 201: nothing is created at a URL, a session
   * opens. The token stays in the path because the statement freezes this
   * route's shape -- see infra/nginx/log-redact.conf, which keeps it out of the
   * access log.
   */
  @Post(':token/unlock')
  @HttpCode(HttpStatus.OK)
  async unlock(
    @Param('token') token: string,
    @Body() body: UnlockDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicRequestView> {
    const unlocked = await this.clients.unlock(token, body.pin, new Date());

    const session: ClientSessionPayload = {
      typ: 'client',
      linkId: unlocked.linkId,
      requestId: unlocked.view.requestId,
    };
    // The session token is not repeated in the body: it would land in the SPA's
    // JavaScript, which is what httpOnly exists to prevent.
    response.cookie(
      CLIENT_COOKIE_NAME,
      await this.jwt.signAsync(session),
      buildClientCookie(request.secure, this.cookiePath),
    );

    return unlocked.view;
  }

  /**
   * What the SPA calls on load to know whether the deposit page is still open:
   * the cookie being httpOnly, it cannot look for itself. The guard has already
   * re-read the link, so a revocation lands here as a 401.
   */
  @UseGuards(ClientSessionGuard)
  @Get('session')
  session(@Req() request: ClientRequest): Promise<PublicRequestView> {
    return this.clients.viewOf(
      request.clientSession.requestId,
      request.clientSession.expiresAt,
    );
  }
}
