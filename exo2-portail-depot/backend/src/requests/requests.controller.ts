import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
// `import type` is required, not stylistic: with isolatedModules and
// emitDecoratorMetadata, a type named in a @Res() signature would otherwise be
// emitted as a runtime import (TS1272).
import type { Response } from 'express';
import { CreateRequestDto } from './dto/create-request.dto';
import { ListRequestsDto } from './dto/list-requests.dto';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type {
  CreatedRequestView,
  RequestDetailView,
  RequestPageView,
} from './request.types';
import { RequestsService } from './requests.service';

/**
 * The lawyer's deposit requests.
 *
 * No @UseGuards and, above all, no @Public(): the guard registered as APP_GUARD
 * by AuthModule closes this controller by default. The owner is read from the
 * session the guard attached, never from the body.
 *
 * 201 is Nest's default for POST, and it is the right code here: unlike
 * /auth/login, something really is created.
 */
@Controller('requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: CreateRequestDto,
  ): Promise<CreatedRequestView> {
    return this.requests.create(request.lawyer.id, body);
  }

  // The pagination goes through the same global ValidationPipe as any body, so
  // forbidNonWhitelisted applies to the query string: an unknown parameter is a
  // 400 rather than a filter silently ignored.
  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Query() query: ListRequestsDto,
  ): Promise<RequestPageView> {
    return this.requests.list(request.lawyer.id, query);
  }

  @Get(':id')
  findOne(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<RequestDetailView> {
    return this.requests.findOne(id, request.lawyer.id);
  }

  /**
   * The bytes of one deposited piece, streamed through the API.
   *
   * `passthrough: true` is what keeps Nest in charge of the response: without
   * it the StreamableFile returned here is ignored and the request hangs.
   */
  @Get(':id/items/:itemId/file')
  async download(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.requests.streamFile(id, itemId, request.lawyer.id);

    response.setHeader('Content-Type', file.mimeType);
    // filename* / RFC 5987, and percent-encoding is the point rather than a
    // nicety: originalName comes from the client, so it can carry a quote or a
    // newline -- enough to close the header and inject a second one.
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    );

    return new StreamableFile(file.stream);
  }
}
