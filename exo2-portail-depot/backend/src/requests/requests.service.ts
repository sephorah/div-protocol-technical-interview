import { Injectable } from '@nestjs/common';
import {
  generatePin,
  generatePublicToken,
  hashPublicToken,
  hashSecret,
} from '../crypto/secrets';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { CreatedRequestView, toCreatedRequest } from './request.types';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class RequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    lawyerId: string,
    input: CreateRequestDto,
  ): Promise<CreatedRequestView> {
    const token = generatePublicToken();
    const pin = generatePin();

    // Hashed BEFORE the write: argon2id takes tens of milliseconds, and holding
    // a database transaction open across it would serve no purpose. Same
    // reasoning as src/seed.ts.
    const pinHash = await hashSecret(pin);

    // ONE clock reading for both timestamps. Two would date the expiry from
    // after the hashing, so the validity would not be exactly the one asked
    // for -- and the status derived below would use a third instant again.
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + input.expiresInDays * MILLISECONDS_PER_DAY,
    );

    // A single nested write: Prisma runs it in one implicit transaction, so
    // there can be no request without its link, nor a link without its request.
    // An interactive $transaction would do the same, more verbosely.
    const created = await this.prisma.depositRequest.create({
      data: {
        title: input.title,
        lawyerId,
        items: {
          create: input.items.map((label, position) => ({ label, position })),
        },
        links: {
          create: { tokenHash: hashPublicToken(token), pinHash, expiresAt },
        },
      },
      // Ordered explicitly: the rows share a createdAt to the millisecond, so
      // without this Postgres is free to return them in any order.
      include: { items: { orderBy: { position: 'asc' } } },
    });

    // The only place where the token and the PIN travel in clear.
    return toCreatedRequest(created, { token, pin, expiresAt }, now);
  }
}
