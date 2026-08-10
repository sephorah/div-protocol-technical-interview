import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
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
import { DepositsService } from './deposits.service';
import { PublicService } from './public.service';
import type { DepositedFileView, PublicRequestView } from './public.types';
import { UploadLimitFilter } from './upload-limit.filter';
import { MAX_FILE_BYTES, NO_FILE } from './upload.constants';
import { DepositFileDto } from './dto/deposit-file.dto';
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
    private readonly deposits: DepositsService,
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

  /**
   * Deposits one file against one expected piece.
   *
   * The guard runs BEFORE the interceptor (Nest's order is guards, then
   * interceptors), so a caller with no session is refused without twenty
   * megabytes ever being read.
   *
   * memoryStorage, explicitly: it is also multer's default, but writing it down
   * is what keeps A3's promise checkable -- the API's disk never holds a
   * client's document, not even briefly. Adding `dest` here would break that
   * with nothing to say so.
   *
   * `files: 1` alongside fileSize: without it, ten parts of twenty megabytes
   * each pass the per-file limit one by one.
   */
  @UseGuards(ClientSessionGuard)
  @UseFilters(UploadLimitFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { files: 1, fileSize: MAX_FILE_BYTES },
    }),
  )
  @Post('files')
  deposit(
    @Req() request: ClientRequest,
    @Body() body: DepositFileDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<DepositedFileView> {
    if (file === undefined) {
      throw new BadRequestException(NO_FILE);
    }

    // requestId comes from the session the guard rebuilt from the database,
    // never from the body: it is what makes the piece check meaningful.
    return this.deposits.deposit(request.clientSession.requestId, body.itemId, {
      originalName: file.originalname,
      buffer: file.buffer,
    });
  }
}
