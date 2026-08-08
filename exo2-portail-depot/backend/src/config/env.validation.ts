/**
 * Environment variable validation, run by ConfigModule before a single module
 * is instantiated.
 *
 * Without this check, a missing database configuration only shows up on the
 * first call that touches the database: a 500 in production, on a route with no
 * apparent link to configuration. Here the application refuses to start and
 * main.ts turns the rejection into a named message plus exit code 1, which
 * `restart: unless-stopped` and `docker compose logs` know how to act on.
 *
 * Absolute rule: never copy a variable's value into an error message.
 * DB_PASSWORD and JWT_SECRET are secrets, and error messages end up in logs,
 * which are themselves aggregated elsewhere.
 */

import { buildDatabaseUrl, DatabaseEnv } from './database-url';

const REQUIRED_DB_KEYS = [
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
] as const;

const EXPECTED_URL = 'expected: postgresql://user:password@host:port/database';

/**
 * PORT, API_PREFIX and BIND_ADDRESS are required and deliberately have NO
 * default value in the code.
 *
 * A `process.env.PORT ?? 3000` made the API listen on 3000 as soon as the
 * variable was missing, i.e. outside the range assigned on the shared machine
 * (21600-21699). A service that starts in the wrong place is harder to diagnose
 * than a service that refuses to start.
 */
const REQUIRED_APP_KEYS = ['PORT', 'API_PREFIX', 'BIND_ADDRESS'] as const;

const URL_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

const formatError = (issues: string[]): string =>
  `Invalid environment configuration:\n  - ${issues.join('\n  - ')}\n` +
  'See .env.example for the list of expected variables.';

const readString = (raw: Record<string, unknown>, key: string): string =>
  typeof raw[key] === 'string' ? raw[key].trim() : '';

/**
 * Parses the string rather than matching it against a regular expression.
 *
 * A `^postgres(ql)?:\/\/.+` regex accepted `postgresql://x`: no usable host, no
 * database. The string passed startup and failed later inside the driver, with
 * a less clear message -- exactly what this validation exists to prevent.
 */
const inspectUrl = (url: string): string | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `DATABASE_URL is not a parseable URL (${EXPECTED_URL}).`;
  }

  if (!URL_PROTOCOLS.has(parsed.protocol)) {
    return `DATABASE_URL does not use the PostgreSQL protocol (${EXPECTED_URL}).`;
  }
  if (parsed.hostname.length === 0) {
    return `DATABASE_URL names no host (${EXPECTED_URL}).`;
  }
  // pathname is "/" when no database is named, "/database" otherwise.
  if (parsed.pathname.replace(/^\//, '').length === 0) {
    return `DATABASE_URL names no database (${EXPECTED_URL}).`;
  }

  return null;
};

/**
 * Checks PORT, API_PREFIX and BIND_ADDRESS, and returns the normalised values.
 *
 * These checks are common to both database configuration paths: whether
 * DATABASE_URL is supplied or assembled changes nothing about the fact that the
 * API needs to know where to listen.
 */
const inspectApp = (
  raw: Record<string, unknown>,
  issues: string[],
): { PORT: number; API_PREFIX: string; BIND_ADDRESS: string } => {
  const missing = REQUIRED_APP_KEYS.filter(
    (key) => readString(raw, key).length === 0,
  );
  if (missing.length > 0) {
    issues.push(
      `Application variables missing or empty: ${missing.join(', ')}.`,
    );
  }

  const port = Number(readString(raw, 'PORT'));
  if (
    !missing.includes('PORT') &&
    (!Number.isInteger(port) || port < 1 || port > 65535)
  ) {
    issues.push('PORT is not a valid port (integer between 1 and 65535).');
  }

  // The prefix is concatenated onto route paths: a missing leading slash or an
  // extra trailing one produces URLs like "api/v1health" or "/api/v1//health",
  // which answer 404 without explaining anything.
  const prefix = readString(raw, 'API_PREFIX');
  if (
    !missing.includes('API_PREFIX') &&
    (!prefix.startsWith('/') || (prefix.length > 1 && prefix.endsWith('/')))
  ) {
    issues.push(
      'API_PREFIX must start with "/" and must not end with "/" (expected: /api/v1).',
    );
  }

  // BIND_ADDRESS has no default for the same reason as PORT, only worse:
  // app.listen(port) with no address listens on 0.0.0.0. On the staging
  // machine, SHARED with other candidates, that would publish the API on every
  // interface -- the nginx proxy would stop being the only entry point and the
  // `deny all` rule on the health probe would become bypassable.
  //
  // The value legitimately differs by context: 127.0.0.1 on the host, 0.0.0.0
  // in the container (isolated network namespace, no published port, and nginx
  // must be able to reach the service over the internal network).
  const bindAddress = readString(raw, 'BIND_ADDRESS');

  return { PORT: port, API_PREFIX: prefix, BIND_ADDRESS: bindAddress };
};

export const validateEnv = (
  raw: Record<string, unknown>,
): Record<string, unknown> => {
  const issues: string[] = [];
  const app = inspectApp(raw, issues);

  // An explicitly supplied DATABASE_URL wins: that is what makes it possible to
  // target a managed or CI database without rewriting five variables.
  const explicitUrl = readString(raw, 'DATABASE_URL');

  if (explicitUrl.length > 0) {
    const issue = inspectUrl(explicitUrl);
    if (issue !== null) {
      issues.push(issue);
    }
    if (issues.length > 0) {
      throw new Error(formatError(issues));
    }
    return { ...raw, ...app, DATABASE_URL: explicitUrl };
  }

  const missing = REQUIRED_DB_KEYS.filter(
    (key) => readString(raw, key).length === 0,
  );
  if (missing.length > 0) {
    issues.push(`Database variables missing or empty: ${missing.join(', ')}.`);
  }

  const port = Number(readString(raw, 'DB_PORT'));
  if (
    !missing.includes('DB_PORT') &&
    (!Number.isInteger(port) || port < 1 || port > 65535)
  ) {
    issues.push('DB_PORT is not a valid port (integer between 1 and 65535).');
  }

  if (issues.length > 0) {
    throw new Error(formatError(issues));
  }

  const env: DatabaseEnv = {
    DB_HOST: readString(raw, 'DB_HOST'),
    DB_PORT: port,
    DB_USER: readString(raw, 'DB_USER'),
    DB_PASSWORD: readString(raw, 'DB_PASSWORD'),
    DB_NAME: readString(raw, 'DB_NAME'),
  };

  // DATABASE_URL is exposed to the rest of the application: PrismaService and
  // the Prisma CLI keep reading the single variable they expect.
  return { ...raw, ...env, ...app, DATABASE_URL: buildDatabaseUrl(env) };
};
