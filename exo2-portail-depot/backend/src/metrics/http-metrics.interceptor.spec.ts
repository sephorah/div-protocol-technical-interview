import {
  CallHandler,
  ExecutionContext,
  NotFoundException,
} from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { MetricsService } from './metrics.service';

interface FakeRequest {
  method: string;
  url: string;
  route?: { path: string };
}

const contextFor = (
  request: FakeRequest,
  statusCode: number,
): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ statusCode }),
    }),
  }) as unknown as ExecutionContext;

const handlerOf = (value: unknown): CallHandler =>
  ({ handle: () => of(value) }) as CallHandler;

const failingHandler = (error: unknown): CallHandler =>
  ({ handle: () => throwError(() => error) }) as CallHandler;

describe('HttpMetricsInterceptor', () => {
  let metrics: MetricsService;
  let observe: jest.SpyInstance;
  let interceptor: HttpMetricsInterceptor;

  beforeEach(() => {
    metrics = new MetricsService();
    observe = jest.spyOn(metrics, 'observeHttpRequest');
    interceptor = new HttpMetricsInterceptor(metrics);
  });

  it('labels the observation with the route pattern and the response status', async () => {
    const context = contextFor(
      {
        method: 'GET',
        url: '/api/v1/requests/9f3',
        route: { path: '/api/v1/requests/:id' },
      },
      200,
    );

    await lastValueFrom(
      interceptor.intercept(context, handlerOf({ ok: true })),
    );

    expect(observe).toHaveBeenCalledWith(
      'GET',
      '/api/v1/requests/:id',
      200,
      expect.any(Number),
    );
  });

  // The failure scenario this protects: a scanner walking /aaa, /aab, /aac
  // matches no route. Labelling with the requested path would create one time
  // series per probe, and the metric meant to raise the alert is what fills
  // the disk instead.
  it('labels an unmatched request with a constant, never with its path', async () => {
    const context = contextFor({ method: 'GET', url: '/wp-login.php' }, 404);

    await lastValueFrom(interceptor.intercept(context, handlerOf(undefined)));

    expect(observe).toHaveBeenCalledWith(
      'GET',
      'unmatched',
      404,
      expect.any(Number),
    );
    expect(observe).not.toHaveBeenCalledWith(
      expect.anything(),
      '/wp-login.php',
      expect.anything(),
      expect.anything(),
    );
  });

  // The failure scenario this protects: the exception filter runs AFTER the
  // interceptor, so the response still carries the 200 nobody will ever send.
  // Read from there, every refusal would be counted as a success and the
  // availability alert would never fire.
  it('takes the status of a thrown HttpException, not the untouched response', async () => {
    const context = contextFor(
      {
        method: 'POST',
        url: '/api/v1/public/abc/unlock',
        route: { path: '/api/v1/public/:token/unlock' },
      },
      200,
    );

    await expect(
      lastValueFrom(
        interceptor.intercept(context, failingHandler(new NotFoundException())),
      ),
    ).rejects.toThrow(NotFoundException);

    expect(observe).toHaveBeenCalledWith(
      'POST',
      '/api/v1/public/:token/unlock',
      404,
      expect.any(Number),
    );
  });

  it('counts a non-http failure as a 500', async () => {
    const context = contextFor(
      {
        method: 'GET',
        url: '/api/v1/requests',
        route: { path: '/api/v1/requests' },
      },
      200,
    );

    await expect(
      lastValueFrom(
        interceptor.intercept(context, failingHandler(new Error('boom'))),
      ),
    ).rejects.toThrow('boom');

    expect(observe).toHaveBeenCalledWith(
      'GET',
      '/api/v1/requests',
      500,
      expect.any(Number),
    );
  });
});
