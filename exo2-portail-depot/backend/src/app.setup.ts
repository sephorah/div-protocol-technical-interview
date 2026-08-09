import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

/**
 * Everything that turns an instantiated AppModule into the API as it runs.
 *
 * Outside main.ts because the e2e suites do not go through it -- they build the
 * application with Test.createTestingModule(). Written twice, these settings
 * would drift and the suites would test an application that does not exist.
 *
 * Excludes enableShutdownHooks() and listen(), which concern a process.
 */
export const configureApp = (app: NestExpressApplication): void => {
  const config = app.get(ConfigService);

  // Every route lives under API_PREFIX (/api/v1). Careful: nginx must then NOT
  // strip the prefix -- a `proxy_pass` with a trailing slash replaces the part
  // already consumed and would turn /api/v1/x into /x.
  app.setGlobalPrefix(config.getOrThrow<string>('API_PREFIX'));

  // Populates request.cookies, which JwtAuthGuard reads. Without it every
  // authenticated route answers 401 -- a wiring problem that looks like a token
  // problem.
  app.use(cookieParser());

  // nginx does not strip it, and it only tells a scanner which stack to target.
  app.disable('x-powered-by');

  // One hop, nginx being the only way in. This is what makes X-Forwarded-Proto
  // trustworthy, hence `request.secure`, hence the cookie's `Secure` attribute
  // (see auth/auth-cookie.ts). Without it the cookie ships unprotected even
  // over HTTPS.
  app.set('trust proxy', 1);

  // forbidNonWhitelisted rather than whitelist alone: a body that is not the
  // one the caller believes they sent should be said out loud, not silently
  // trimmed. transform is what makes the class-validator decorators run at all.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
};
