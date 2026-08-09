import { Module } from '@nestjs/common';
import { PublicLinksService } from './public-links.service';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

// PrismaService is @Global, hence no import here -- same as LawyersModule.
//
// RequestsService is deliberately NOT exported: nothing outside consumes it.
// PublicLinksService is, and the difference is a real consumer rather than a
// guess -- src/seed.ts resolves it from the application context, and C1 will
// need it to resolve a token before checking a PIN.
@Module({
  controllers: [RequestsController],
  providers: [RequestsService, PublicLinksService],
  exports: [PublicLinksService],
})
export class RequestsModule {}
