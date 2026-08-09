import { Body, Controller, Post, Req } from '@nestjs/common';
import { CreateRequestDto } from './dto/create-request.dto';
import type { AuthenticatedRequest } from '../auth/auth.types';
import type { CreatedRequestView } from './request.types';
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
}
