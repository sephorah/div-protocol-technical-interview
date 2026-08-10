/**
 * The bounds of a deposit.
 *
 * Constants and not environment variables: the statement freezes them, and a
 * knob would suggest an operator may widen the allowlist -- which is exactly the
 * decision that must not be reachable from a .env on a shared machine.
 */

/** 20 MiB. Multer aborts the request above it, before the buffer grows. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const isAllowedMimeType = (
  mimeType: string,
): mimeType is AllowedMimeType =>
  (ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType);

/**
 * "20 Mo" and not "20 MiB": the message is read by a client, not by an
 * engineer. The gap with MAX_FILE_BYTES (20.97 Mo) is deliberate -- rounding
 * down is what keeps the announced limit reachable.
 */
export const FILE_TOO_LARGE = 'Fichier trop volumineux (20 Mo maximum).';

export const FILE_TYPE_REJECTED = 'Format refusé. PDF, JPG ou PNG uniquement.';

export const NO_FILE = 'Aucun fichier reçu.';

/**
 * Same wording for a piece that does not exist and for one belonging to another
 * request: a distinct message would tell an anonymous caller that the piece
 * exists somewhere else.
 */
export const ITEM_NOT_FOUND = 'Pièce introuvable.';

/**
 * Two deposits landing on the same piece at once -- a double click on the send
 * button, or a client re-sending because the progress bar looked frozen. The
 * message says what to do, because retrying really does work here.
 */
export const DEPOSIT_RACED =
  'Un envoi est déjà en cours pour cette pièce. Réessayez.';
