import { Injectable } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Histogram,
  Registry,
} from 'prom-client';

/** What the deposit route did with the bytes it was handed. */
export type DepositOutcome =
  'success' | 'rejected_type' | 'rejected_size' | 'error';

export type UnlockOutcome = 'success' | 'failure';

/**
 * The portal's metrics, exposed to Prometheus by MetricsController.
 *
 * Every metric here answers ONE operational question -- see the comment above
 * each declaration. A metric nobody can act on is a time series to store
 * forever, so a new one has to bring its question with it.
 */
@Injectable()
export class MetricsService {
  // A registry of our own rather than prom-client's global one. Two reasons,
  // both bite in tests: the global registry survives between test files, so a
  // second instance would throw on an already-registered metric name; and a
  // library that registers into the global one would leak into the portal's
  // scrape without anything saying so.
  private readonly registry = new Registry();

  /**
   * Deposits, by outcome. Answers "is the product doing its only job?" -- a
   * spike of `rejected_type` means clients do not understand the allowlist.
   */
  private readonly deposits = new Counter({
    name: 'portal_deposits_total',
    help: 'Deposited files, by outcome',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  });

  /**
   * PIN unlock attempts. A spike of `failure` is the signature of a brute force
   * over the 10 000 combinations -- this is what stands in for the rate
   * limiting of G1, which is out of scope: it detects, it does not prevent.
   */
  private readonly unlocks = new Counter({
    name: 'portal_unlock_attempts_total',
    help: 'PIN unlock attempts, by outcome',
    labelNames: ['outcome'] as const,
    registers: [this.registry],
  });

  /**
   * Clients arriving after their link died. A rising count says the default
   * lifetime is too short, which is a product decision, not an incident.
   */
  private readonly expiredLinkHits = new Counter({
    name: 'portal_expired_link_hits_total',
    help: 'Hits on a deposit link that had already expired',
    registers: [this.registry],
  });

  /**
   * Requests that reached "complete". Answers "how many cases actually get
   * assembled?", which deposits_total cannot: that one counts files.
   */
  private readonly requestsCompleted = new Counter({
    name: 'portal_requests_completed_total',
    help: 'Deposit requests whose last expected piece arrived',
    registers: [this.registry],
  });

  /**
   * Latency per route. The base of every availability alert -- it is also the
   * only metric that sees a route nobody instrumented by hand.
   */
  private readonly httpDuration = new Histogram({
    name: 'portal_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  constructor() {
    // Event loop lag, heap, open handles, process CPU. They are what tells an
    // "API is slow" apart from "the machine is saturated", and they cost one
    // line.
    collectDefaultMetrics({ register: this.registry });
  }

  recordDeposit(outcome: DepositOutcome): void {
    this.deposits.inc({ outcome });
  }

  recordUnlock(outcome: UnlockOutcome): void {
    this.unlocks.inc({ outcome });
  }

  recordExpiredLinkHit(): void {
    this.expiredLinkHits.inc();
  }

  recordRequestCompleted(): void {
    this.requestsCompleted.inc();
  }

  observeHttpRequest(
    method: string,
    route: string,
    status: number,
    seconds: number,
  ): void {
    this.httpDuration.observe(
      { method, route, status: String(status) },
      seconds,
    );
  }

  /** The scrape body, in the Prometheus text exposition format. */
  scrape(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
