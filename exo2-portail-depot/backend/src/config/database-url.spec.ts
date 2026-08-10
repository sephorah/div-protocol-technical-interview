import { buildDatabaseUrl } from './database-url';

describe('buildDatabaseUrl', () => {
  const base = {
    DB_HOST: 'db',
    DB_PORT: 5432,
    DB_USER: 'portail',
    DB_PASSWORD: 'password',
    DB_NAME: 'portail_depot',
  };

  it('assembles a complete PostgreSQL URL', () => {
    expect(buildDatabaseUrl(base)).toBe(
      'postgresql://portail:password@db:5432/portail_depot',
    );
  });

  it('accepts a port given as a string', () => {
    expect(buildDatabaseUrl({ ...base, DB_PORT: '21632' })).toContain(
      ':21632/',
    );
  });

  /**
   * The core reason this function exists: with a URL concatenated in
   * docker-compose.yml, every one of these passwords produced an unparseable
   * string and the API refused to start.
   */
  it.each(['pa/ss', 'p@ss'])(
    'survives a password containing a reserved character (%s)',
    (password) => {
      const url = buildDatabaseUrl({ ...base, DB_PASSWORD: password });

      const parsed = new URL(url);
      expect(parsed.hostname).toBe('db');
      expect(parsed.port).toBe('5432');
      expect(parsed.pathname).toBe('/portail_depot');
      // decodeURIComponent, not parsed.password: the latter stays encoded.
      expect(decodeURIComponent(parsed.password)).toBe(password);
    },
  );

  it('escapes the user and the database name too', () => {
    const url = buildDatabaseUrl({
      ...base,
      DB_USER: 'a/b',
      DB_NAME: 'test database',
    });

    const parsed = new URL(url);
    expect(decodeURIComponent(parsed.username)).toBe('a/b');
    expect(decodeURIComponent(parsed.pathname)).toBe('/test database');
  });
});
