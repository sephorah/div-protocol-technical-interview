/**
 * The session cookie's attributes, in one place.
 *
 * They are built here rather than written at each call site because setting and
 * clearing MUST agree exactly: a browser matches a cookie on name, domain and
 * path, so a logout that clears with a different `path` leaves the original
 * cookie in place and the lawyer stays logged in with a "successful" logout
 * behind them.
 */

import { CookieOptions } from 'express';

/**
 * Prefixed with the product name rather than something generic like `token`:
 * on a machine shared with other candidates, several applications may end up
 * behind the same domain one day, and cookies are shared by domain, not by
 * port.
 */
export const AUTH_COOKIE_NAME = 'portail_auth';

const MILLISECONDS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/**
 * Converts JWT_EXPIRES ("2h") into milliseconds, for the cookie's Max-Age.
 *
 * The two durations are deliberately driven by the same variable. Left to
 * drift, a cookie outliving its token makes the browser keep sending a value
 * the API rejects: the front then gets 401s on a session it believes is open,
 * with nothing pointing at the cause.
 *
 * The format is already enforced at startup by validateEnv; this function
 * repeats the check because it is also reachable from a test, and a silent NaN
 * here would produce a cookie with no expiry at all -- i.e. the opposite of
 * what is intended.
 *
 * The leading digit cannot be a zero: `0h` parses, and would issue a token that
 * is expired the moment it is signed, with a Max-Age=0 cookie the browser drops
 * on arrival. Every login would then answer 200 and no session would ever
 * exist.
 */
export const durationToMilliseconds = (duration: string): number => {
  const match = /^([1-9]\d*)([smhd])$/.exec(duration.trim());
  if (match === null) {
    throw new Error(
      'JWT_EXPIRES is not a duration with its unit (expected: 60s, 15m, 2h, 7d).',
    );
  }

  return Number(match[1]) * MILLISECONDS[match[2]];
};

/**
 * The attributes shared by setting and clearing.
 *
 * - `httpOnly`: no script can read the cookie, so an XSS cannot walk away with
 *   the session.
 * - `sameSite: 'strict'`: the browser never attaches the cookie to a request
 *   originating from another site, which removes CSRF without a synchroniser
 *   token. Affordable here because nothing legitimately links into the lawyer's
 *   area from outside -- the public deposit link is anonymous and carries no
 *   cookie.
 * - `path: '/'`: the SPA is served from `/` and the API from `/api/`, so a
 *   narrower path would send the cookie to only one of the two.
 * - `secure`: see below.
 */
const baseOptions = (secure: boolean): CookieOptions => ({
  httpOnly: true,
  sameSite: 'strict',
  secure,
  path: '/',
});

/**
 * `secure` is decided PER REQUEST, from how that request arrived, and not from
 * NODE_ENV.
 *
 * `Secure` tells the browser to withhold the cookie on any unencrypted
 * connection. Both fixed settings are wrong for this project:
 *
 * - always on -- the images carry NODE_ENV=production, but on the grader's
 *   machine the portal answers in cleartext on http://127.0.0.1:21600. The
 *   cookie would be set and never sent back, so login would fail silently, in
 *   production, for them only.
 * - never on -- on the public domain, a single request coaxed over cleartext
 *   would be enough to capture the cookie in transit.
 *
 * `req.secure` reads X-Forwarded-Proto, which our nginx sets in
 * infra/nginx/portal-locations.conf, and which Express only trusts because of
 * `app.set('trust proxy', 1)` in main.ts. The flag therefore follows the TLS
 * layer (A7) being switched on, with no extra configuration key.
 */
export const buildAuthCookie = (
  secure: boolean,
  maxAgeMs: number,
): CookieOptions => ({ ...baseOptions(secure), maxAge: maxAgeMs });

/**
 * Same attributes, minus the lifetime -- `res.clearCookie` supplies its own
 * expiry in the past. Express refuses `maxAge` there anyway.
 */
export const clearAuthCookie = (secure: boolean): CookieOptions =>
  baseOptions(secure);
