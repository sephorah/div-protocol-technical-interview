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
  buildRefreshCookie,
  clearAuthCookie,
  clearRefreshCookie,
  refreshCookiePath,
} from './auth-cookie';

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

describe('the refresh cookie', () => {
  // Restricted to the auth routes, so the browser never attaches it to an
  // ordinary API call: the long-lived secret is then absent from the vast
  // majority of requests, hence from most places it could leak.
  it('is scoped to the authentication routes', () => {
    expect(refreshCookiePath('/api/v1')).toBe('/api/v1/auth');
    expect(buildRefreshCookie(false, 1000, '/api/v1/auth').path).toBe(
      '/api/v1/auth',
    );
  });

  it('is unreachable from JavaScript and never crosses sites', () => {
    const options = buildRefreshCookie(true, 604_800_000, '/api/v1/auth');

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('strict');
    expect(options.secure).toBe(true);
    expect(options.maxAge).toBe(604_800_000);
  });

  it('is cleared with exactly the attributes it was set with', () => {
    const { maxAge, ...set } = buildRefreshCookie(
      true,
      604_800_000,
      '/api/v1/auth',
    );
    expect(maxAge).toBeDefined();
    expect(clearRefreshCookie(true, '/api/v1/auth')).toEqual(set);
  });
});
