/**
 * Cryptographic primitives of the portal: generating and verifying the secrets
 * that protect a deposit link.
 *
 * They live here rather than in the business services so that the security
 * decisions fit in one readable file, and so that B1 (lawyer auth), B2 (request
 * creation) and C1 (PIN unlock) share exactly the same treatment.
 *
 * Shared rule: every random draw goes through node:crypto, never through
 * Math.random -- the latter is a V8 pseudo-random generator whose sequence can
 * be reconstructed from a handful of observed outputs.
 */

import { createHash, randomBytes, randomInt } from 'node:crypto';
import * as argon2 from 'argon2';

/**
 * Argon2id parameters, the OWASP reference configuration
 * (19 MiB of memory, 2 iterations, 1 lane).
 *
 * The library default (64 MiB, 3 iterations) measured at ~312 ms per hash on
 * this machine, against ~67 ms here. The gap buys little -- hashes are salted,
 * so it only helps against an offline attack after a database leak -- and it is
 * paid on the portal's most exposed path: /public/:token/unlock, open to an
 * anonymous client. At 312 ms and 64 MiB per request, and for as long as G1
 * (rate limiting) does not exist, that is a comfortable amplification factor
 * for saturating the API on the cheap.
 *
 * These values are deliberately constants rather than environment variables: a
 * mistyped cost parameter degrades security silently. Raising them later does
 * not invalidate existing hashes, since the stored PHC string carries its own
 * parameters.
 *
 * `satisfies` rather than a type annotation: argon2.hash has two overloads, and
 * the one accepting `raw: true` returns a Buffer. Annotating the constant with
 * HashOptions would make `raw` potentially present, hence the return type
 * potentially binary. Leaving the type inferred selects the "PHC string"
 * overload while still checking the keys.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} satisfies argon2.HashOptions;

/** Public token length, in bytes. 32 bytes = 256 bits of entropy. */
const TOKEN_BYTES = 32;

/** The PIN is 4 digits, as the exercise statement mandates. */
const PIN_DIGITS = 4;

/**
 * An opaque bearer token: 256 bits drawn from the operating system generator,
 * encoded as base64url. Used by public deposit links and by refresh tokens --
 * both are secrets whose holder gets access, and neither can be guessed.
 *
 * base64url rather than hex: 43 characters instead of 64 for the same entropy,
 * and an alphabet that is safe in a URL as well as in a QR code -- this link is
 * meant to be pasted into an email.
 *
 * randomUUID() is ruled out: a UUIDv4 only carries 122 bits and its structure
 * is recognisable at a glance.
 */
export const generatePublicToken = (): string =>
  randomBytes(TOKEN_BYTES).toString('base64url');

/**
 * What is actually stored in the database in place of the token.
 *
 * The token is a bearer credential: holding it is enough to reach the request.
 * Keeping it in clear would repeat, on the link, the mistake we refuse for the
 * password -- a database leak would hand over every active link.
 *
 * SHA-256 rather than argon2id: argon2 exists to make brute-forcing a
 * low-entropy secret expensive. A 256-bit token cannot be guessed, and a fast
 * hash keeps the lookup indexed in a single read.
 */
export const hashPublicToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

/**
 * A 4-digit PIN, leading zeros preserved -- hence the string type: "0042" is a
 * valid PIN, and 42 is not the same thing.
 *
 * randomInt is unbiased (it rejects draws that would overflow the range),
 * whereas Math.floor(Math.random() * 10000) would be both biased and
 * predictable.
 */
export const generatePin = (): string =>
  String(randomInt(0, 10 ** PIN_DIGITS)).padStart(PIN_DIGITS, '0');

/**
 * Hashes a password or a PIN with argon2id.
 *
 * The result is a PHC string (`$argon2id$v=19$m=...$salt$hash`) carrying both
 * salt and parameters: that is what gets stored, and verifySecret reads the
 * parameters back from the hash rather than from the current configuration.
 */
export const hashSecret = (value: string): Promise<string> =>
  argon2.hash(value, ARGON2_OPTIONS);

/**
 * Verifies a value against a stored hash.
 *
 * An unreadable hash (truncated column, hand-migrated data) returns false
 * instead of throwing: on the unlock path, an exception would surface as a 500
 * where a wrong PIN returns an authentication error, which would give an
 * attacker a way to tell the two cases apart.
 */
export const verifySecret = async (
  value: string,
  storedHash: string,
): Promise<boolean> => {
  try {
    return await argon2.verify(storedHash, value);
  } catch {
    return false;
  }
};

/**
 * Object key in MinIO.
 *
 * Prefixed per request: MinIO has no directories, but the S3 API can list and
 * delete by prefix. Deleting a request therefore becomes an erase over
 * `requests/<requestId>/`, which stays correct even once the SQL cascade has
 * removed the rows carrying the keys.
 *
 * The client-supplied name only enters the key after sanitisation, and it is
 * preceded by a random identifier anyway: two files of the same name cannot
 * overwrite each other, and no `../` sequence survives. The original name stays
 * in the database, for display only.
 */
export const buildStorageKey = (
  requestId: string,
  itemId: string,
  originalName: string,
): string => {
  const safeName =
    originalName
      .normalize('NFKD')
      // Anything that is not alphanumeric, dot, dash or underscore becomes a
      // dash: this neutralises `/`, `\` and control bytes.
      .replace(/[^A-Za-z0-9._-]/g, '-')
      // Consecutive dots collapse into one. Separators are already gone, so
      // `..` can no longer climb a level here -- but the key ends up read by
      // other tools (sync, archive extraction) that do know how to interpret it.
      .replace(/\.{2,}/g, '.')
      // A name reduced to dots or dashes must not survive as a path segment,
      // nor produce a hidden file.
      .replace(/^[.-]+/, '')
      .slice(0, 100) || 'file';

  return `requests/${requestId}/items/${itemId}/${randomBytes(8).toString('hex')}-${safeName}`;
};
