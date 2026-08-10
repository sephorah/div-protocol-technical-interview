import { validateEnv } from './env.validation';

/**
 * What this suite protects: a startup that refuses a configuration it cannot
 * honour, naming what is wrong without ever echoing a secret.
 *
 * The duration formats themselves are duration.spec.ts; only the two values
 * whose misreading is silent are replayed here.
 */
describe('validateEnv', () => {
  const storage = {
    STORAGE_ENDPOINT: 'http://minio:9000',
    STORAGE_REGION: 'us-east-1',
    STORAGE_BUCKET: 'portail-depot',
    STORAGE_ACCESS_KEY: 'access',
    STORAGE_SECRET_KEY: 'secret',
  };

  // Application keys alone, without storage: the fixture the storage tests need
  // in order to observe a configuration where the whole block is missing.
  const appOnly = {
    PORT: '21610',
    API_PREFIX: '/api/v1',
    BIND_ADDRESS: '127.0.0.1',
  };

  const auth = {
    JWT_SECRET: 'a'.repeat(32),
    CLIENT_JWT_SECRET: 'b'.repeat(32),
    JWT_EXPIRES: '15m',
    SESSION_EXPIRES: '7d',
    SESSION_IDLE_EXPIRES: '3d',
  };

  const publicSurface = { PUBLIC_BASE_URL: 'https://portail.example.com' };

  const app = { ...appOnly, ...auth, ...storage, ...publicSurface };

  const db = {
    ...app,
    DB_HOST: 'db',
    DB_PORT: '5432',
    DB_USER: 'portail',
    DB_PASSWORD: 'password',
    DB_NAME: 'portail_depot',
  };

  it('builds DATABASE_URL from the DB_* variables', () => {
    expect(validateEnv({ ...db, DB_HOST: '  db  ' })).toMatchObject({
      DATABASE_URL: 'postgresql://portail:password@db:5432/portail_depot',
    });
  });

  it('preserves the other variables', () => {
    // Whatever the validation does not know about reaches ConfigService intact.
    expect(validateEnv({ ...db, NODE_ENV: 'production' })).toMatchObject({
      NODE_ENV: 'production',
    });
  });

  /**
   * The case that motivated this whole module: a URL concatenated in the
   * compose file became unparseable, whereas here it is simply encoded.
   */
  it('accepts a password containing reserved characters', () => {
    const result = validateEnv({ ...db, DB_PASSWORD: 'pa/ss#1?x' });

    expect(() => new URL(result.DATABASE_URL as string)).not.toThrow();
  });

  it('rejects a configuration missing a DB_* variable', () => {
    expect(() => validateEnv({ ...db, DB_PASSWORD: '' })).toThrow(
      /missing or empty.*DB_PASSWORD/,
    );
  });

  it.each(['0', 'abc'])('rejects an invalid DB_PORT (%s)', (port) => {
    expect(() => validateEnv({ ...db, DB_PORT: port })).toThrow(
      /DB_PORT is not a valid port/,
    );
  });

  describe('explicitly supplied DATABASE_URL', () => {
    const url = 'postgresql://user:pwd@elsewhere:5432/managed';

    it('wins over the DB_* variables (managed database, CI database)', () => {
      expect(validateEnv({ ...db, DATABASE_URL: url })).toMatchObject({
        DATABASE_URL: url,
      });
    });

    it('makes the DB_* variables unnecessary', () => {
      expect(() => validateEnv({ ...app, DATABASE_URL: url })).not.toThrow();
    });

    it('does NOT waive PORT, API_PREFIX or BIND_ADDRESS', () => {
      // Otherwise the "managed database" path would bypass every
      // application-level check.
      expect(() => validateEnv({ DATABASE_URL: url })).toThrow(
        /Application variables missing or empty: PORT, API_PREFIX, BIND_ADDRESS/,
      );
    });

    it('rejects a protocol that is not PostgreSQL', () => {
      expect(() =>
        validateEnv({ DATABASE_URL: 'mysql://user:p@db:3306/portail' }),
      ).toThrow(/PostgreSQL protocol/);
    });

    it('rejects a URL with no database', () => {
      expect(() =>
        validateEnv({ DATABASE_URL: 'postgresql://user:p@db:5432' }),
      ).toThrow(/names no database/);
    });

    it('rejects a URL with no host', () => {
      expect(() =>
        validateEnv({ DATABASE_URL: 'postgresql:///portail' }),
      ).toThrow(/names no host/);
    });

    it('still carries the storage, auth and public settings', () => {
      // That path returns early: forgetting to merge those blocks into it would
      // silently strip them whenever a managed database is targeted.
      expect(validateEnv({ ...app, DATABASE_URL: url })).toMatchObject({
        ...storage,
        ...auth,
        ...publicSurface,
      });
    });
  });

  describe('PORT, API_PREFIX and BIND_ADDRESS', () => {
    it('exposes PORT as a number, ready for app.listen', () => {
      expect(validateEnv({ ...db })).toMatchObject({ PORT: 21610 });
    });

    it('exposes BIND_ADDRESS, without which the API would listen on 0.0.0.0', () => {
      // app.listen(port) with no address listens on every interface. On the
      // staging machine, shared with other candidates, that would make the API
      // reachable around the proxy.
      expect(validateEnv({ ...db })).toMatchObject({
        BIND_ADDRESS: '127.0.0.1',
      });
    });

    it('rejects a configuration without BIND_ADDRESS', () => {
      // No default value: on a shared machine, an API listening in the wrong
      // place is worse than an API that does not start.
      expect(() => validateEnv({ ...db, BIND_ADDRESS: '' })).toThrow(
        /Application variables missing or empty.*BIND_ADDRESS/,
      );
    });

    it.each(['0', 'abc'])('rejects an invalid PORT (%s)', (port) => {
      expect(() => validateEnv({ ...db, PORT: port })).toThrow(
        /PORT is not a valid port/,
      );
    });

    it.each(['api/v1', '/api/v1/'])(
      'rejects a malformed API_PREFIX (%s)',
      (prefix) => {
        expect(() => validateEnv({ ...db, API_PREFIX: prefix })).toThrow(
          /API_PREFIX must start with/,
        );
      },
    );

    it('accepts "/", meaning "no prefix"', () => {
      expect(() => validateEnv({ ...db, API_PREFIX: '/' })).not.toThrow();
    });
  });

  describe('object storage', () => {
    it('names every missing variable at once', () => {
      // One restart per missing variable would be a poor way to discover a
      // five-variable block.
      expect(() => validateEnv({ ...appOnly })).toThrow(
        /Storage variables missing or empty: STORAGE_ENDPOINT, STORAGE_REGION, STORAGE_BUCKET, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY/,
      );
    });

    it.each(['minio:9000', 's3://minio:9000'])(
      'rejects an unusable STORAGE_ENDPOINT (%s)',
      (endpoint) => {
        expect(() =>
          validateEnv({ ...db, STORAGE_ENDPOINT: endpoint }),
        ).toThrow(/STORAGE_ENDPOINT/);
      },
    );

    it.each(['Portail-Depot', 'depot_portail'])(
      'rejects an invalid bucket name (%s)',
      (bucket) => {
        // A bucket name is only rejected by MinIO at CreateBucket, i.e. on the
        // first real boot, long after the typo was written.
        expect(() => validateEnv({ ...db, STORAGE_BUCKET: bucket })).toThrow(
          /STORAGE_BUCKET is not a valid bucket name/,
        );
      },
    );
  });

  describe('lawyer authentication', () => {
    it('rejects a configuration without JWT_SECRET', () => {
      // Documented and generated long before anything read it: unvalidated, it
      // stayed dead configuration, and setting it changed nothing.
      expect(() => validateEnv({ ...db, JWT_SECRET: '' })).toThrow(
        /Auth variables missing or empty.*JWT_SECRET/,
      );
    });

    it('rejects a JWT_SECRET shorter than 32 characters', () => {
      // The attack is offline: one captured token is enough to brute-force the
      // secret without ever calling the API, so no rate limiting protects it.
      expect(() => validateEnv({ ...db, JWT_SECRET: 'a'.repeat(31) })).toThrow(
        /JWT_SECRET is shorter than 32 characters/,
      );
    });

    it('accepts a JWT_SECRET of exactly 32 characters', () => {
      expect(() =>
        validateEnv({ ...db, JWT_SECRET: 'a'.repeat(32) }),
      ).not.toThrow();
    });

    it('rejects a CLIENT_JWT_SECRET shorter than 32 characters', () => {
      expect(() =>
        validateEnv({ ...db, CLIENT_JWT_SECRET: 'a'.repeat(31) }),
      ).toThrow(/CLIENT_JWT_SECRET is shorter than 32 characters/);
    });

    // The two populations must not share a key: with one secret, a deposit
    // session presented to the lawyer's guard would pass the signature check
    // and the boundary would hold on an application test alone (RFC 8725 3.8).
    it('rejects a CLIENT_JWT_SECRET equal to JWT_SECRET', () => {
      expect(() =>
        validateEnv({
          ...db,
          JWT_SECRET: 'a'.repeat(32),
          CLIENT_JWT_SECRET: 'a'.repeat(32),
        }),
      ).toThrow(/CLIENT_JWT_SECRET must differ from JWT_SECRET/);
    });

    it.each(['900', '0h'])(
      'rejects a JWT_EXPIRES without a usable unit (%s)',
      (expires) => {
        // "900" is the dangerous one: jsonwebtoken reads a bare number as
        // seconds and a numeric string as milliseconds, so a quote decides
        // between a 15-minute session and a 0.9-second one. "0h" is the other:
        // it parses, and issues tokens already expired -- a login answering 200
        // with no session behind it.
        expect(() => validateEnv({ ...db, JWT_EXPIRES: expires })).toThrow(
          /JWT_EXPIRES is not a duration with its unit/,
        );
      },
    );

    it('rejects a SESSION_EXPIRES without a usable unit', () => {
      expect(() => validateEnv({ ...db, SESSION_EXPIRES: '900' })).toThrow(
        /SESSION_EXPIRES is not a duration with its unit/,
      );
    });

    /**
     * The misconfiguration that does nothing and says nothing: an idle deadline
     * further away than the ceiling can never be reached, so the protection is
     * off while the variable looks configured. Equality is the boundary.
     */
    it('rejects an idle deadline the ceiling makes unreachable', () => {
      expect(() =>
        validateEnv({
          ...db,
          SESSION_EXPIRES: '7d',
          SESSION_IDLE_EXPIRES: '7d',
        }),
      ).toThrow(/SESSION_IDLE_EXPIRES must be shorter than SESSION_EXPIRES/);
    });

    it('accepts an idle deadline shorter than the ceiling', () => {
      expect(() =>
        validateEnv({
          ...db,
          SESSION_EXPIRES: '7d',
          SESSION_IDLE_EXPIRES: '3d',
        }),
      ).not.toThrow();
    });
  });

  describe('PUBLIC_BASE_URL', () => {
    it('rejects a URL that is not HTTP', () => {
      expect(() =>
        validateEnv({ ...db, PUBLIC_BASE_URL: 'ftp://portail.example.com' }),
      ).toThrow(/PUBLIC_BASE_URL/);
    });

    it('rejects an origin carrying a path', () => {
      // A base ending in /portail would produce https://host/portail/deposit/<t>,
      // which the SPA does not serve -- and the lawyer would only find out from
      // a client's 404.
      expect(() =>
        validateEnv({ ...db, PUBLIC_BASE_URL: 'https://example.com/portail' }),
      ).toThrow(/PUBLIC_BASE_URL/);
    });

    it('strips the trailing slash', () => {
      expect(
        validateEnv({ ...db, PUBLIC_BASE_URL: 'https://example.com/' }),
      ).toMatchObject({ PUBLIC_BASE_URL: 'https://example.com' });
    });
  });

  it('never copies a secret into the error message', () => {
    expect(() =>
      validateEnv({
        ...db,
        DB_PORT: '',
        DB_PASSWORD: 'VerySecretPassword',
        JWT_SECRET: 'VerySecretToken',
        CLIENT_JWT_SECRET: 'VerySecretClientToken',
        STORAGE_BUCKET: 'INVALID',
        STORAGE_SECRET_KEY: 'VerySecretStorageKey',
      }),
    ).toThrow(
      expect.objectContaining({
        message: expect.not.stringMatching(/VerySecret/) as string,
      }) as Error,
    );
  });
});
