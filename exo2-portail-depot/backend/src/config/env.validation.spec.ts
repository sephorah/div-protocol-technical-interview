import { validateEnv } from './env.validation';

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

  const app = { ...appOnly, ...storage };

  const db = {
    ...app,
    DB_HOST: 'db',
    DB_PORT: '5432',
    DB_USER: 'portail',
    DB_PASSWORD: 'password',
    DB_NAME: 'portail_depot',
  };

  it('builds DATABASE_URL from the DB_* variables', () => {
    expect(validateEnv({ ...db })).toMatchObject({
      DATABASE_URL: 'postgresql://portail:password@db:5432/portail_depot',
    });
  });

  it('preserves the other variables', () => {
    expect(validateEnv({ ...db, JWT_SECRET: 'x' })).toMatchObject({
      JWT_SECRET: 'x',
    });
  });

  it('trims surrounding whitespace', () => {
    expect(validateEnv({ ...db, DB_HOST: '  db  ' })).toMatchObject({
      DATABASE_URL: 'postgresql://portail:password@db:5432/portail_depot',
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

  it.each(['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'])(
    'rejects a configuration without %s',
    (key) => {
      expect(() => validateEnv({ ...db, [key]: '' })).toThrow(
        new RegExp(`missing or empty.*${key}`),
      );
    },
  );

  it.each(['0', '70000', 'abc', '5432.5'])(
    'rejects an invalid DB_PORT (%s)',
    (port) => {
      expect(() => validateEnv({ ...db, DB_PORT: port })).toThrow(
        /DB_PORT is not a valid port/,
      );
    },
  );

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

    it.each(['PORT', 'API_PREFIX', 'BIND_ADDRESS'])(
      'rejects a configuration without %s',
      (key) => {
        // No default value: on a shared machine, an API listening in the wrong
        // place is worse than an API that does not start.
        expect(() => validateEnv({ ...db, [key]: '' })).toThrow(
          new RegExp(`Application variables missing or empty.*${key}`),
        );
      },
    );

    it.each(['0', '70000', 'abc', '3000.5'])(
      'rejects an invalid PORT (%s)',
      (port) => {
        expect(() => validateEnv({ ...db, PORT: port })).toThrow(
          /PORT is not a valid port/,
        );
      },
    );

    it.each(['api/v1', '/api/v1/', 'https://elsewhere/api'])(
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
    it.each([
      'STORAGE_ENDPOINT',
      'STORAGE_REGION',
      'STORAGE_BUCKET',
      'STORAGE_ACCESS_KEY',
      'STORAGE_SECRET_KEY',
    ])('rejects a configuration without %s', (key) => {
      expect(() => validateEnv({ ...db, [key]: '' })).toThrow(
        new RegExp(`Storage variables missing or empty.*${key}`),
      );
    });

    it('names every missing variable at once', () => {
      // One restart per missing variable would be a poor way to discover a
      // five-variable block.
      expect(() => validateEnv({ ...appOnly })).toThrow(
        /Storage variables missing or empty: STORAGE_ENDPOINT, STORAGE_REGION, STORAGE_BUCKET, STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY/,
      );
    });

    it.each(['minio:9000', 'http://', '://minio'])(
      'rejects an unusable STORAGE_ENDPOINT (%s)',
      (endpoint) => {
        expect(() =>
          validateEnv({ ...db, STORAGE_ENDPOINT: endpoint }),
        ).toThrow(/STORAGE_ENDPOINT/);
      },
    );

    it('rejects a STORAGE_ENDPOINT that is not HTTP', () => {
      expect(() =>
        validateEnv({ ...db, STORAGE_ENDPOINT: 's3://minio:9000' }),
      ).toThrow(/does not use the HTTP protocol/);
    });

    it.each(['Portail-Depot', 'ab', 'depot_portail', '-depot', 'depot-'])(
      'rejects an invalid bucket name (%s)',
      (bucket) => {
        // A bucket name is only rejected by MinIO at CreateBucket, i.e. on the
        // first real boot, long after the typo was written.
        expect(() => validateEnv({ ...db, STORAGE_BUCKET: bucket })).toThrow(
          /STORAGE_BUCKET is not a valid bucket name/,
        );
      },
    );

    it('survives an explicitly supplied DATABASE_URL', () => {
      // That path returns early: forgetting to merge the storage keys into it
      // would silently strip them from the configuration.
      expect(
        validateEnv({
          ...app,
          DATABASE_URL: 'postgresql://user:pwd@elsewhere:5432/managed',
        }),
      ).toMatchObject(storage);
    });
  });

  it('never copies a secret into the error message', () => {
    expect(() =>
      validateEnv({
        ...db,
        DB_PORT: '',
        DB_PASSWORD: 'VerySecretPassword',
        JWT_SECRET: 'VerySecretToken',
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
