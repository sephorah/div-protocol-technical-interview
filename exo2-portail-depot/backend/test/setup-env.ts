/**
 * Loaded by `setupFiles` in jest-e2e.json, hence executed before the test files
 * -- and therefore AppModule -- are imported.
 *
 * That is necessary: `ConfigModule.forRoot()` is evaluated when the @Module
 * decorator is read, i.e. at import time. Setting the variables in a
 * `beforeAll` happens too late, validation has already failed.
 *
 * Intended consequence: the suite depends on no .env file, and therefore runs
 * identically on a workstation, on a bare machine and in CI.
 *
 * These values open no connection: PrismaService and StorageService are
 * replaced by doubles in every suite.
 */
process.env.PORT = '21610';
process.env.API_PREFIX = '/api/v1';
process.env.BIND_ADDRESS = '127.0.0.1';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '5432';
process.env.DB_USER = 'test';
process.env.DB_PASSWORD = 'test';
process.env.DB_NAME = 'portail_depot_test';
process.env.STORAGE_ENDPOINT = 'http://127.0.0.1:21690';
process.env.STORAGE_REGION = 'us-east-1';
process.env.STORAGE_BUCKET = 'portail-depot-test';
process.env.STORAGE_ACCESS_KEY = 'test';
process.env.STORAGE_SECRET_KEY = 'test';
// 32 characters minimum, enforced by validateEnv.
process.env.JWT_SECRET = 'test-jwt-secret-for-the-e2e-suites';
// The production value, so that the cookie's Max-Age asserted by
// auth.e2e-spec.ts is the one a real deployment produces.
process.env.JWT_EXPIRES = '2h';
// The SEED_LAWYER_* variables are deliberately absent: they are read by
// src/seed.ts alone, never by the API, so requiring them here would make every
// e2e suite depend on a fixture it does not use.
