import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * @Global, like PrismaModule and StorageModule: the counters are incremented
 * from the business services (public unlock, deposits), and making each of them
 * import MetricsModule would add noise without adding information.
 *
 * The interceptor is registered as APP_INTERCEPTOR from HERE and not through
 * app.useGlobalInterceptors(): the latter instantiates it outside the injection
 * container, where it would receive no MetricsService.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
