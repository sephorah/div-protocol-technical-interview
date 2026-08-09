import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
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
}
