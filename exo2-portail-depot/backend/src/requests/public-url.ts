/**
 * The client-facing path.
 *
 * Frozen by the exercise statement, which places the token in the PATH
 * (POST /public/:token/unlock). That choice has a cost -- a path is written to
 * nginx's access log -- so the same segment is repeated in the log-redaction
 * map, infra/nginx/log-redact.conf, and in the SPA's route. Moving it here
 * without moving it there breaks nothing visible: the portal keeps answering
 * and the token reappears IN CLEAR in access.log.
 */
export const DEPOSIT_PATH = '/deposit';

/**
 * The address handed to the client, built from a CONFIGURED origin rather than
 * from the request's Host header: that header is supplied by the caller, so a
 * forged call would make the API return a link pointing at an attacker's
 * domain -- which the lawyer would then paste into an email to their client.
 */
export const buildDepositUrl = (baseUrl: string, token: string): string =>
  `${baseUrl.replace(/\/+$/, '')}${DEPOSIT_PATH}/${encodeURIComponent(token)}`;
