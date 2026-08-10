import { register as globalRegistry } from 'prom-client';
import { MetricsService } from './metrics.service';

// The failure scenario this protects: registering into prom-client's global
// registry makes a second instance throw on an already-registered name, and
// lets any library that uses the default registry leak into the portal's
// scrape without a line of this repository changing.
describe('MetricsService', () => {
  it('registers nothing in the global registry, so two instances can coexist', async () => {
    const first = new MetricsService();
    expect(() => new MetricsService()).not.toThrow();

    first.recordExpiredLinkHit();
    expect(await globalRegistry.metrics()).not.toContain('portal_');
  });
});
