// Characters that are invisible on screen and dangerous in a file name.
// React escapes HTML; it does NOT neutralise these, and U+202E reverses
// everything after it, which is how "facture<RLO>fdp.exe" reads as
// "facturexe.pdf". `originalName` is supplied by an anonymous client (C2),
// so it is hostile input.
//
// A code-point predicate rather than a regular expression: a character class
// covering U+0000-U+001F is exactly what `no-control-regex` refuses, and the
// blocking lint is right -- the ranges read better named than escaped.
const HIDDEN_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x1f], // C0 controls, NUL included
  [0x7f, 0x9f], // DEL and the C1 controls
  [0x200e, 0x200f], // LRM / RLM
  [0x202a, 0x202e], // the embedding and override pairs, RLO among them
  [0x2066, 0x2069], // the isolates that replaced them
]

const isHidden = (character: string): boolean => {
  const codePoint = character.codePointAt(0) ?? 0
  return HIDDEN_RANGES.some(([from, to]) => codePoint >= from && codePoint <= to)
}

// Array.from splits on code points, so an emoji in a file name survives whole
// instead of losing half its surrogate pair.
const stripHidden = (name: string): string =>
  Array.from(name)
    .filter((character) => !isHidden(character))
    .join('')

const MAX_NAME_LENGTH = 80

const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

export const formatDate = (iso: string): string => {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '—' : dateFormatter.format(at)
}

// Binary steps behind decimal names, the convention every file manager uses:
// a 2 411 724-byte file reads 2,3 Mo here, not the 2,4 a division by a million
// would give.
const UNITS = ['o', 'ko', 'Mo', 'Go'] as const
const STEP = 1024

export const formatBytes = (bytes: number): string => {
  let value = bytes
  let unit = 0
  while (value >= STEP && unit < UNITS.length - 1) {
    value /= STEP
    unit += 1
  }
  // No decimal on bytes and kilobytes: "2,4 o" says nothing "2 o" does not.
  const digits = unit >= 2 && value < 100 ? 1 : 0
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: digits })} ${UNITS[unit]}`
}

export const safeFileName = (name: string): string => {
  const cleaned = stripHidden(name).trim()
  if (cleaned === '') return 'Fichier sans nom'
  // Cut on code points, like the filter above: `slice` counts UTF-16 units and
  // would leave half a surrogate pair, which renders as a replacement square.
  const characters = Array.from(cleaned)
  if (characters.length <= MAX_NAME_LENGTH) return cleaned
  return `${characters.slice(0, MAX_NAME_LENGTH - 1).join('')}…`
}

// French keeps the singular at zero, so the test is `> 1` and not `!== 1`.
export const pluralize = (count: number, one: string, many: string): string =>
  `${count} ${count > 1 ? many : one}`

/** What the creation form shows under the "days" field, so the lawyer reads a date. */
export const expiryDateFrom = (days: number, from: Date = new Date()): Date =>
  new Date(from.getTime() + days * 24 * 60 * 60 * 1000)
