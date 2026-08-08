import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * @Global: persistence will be used by nearly every business module to come
 * (requests, items, access log). Making them all import PrismaModule would add
 * no information, only noise.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
