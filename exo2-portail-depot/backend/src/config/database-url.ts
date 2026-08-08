/**
 * Assembles the PostgreSQL connection string from the DB_* variables.
 *
 * Why not write DATABASE_URL directly in .env: it then had to be defined twice
 * -- in full for the host, and rebuilt by concatenation in docker-compose.yml
 * for the container. A password containing / # ? or % produced an invalid URL:
 * the `db` container started normally and the API failed with no visible link
 * to the password. The only mitigation was to document it.
 *
 * Here the assembly happens once, and `encodeURIComponent` escapes every
 * component: any value works. Between host and container, only DB_HOST and
 * DB_PORT change.
 */

export interface DatabaseEnv {
  DB_HOST: string;
  DB_PORT: string | number;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_NAME: string;
}

export const buildDatabaseUrl = (env: DatabaseEnv): string => {
  const user = encodeURIComponent(env.DB_USER);
  const password = encodeURIComponent(env.DB_PASSWORD);
  // The database name is a path segment: a `/` must be escaped there too,
  // otherwise it would open an extra segment.
  const database = encodeURIComponent(env.DB_NAME);

  return `postgresql://${user}:${password}@${env.DB_HOST}:${String(env.DB_PORT)}/${database}`;
};
