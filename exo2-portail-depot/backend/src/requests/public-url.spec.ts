import { buildDepositUrl } from './public-url';

describe('buildDepositUrl', () => {
  it('composes the client address on the English deposit path', () => {
    expect(buildDepositUrl('https://portail.example', 'abc')).toBe(
      'https://portail.example/deposit/abc',
    );
  });

  it('appends the deposit path and the token to the origin', () => {
    expect(buildDepositUrl('https://portail.example.com', 'abc123')).toBe(
      'https://portail.example.com/deposit/abc123',
    );
  });

  // validateEnv already normalises, but the seed reads the value through
  // ConfigService too, and a doubled slash would produce a URL the SPA router
  // does not match -- a 404 the lawyer only hears about from their client.
  it('tolerates a trailing slash on the origin', () => {
    expect(buildDepositUrl('https://portail.example.com/', 'abc123')).toBe(
      'https://portail.example.com/deposit/abc123',
    );
  });

  it('percent-encodes the token', () => {
    // A no-op on base64url, which is URL-safe by construction. It is the guard
    // for the day the alphabet changes: without it the token would silently
    // truncate at the first "/" or "?".
    expect(buildDepositUrl('https://x.test', 'a/b?c')).toBe(
      'https://x.test/deposit/a%2Fb%3Fc',
    );
  });
});
