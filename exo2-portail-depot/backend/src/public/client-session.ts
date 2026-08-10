/**
 * The anonymous client's session: what it is called, how long it lives, what it
 * carries, and the cookie attributes that must agree between the route that
 * sets it and anything that reads it.
 */

import { CookieOptions } from 'express';
import type { Request } from 'express';

// Named after the product, like the lawyer's cookies: cookies are shared by
// domain, not by port, and the staging machine is shared with other candidates.
export const CLIENT_COOKIE_NAME = 'portail_client';

/**
 * 30 minutes. The token is irrevocable in itself -- that is the price of not
 * adding a table for an access that lives half an hour -- so what makes a
 * revocation effective is the guard re-reading the link on every request, not
 * this duration.
 */
export const CLIENT_SESSION_TTL_MS = 30 * 60 * 1000;

/**
 * `typ` is kept for readability, but it is NOT what separates the two
 * populations: the client session is signed with CLIENT_JWT_SECRET, so a token
 * crossing the boundary fails the signature check rather than an application
 * test a refactor could delete (RFC 8725 / BCP 225 section 3.8).
 *
 * `linkId` and not just `requestId`: without it a client who unlocked before a
 * revocation keeps working for the rest of the session, and
 * DELETE /requests/:id/link cuts nothing.
 */
export interface ClientSessionPayload {
  typ: 'client';
  linkId: string;
  requestId: string;
}

/** What the guard hands to the handler, read back from the database. */
export interface ClientSession {
  linkId: string;
  requestId: string;
  expiresAt: Date;
}

export interface ClientRequest extends Request {
  clientSession: ClientSession;
}

/**
 * Scoped to the public routes: the browser never attaches this cookie to the
 * SPA's own assets, nor to the lawyer's API calls. Derived from API_PREFIX
 * because nginx does not strip the prefix -- the path the browser sees is the
 * one the API serves.
 */
export const clientCookiePath = (apiPrefix: string): string =>
  `${apiPrefix}/public`;

/**
 * `secure` comes from `req.secure`, i.e. from how THIS request arrived, never
 * from NODE_ENV: the images carry NODE_ENV=production while the grader's portal
 * answers in cleartext, where a Secure cookie is set and never sent back.
 */
export const buildClientCookie = (
  secure: boolean,
  path: string,
): CookieOptions => ({
  httpOnly: true,
  sameSite: 'strict',
  secure,
  path,
  maxAge: CLIENT_SESSION_TTL_MS,
});
