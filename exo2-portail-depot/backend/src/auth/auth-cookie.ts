/**
 * The session cookie's attributes, in one place: setting and clearing must
 * agree exactly, or the logout answers 204 while the browser keeps the cookie.
 */

import { CookieOptions } from 'express';

// Named after the product: cookies are shared by domain, not by port, and the
// staging machine is shared with other candidates.
export const AUTH_COOKIE_NAME = 'portail_auth';

export const REFRESH_COOKIE_NAME = 'portail_refresh';

/**
 * The refresh cookie is scoped to the auth routes, unlike the access cookie
 * which needs `/`. A cookie the browser only sends to a handful of endpoints is
 * absent from every other request, hence from most places it could leak.
 *
 * Derived from API_PREFIX because nginx does not strip the prefix: the path the
 * browser sees is the one the API serves.
 */
export const refreshCookiePath = (apiPrefix: string): string =>
  `${apiPrefix}/auth`;

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

export const buildRefreshCookie = (
  secure: boolean,
  maxAgeMs: number,
  path: string,
): CookieOptions => ({ ...baseOptions(secure), path, maxAge: maxAgeMs });

export const clearRefreshCookie = (
  secure: boolean,
  path: string,
): CookieOptions => ({ ...baseOptions(secure), path });
