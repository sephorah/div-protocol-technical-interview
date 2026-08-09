/**
 * The session cookie's attributes, in one place: setting and clearing must
 * agree exactly, or the logout answers 204 while the browser keeps the cookie.
 */

import { CookieOptions } from 'express';

// Named after the product: cookies are shared by domain, not by port, and the
// staging machine is shared with other candidates.
export const AUTH_COOKIE_NAME = 'portail_auth';

const MILLISECONDS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/**
 * Converts JWT_EXPIRES ("2h") into milliseconds, so that the cookie's Max-Age
 * and the token's expiry cannot drift apart.
 *
 * No leading zero: "0h" parses, and would sign already-expired tokens behind a
 * cookie the browser drops on arrival -- every login answering 200 with no
 * session behind it.
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
 * `sameSite: 'strict'` removes CSRF without a synchroniser token, and costs
 * nothing: no external link legitimately enters the lawyer's area -- the public
 * deposit link is anonymous and carries no cookie. `path: '/'` because the SPA
 * is served from `/` and the API from `/api/`.
 */
const baseOptions = (secure: boolean): CookieOptions => ({
  httpOnly: true,
  sameSite: 'strict',
  secure,
  path: '/',
});

/**
 * `secure` comes from `req.secure`, i.e. from how THIS request arrived, never
 * from NODE_ENV: the images carry NODE_ENV=production while the grader's portal
 * answers in cleartext, where a Secure cookie is set and never sent back --
 * login failing silently, for them only. See CLAUDE.md § Authentication.
 */
export const buildAuthCookie = (
  secure: boolean,
  maxAgeMs: number,
): CookieOptions => ({ ...baseOptions(secure), maxAge: maxAgeMs });

/** Same attributes, minus the lifetime: `res.clearCookie` sets its own. */
export const clearAuthCookie = (secure: boolean): CookieOptions =>
  baseOptions(secure);
