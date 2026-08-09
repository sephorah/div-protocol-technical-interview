import { Module } from '@nestjs/common';
import { LawyersService } from './lawyers.service';

/**
 * PrismaService is @Global (see PrismaModule), so nothing has to be imported
 * here for the service to reach the database.
 */
@Module({
  providers: [LawyersService],
  exports: [LawyersService],
})
export class LawyersModule {}
