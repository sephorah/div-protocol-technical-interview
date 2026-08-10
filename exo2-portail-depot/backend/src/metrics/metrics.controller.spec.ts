import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

describe('MetricsController', () => {
  // The failure scenario this protects: every route is closed by the global
  // guard, so without @Public() Prometheus scrapes a 401 for ever -- the
  // dashboard stays empty and nothing says why. Being reachable INSIDE the
  // network is the point; the `deny all` in portal-locations.conf is what
  // keeps it off the internet.
  it('is open to a caller with no session', () => {
    expect(new Reflector().get(IS_PUBLIC_KEY, MetricsController)).toBe(true);
  });

  it('answers the scrape in the prometheus text format', async () => {
    const metrics = new MetricsService();
    const headers: Record<string, string> = {};
    const response = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    };

    const body = await new MetricsController(metrics).scrape(
      response as unknown as Parameters<MetricsController['scrape']>[0],
    );

    expect(headers['Content-Type']).toContain('text/plain');
    expect(body).toContain('portal_deposits_total');
  });
});
