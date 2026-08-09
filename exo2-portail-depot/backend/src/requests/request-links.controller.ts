import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { RegenerateLinkDto } from './dto/regenerate-link.dto';
import { PublicLinksService } from './public-links.service';
import type { IssuedLink } from './request.types';

/**
 * The public link of a deposit request.
 *
 * A SUB-RESOURCE of /requests, never a second creation route: the request
 * already exists, only its link is replaced. The exercise statement lists its
 * API surface "a titre indicatif" and leaves the split to us, so this addition
 * is ours -- and what justifies it is that a PIN is shown exactly once and
 * stored as an argon2id hash. A tab closed before it was copied leaves a valid
 * request whose code exists nowhere; regenerating is the only way back.
 *
 * No @UseGuards and, above all, no @Public(): the guard registered as APP_GUARD
 * by AuthModule closes this controller by default, and the owner is read from
 * the session the guard attached.
 */
@Controller('requests/:requestId/link')
export class RequestLinksController {
  constructor(private readonly links: PublicLinksService) {}

  @Post()
  regenerate(
    @Req() request: AuthenticatedRequest,
    @Param('requestId') requestId: string,
    @Body() body: RegenerateLinkDto,
  ): Promise<IssuedLink> {
    return this.links.regenerate(
      requestId,
      request.lawyer.id,
      body.expiresInDays,
    );
  }

  // 204 rather than 200 with a count: the operation is idempotent, and a body
  // reading "0 revoked" would invite the caller to treat a double click as a
  // failure.
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(
    @Req() request: AuthenticatedRequest,
    @Param('requestId') requestId: string,
  ): Promise<void> {
    return this.links.revoke(requestId, request.lawyer.id);
  }
}
