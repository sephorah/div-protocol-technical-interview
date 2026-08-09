import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

// PrismaService is @Global, hence no import here -- same as LawyersModule.
//
// No `exports`: nothing outside consumes RequestsService today. LawyersModule
// exports because AuthModule really imports it; exporting on the off chance
// widens a module's surface for a caller that does not exist.
@Module({
  controllers: [RequestsController],
  providers: [RequestsService],
})
export class RequestsModule {}
