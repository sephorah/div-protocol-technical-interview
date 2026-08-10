import { Controller, Get, Res } from '@nestjs/common';
// `import type`: the type appears in a decorated signature, which tsc refuses
// to emit metadata for under isolatedModules unless the import is type-only.
import type { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { MetricsService } from './metrics.service';

/**
 * The Prometheus scrape endpoint.
 *
 * @Public() because Prometheus holds no session and never will. What keeps the
 * endpoint off the internet is the same mechanism as the health probe: the
 * `deny all` rule on `location = /api/v1/metrics` in
 * infra/nginx/portal-locations.conf. Published, it would tell a scanner how
 * many requests exist, when deposits happen and which dependency is down.
 */
@Public()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  // passthrough: Nest still serialises the returned value; only the header is
  // set by hand. Prometheus needs the versioned text format, not application/json.
  @Get()
  async scrape(
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    response.setHeader('Content-Type', this.metrics.contentType);
    return this.metrics.scrape();
  }
}
