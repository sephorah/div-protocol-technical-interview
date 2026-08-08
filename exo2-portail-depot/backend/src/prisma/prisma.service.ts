import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Prisma client exposed as a Nest provider, so that its lifecycle follows the
 * application's rather than the process's.
 *
 * `onModuleDestroy` is only called if `app.enableShutdownHooks()` is active
 * (see main.ts). Without it, a SIGTERM leaves the connections open on the
 * Postgres side until they time out.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    // getOrThrow rather than get: startup validation already guaranteed the
    // variable is present, but a provider must not depend on the order in
    // which the checks happened.
    const connectionString = config.getOrThrow<string>('DATABASE_URL');

    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
