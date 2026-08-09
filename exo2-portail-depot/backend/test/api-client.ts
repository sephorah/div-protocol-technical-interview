import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types';

/**
 * supertest bound to the application's real prefix, with a cookie jar.
 *
 * Two repetitions it removes: every suite re-reading API_PREFIX and
 * concatenating its own paths, and requests.e2e-spec.ts splitting Set-Cookie
 * headers by hand to carry the session from one call to the next. A client on
 * which login() was never called IS the anonymous caller, which is what the 401
 * cases need.
 *
 * NOT used by auth.e2e-spec.ts, deliberately: that suite asserts on the cookie
 * attributes and replays a rotated refresh token on purpose. An automatic jar
 * would overwrite the cookie under the test and the reuse detection it exists
 * to check would never fire.
 */
export class ApiClient {
  private readonly prefix: string;
  private readonly agent: ReturnType<typeof request.agent>;

  constructor(app: INestApplication) {
    // getOrThrow, like the production code: a prefix read as undefined would
    // silently move every path to "undefined/requests" and 404 everywhere.
    this.prefix = app.get(ConfigService).getOrThrow<string>('API_PREFIX');
    // getHttpServer() is typed `any`, which the blocking lint refuses to pass
    // on: naming the type here is what keeps no-unsafe-argument quiet.
    this.agent = request.agent(app.getHttpServer() as App);
  }

  login = (email: string, password: string): request.Test =>
    this.agent.post(`${this.prefix}/auth/login`).send({ email, password });

  get = (path: string): request.Test => this.agent.get(`${this.prefix}${path}`);

  post = (path: string): request.Test =>
    this.agent.post(`${this.prefix}${path}`);

  delete = (path: string): request.Test =>
    this.agent.delete(`${this.prefix}${path}`);
}
