import { register as globalRegistry } from 'prom-client';
import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('counts a deposit under the outcome it was given', async () => {
    const metrics = new MetricsService();
    metrics.recordDeposit('rejected_type');
    metrics.recordDeposit('rejected_type');
    metrics.recordDeposit('success');

    const scrape = await metrics.scrape();
    expect(scrape).toContain(
      'portail_deposits_total{outcome="rejected_type"} 2',
    );
    expect(scrape).toContain('portail_deposits_total{outcome="success"} 1');
  });

  // The failure scenario this protects: a brute force over the 10 000 PIN
  // combinations is invisible unless failures are counted apart from
  // successes. G1 (rate limiting) is out of scope, so this counter is the only
  // thing that would ever raise the alarm.
  it('counts a failed unlock apart from a successful one', async () => {
    const metrics = new MetricsService();
    metrics.recordUnlock('failure');
    metrics.recordUnlock('success');

    const scrape = await metrics.scrape();
    expect(scrape).toContain(
      'portail_unlock_attempts_total{outcome="failure"} 1',
    );
    expect(scrape).toContain(
      'portail_unlock_attempts_total{outcome="success"} 1',
    );
  });

  it('counts a hit on an expired link', async () => {
    const metrics = new MetricsService();
    metrics.recordExpiredLinkHit();

    expect(await metrics.scrape()).toContain(
      'portail_expired_link_hits_total 1',
    );
  });

  it('sums the observed upload sizes', async () => {
    const metrics = new MetricsService();
    metrics.observeUploadBytes(1024);
    metrics.observeUploadBytes(2048);

    const scrape = await metrics.scrape();
    expect(scrape).toContain('portail_upload_bytes_sum 3072');
    expect(scrape).toContain('portail_upload_bytes_count 2');
  });

  it('labels an http observation with method, route and status', async () => {
    const metrics = new MetricsService();
    metrics.observeHttpRequest('GET', '/api/v1/requests/:id', 200, 0.012);

    expect(await metrics.scrape()).toContain(
      'portail_http_request_duration_seconds_count{method="GET",route="/api/v1/requests/:id",status="200"} 1',
    );
  });

  it('collects the process and runtime metrics too', async () => {
    const scrape = await new MetricsService().scrape();

    // Without them an "API is slow" cannot be told apart from "the machine is
    // saturated", which is the first question any latency alert raises.
    expect(scrape).toContain('nodejs_eventloop_lag_seconds');
    expect(scrape).toContain('process_cpu_seconds_total');
  });

  // The failure scenario this protects: registering into prom-client's global
  // registry makes a second instance throw on an already-registered name, and
  // lets any library that uses the default registry leak into the portal's
  // scrape without a line of this repository changing.
  it('registers nothing in the global registry, so two instances can coexist', async () => {
    const first = new MetricsService();
    expect(() => new MetricsService()).not.toThrow();

    first.recordExpiredLinkHit();
    expect(await globalRegistry.metrics()).not.toContain('portail_');
  });
});
