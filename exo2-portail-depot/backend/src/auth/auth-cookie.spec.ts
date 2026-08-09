/**
 * What these tests protect: the attributes of the session cookie, and the fact
 * that setting and clearing agree.
 *
 * A logout that clears with different attributes answers 204 while leaving the
 * cookie in the browser -- the lawyer believes they are logged out and is not.
 * No functional test catches that: both requests succeed.
 */

import {
  buildAuthCookie,
  clearAuthCookie,
  durationToMilliseconds,
} from './auth-cookie';

describe('durationToMilliseconds', () => {
  it.each([
    ['60s', 60_000],
    ['15m', 900_000],
    ['2h', 7_200_000],
    ['7d', 604_800_000],
  ])('converts %s', (duration, expected) => {
    expect(durationToMilliseconds(duration)).toBe(expected);
  });

  // A bare number is precisely what validateEnv rejects for JWT_EXPIRES: it
  // means seconds to jsonwebtoken and milliseconds as a numeric string. Here it
  // must not silently become NaN, which would produce a cookie with no expiry.
  // '0s' and '0h' parse arithmetically and are the dangerous ones: they would
  // produce a token expired at signing time and a cookie the browser discards
  // on arrival, so every login would answer 200 with no session behind it.
  it.each(['900', '2 h', 'two hours', '', '2y', '0s', '0h'])(
    'rejects %p',
    (invalid) => {
      expect(() => durationToMilliseconds(invalid)).toThrow(/JWT_EXPIRES/);
    },
  );
});

describe('the session cookie', () => {
  it('is unreachable from JavaScript and never crosses sites', () => {
    const options = buildAuthCookie(false, 7_200_000);

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('strict');
    expect(options.path).toBe('/');
    expect(options.maxAge).toBe(7_200_000);
  });

  it('is Secure only when the request arrived encrypted', () => {
    expect(buildAuthCookie(true, 1).secure).toBe(true);
    expect(buildAuthCookie(false, 1).secure).toBe(false);
  });

  // The real assertion of this file: same attributes on both sides, whatever
  // they are. Written by comparison rather than field by field, so that adding
  // an attribute to buildAuthCookie without adding it to clearAuthCookie fails
  // here.
  it('is cleared with exactly the attributes it was set with', () => {
    const { maxAge, ...set } = buildAuthCookie(true, 7_200_000);
    expect(maxAge).toBeDefined();
    expect(clearAuthCookie(true)).toEqual(set);
  });
});
