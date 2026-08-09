import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

/**
 * Everything that turns an instantiated AppModule into the API as it actually
 * runs: prefix, cookie reading, proxy trust, input validation.
 *
 * It lives outside main.ts because the e2e suites do NOT go through main.ts --
 * they build the application with Test.createTestingModule(). Written twice,
 * these four settings would drift, and the suites would then be testing an
 * application that does not exist: a missing cookie-parser alone makes every
 * authenticated route answer 401, and a missing ValidationPipe makes a
 * malformed body answer 200.
 *
 * Deliberately NOT included: enableShutdownHooks() and listen(), which concern
 * a process, not an application, and which the tests must not perform.
 */
export const configureApp = (app: NestExpressApplication): void => {
  const config = app.get(ConfigService);

  // Every route lives under API_PREFIX (/api/v1). Careful: nginx must then NOT
  // strip the prefix -- a `proxy_pass` with a trailing slash replaces the part
  // already consumed and would turn /api/v1/x into /x.
  app.setGlobalPrefix(config.getOrThrow<string>('API_PREFIX'));

  // Populates request.cookies, which JwtAuthGuard reads. Without it the field
  // is undefined and EVERY authenticated request answers 401 -- a failure that
  // looks like a token problem and is a wiring problem.
  app.use(cookieParser());

  // Express advertises itself in X-Powered-By on every response, and nginx does
  // not strip it. It tells a scanner which stack to look up known
  // vulnerabilities for, and tells a legitimate client nothing at all.
  app.disable('x-powered-by');

  // One hop, because nginx is the only way in. This is what makes
  // X-Forwarded-Proto trustworthy, hence `request.secure`, hence the `Secure`
  // attribute of the session cookie (see auth/auth-cookie.ts). Left at its
  // default, Express ignores the header, `request.secure` is always false, and
  // the cookie would travel without `Secure` even over HTTPS.
  app.set('trust proxy', 1);

  // whitelist strips any field not declared on the DTO, and
  // forbidNonWhitelisted turns its presence into a 400 rather than a silent
  // removal -- a body that is not the one the caller believes they sent should
  // be said out loud. transform is what turns the plain JSON object into an
  // instance of the DTO class, without which the class-validator decorators
  // never run.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
};
