import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Client Prisma expose comme un provider Nest, pour que son cycle de vie
 * suive celui de l'application plutot que celui du processus.
 *
 * `onModuleDestroy` n'est appele que si `app.enableShutdownHooks()` est actif
 * (voir main.ts). Sans lui, un SIGTERM laisse les connexions ouvertes cote
 * Postgres jusqu'a leur expiration.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    // getOrThrow plutot que get : la validation au demarrage a deja garanti
    // la presence de la variable, mais un provider ne doit pas dependre de
    // l'ordre dans lequel les verifications ont eu lieu.
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
