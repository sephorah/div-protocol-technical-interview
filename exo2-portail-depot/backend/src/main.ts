import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

const bootstrap = async (): Promise<void> => {
  // Typed as NestExpressApplication because configureApp calls `app.set`: the
  // generic INestApplication does not expose the underlying engine's settings.
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Prefix, cookie reading, proxy trust and input validation. Shared with the
  // e2e suites, which do not go through this file -- see app.setup.ts.
  configureApp(app);

  // Without this hook, Nest NEVER calls onModuleDestroy on SIGTERM: Prisma's
  // $disconnect() does not run and the connections stay open on the Postgres
  // side until they time out. `init: true` in compose guarantees the signal
  // reaches the process; this line is what makes it useful.
  app.enableShutdownHooks();

  // Two arguments, and both matter:
  //
  // - getOrThrow rather than `?? 3000`: the machine is shared and only the
  //   21600-21699 range is assigned to us. A hardcoded fallback would make the
  //   API listen outside that range with nothing to signal it.
  // - the address is explicit: `app.listen(port)` listens on 0.0.0.0. On the
  //   staging machine the API would then be reachable by anyone, bypassing the
  //   proxy -- the only thing protecting /health and bounding request size. In
  //   the container the value is 0.0.0.0, which is safe: the network there is
  //   isolated and no port is published.
  await app.listen(
    config.getOrThrow<number>('PORT'),
    config.getOrThrow<string>('BIND_ADDRESS'),
  );
};
// Not `void bootstrap()`: that would silence the rule without handling
// anything. A startup failure (port taken, module miswired) would then surface
// as an unhandled rejection, with a raw stack and an incidental exit code. Here
// the message is explicit and the exit code is 1 -- which `restart:
// unless-stopped` and `docker compose logs` know how to act on.
bootstrap().catch((err) => {
  console.error('API failed to start', err);
  process.exit(1);
});
