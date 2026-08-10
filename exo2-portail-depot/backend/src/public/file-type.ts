/**
 * Identifies a deposited file by its first bytes, and by nothing else.
 *
 * Not the declared Content-Type, not the extension: both are written by the
 * client, so an allowlist checked against them is bypassed by lying about a
 * header. What is on disk is what the lawyer will open.
 *
 * Signatures written by hand rather than the `file-type` package: three formats
 * are ~25 lines, and that package is pure ESM -- the backend's CommonJS Jest
 * would need a transformIgnorePatterns list to maintain for it.
 */

interface Signature {
  mimeType: string;
  /** The magic bytes, compared against the payload's prefix. */
  bytes: readonly number[];
}

const SIGNATURES: readonly Signature[] = [
  // "%PDF-"
  { mimeType: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  // SOI + the first byte of the APPn marker; the fourth byte varies with the
  // flavour (JFIF, Exif, ...), so it is deliberately not part of the signature.
  { mimeType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  {
    mimeType: 'image/png',
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
];

const startsWith = (payload: Buffer, bytes: readonly number[]): boolean =>
  payload.length >= bytes.length &&
  bytes.every((byte, index) => payload[index] === byte);

/**
 * The type the bytes really are, or null when no known signature matches.
 *
 * Recognising is not accepting: the allowlist is a separate list
 * (upload.constants.ts), so a format this file learns to identify does not
 * become depositable by that alone.
 */
export const detectFileType = (payload: Buffer): string | null =>
  SIGNATURES.find((signature) => startsWith(payload, signature.bytes))
    ?.mimeType ?? null;
