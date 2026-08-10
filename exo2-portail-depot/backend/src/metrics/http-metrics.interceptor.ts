import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

const SERVER_ERROR = 500;

/**
 * The label used when no route matched. It must NOT be the requested path: a
 * scanner walking /aaa, /aab, /aac would then create one time series per
 * probe, and the metric that was supposed to raise the alert is what fills the
 * disk. Prometheus calls this a cardinality explosion.
 */
const UNMATCHED_ROUTE = 'unmatched';

/**
 * Express 5 types `route` as `any`, which the blocking lint refuses. The Omit
 * is what makes the narrowing stick: an intersection with an `any` property
 * stays `any`.
 */
type RoutedRequest = Omit<Request, 'route'> & { route?: { path?: string } };

/** Times every HTTP request and labels it by ROUTE PATTERN, never by path. */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RoutedRequest>();
    const response = http.getResponse<Response>();
    const startedAt = process.hrtime.bigint();

    const observe = (status: number): void => {
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      this.metrics.observeHttpRequest(
        request.method,
        // Express fills `route` only once a handler matched, and Nest registers
        // its handlers under the full path (global prefix included), so this is
        // `/api/v1/requests/:id` rather than the id itself.
        request.route?.path ?? UNMATCHED_ROUTE,
        status,
        seconds,
      );
    };

    return next.handle().pipe(
      tap({
        next: () => observe(response.statusCode),
        // On the error path the status is read from the exception, not from the
        // response: the exception filter has not run yet, so `statusCode` is
        // still the 200 nobody will ever send.
        error: (error: unknown) =>
          observe(
            error instanceof HttpException ? error.getStatus() : SERVER_ERROR,
          ),
      }),
    );
  }
}
