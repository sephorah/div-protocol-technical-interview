// Prisma CLI configuration (generate, migrate).
//
// In TypeScript, including inside the production image where the entrypoint
// runs `prisma migrate deploy`: the CLI loads this file through jiti, which
// transpiles TypeScript itself and arrives via
// `prisma -> @prisma/config -> c12 -> jiti`, all of them `dependencies`. The
// `typescript` package is indeed removed by `pnpm prune --prod` -- but it is
// not what loads this file.
//
// The real constraint lies elsewhere, and it is independent of the extension:
// this file must NOT enter the compilation, otherwise the `rootDir` tsc infers
// widens from src/ to the package root and the output becomes dist/src/main.js.
// Hence its exclusion in tsconfig.build.json.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';
// Imported from the sources, not from dist/: `pnpm build` runs
// `prisma generate` BEFORE `nest build`, so dist/ does not exist yet on a fresh
// clone. The Dockerfile ships this one source file into the final image so that
// the import resolves there too.
import { buildDatabaseUrl } from './src/config/database-url';

// Prisma 7 no longer loads `.env` automatically once a configuration file
// exists. The project's `.env` lives at the repository root, one level above
// backend/: it is the same one docker compose reads. In the container it is
// absent and the variables come from compose -- hence the existsSync, which
// avoids a warning on every migration.
const rootEnv = resolve(__dirname, '..', '.env');
if (existsSync(rootEnv)) {
  loadDotenv({ path: rootEnv, quiet: true });
}

// An explicit DATABASE_URL wins, as in env.validation.ts: that is what makes
// it possible to target a managed or CI database. Otherwise it is built from
// the DB_* variables, by the same function the application uses -- no second
// implementation that could diverge.
const databaseUrl =
  process.env.DATABASE_URL ??
  buildDatabaseUrl({
    // No fallback value: a missing variable must make the command fail, not
    // silently target some default database.
    DB_HOST: process.env.DB_HOST ?? '',
    DB_PORT: process.env.DB_PORT ?? '',
    DB_USER: process.env.DB_USER ?? '',
    DB_PASSWORD: process.env.DB_PASSWORD ?? '',
    DB_NAME: process.env.DB_NAME ?? '',
  });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
});
