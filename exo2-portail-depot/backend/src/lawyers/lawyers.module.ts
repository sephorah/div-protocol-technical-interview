import { Module } from '@nestjs/common';
import { LawyersService } from './lawyers.service';

// PrismaService is @Global, hence no import here.
@Module({
  providers: [LawyersService],
  exports: [LawyersService],
})
export class LawyersModule {}
