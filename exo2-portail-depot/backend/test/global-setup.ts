/**
 * Starts the PostgreSQL the e2e suites talk to, ONCE per jest invocation and
 * before any test file is imported.
 *
 * Why a globalSetup and not the simpler beforeAll in a shared setup file:
 * ConfigService.get() reads the VALIDATED environment before it ever looks at
 * process.env (@nestjs/config, config.service.js), and our validateEnv BUILDS
 * DATABASE_URL out of the five DB_* the moment app.module.ts is imported.
 * Assigning process.env.DATABASE_URL in a beforeAll would therefore be ignored
 * in silence -- no error, just every suite talking to 127.0.0.1:5432. A
 * ConfigModule with no `validate` does not have that problem, which is why the
 * beforeAll shape works elsewhere and not here.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

export const PG_CONTAINER_KEY = '__PG_CONTAINER__';

export default async (): Promise<void> => {
  // The production image, not `postgres:latest`: a suite passing against a
  // different major than production proves less than it looks like.
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:17-alpine',
  ).start();

  const url = container.getConnectionUri();

  // The REAL migrations, including the partial unique index Prisma cannot
  // express and which is written by hand in the initial one. Applying them here
  // is what makes that index testable at all.
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });

  process.env.DATABASE_URL = url;
  // globalSetup and globalTeardown share a process, the workers do not: the
  // handle travels on globalThis, the URL through process.env, which jest
  // copies into each worker when it spawns it.
  (globalThis as Record<string, unknown>)[PG_CONTAINER_KEY] = container;
};
