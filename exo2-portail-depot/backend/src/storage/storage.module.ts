import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * @Global for the same reason as PrismaModule: the health probe already needs
 * it, and so will every module that handles a deposited file.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
