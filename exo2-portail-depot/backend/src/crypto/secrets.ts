/**
 * The portal's cryptographic primitives, in one file so the security decisions
 * are read together. See docs/architecture.md § Le modele de donnees.
 *
 * Every random draw goes through node:crypto, never Math.random.
 */

import { createHash, randomBytes, randomInt } from 'node:crypto';
import * as argon2 from 'argon2';

/**
 * The OWASP reference parameters, measured at 67 ms here against 312 ms for the
 * library defaults -- which are rejected because the unlock route is anonymous
 * and has no rate limiting. Constants, not environment variables: a mistyped
 * cost degrades security in silence.
 *
 * `satisfies` and not a type annotation: annotating with HashOptions would make
 * `raw` potentially present, hence the return type potentially a Buffer.
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

/** 256 bits in base64url: safe in a URL, 43 characters instead of hex's 64. */
export const generatePublicToken = (): string =>
  randomBytes(TOKEN_BYTES).toString('base64url');

/**
 * SHA-256 and not argon2id: a 256-bit token cannot be guessed, so a fast hash
 * suffices -- and it keeps the lookup by token a single indexed read.
 */
export const hashPublicToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

/**
 * A string, not a number: "0042" is a valid PIN and 42 is not the same thing.
 * randomInt is unbiased, unlike Math.floor(Math.random() * 10000).
 */
export const generatePin = (): string =>
  String(randomInt(0, 10 ** PIN_DIGITS)).padStart(PIN_DIGITS, '0');

/**
 * Returns a PHC string carrying its own salt and parameters, which is what gets
 * stored -- so raising the cost later does not invalidate existing hashes.
 */
export const hashSecret = (value: string): Promise<string> =>
  argon2.hash(value, ARGON2_OPTIONS);

/**
 * An unreadable hash returns false rather than throwing: on the unlock path a
 * 500 where a wrong PIN answers 401 is an oracle.
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
 * Prefixed per request, which is what lets a deletion work by prefix once the
 * SQL cascade has removed the rows carrying the keys. The client-supplied name
 * enters only sanitised, behind a random identifier.
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
