import { describe, expect, it } from 'vitest'
import { expiryDateFrom, formatBytes, formatDate, pluralize, safeFileName } from './format'

describe('formatDate', () => {
  // The API always answers ISO, but a truncated payload must not blank the
  // whole card with "Invalid Date".
  it('falls back to a dash on an unparsable date', () => {
    expect(formatDate('not-a-date')).toBe('—')
  })
})

describe('formatBytes', () => {
  it.each([
    [0, '0 o'],
    [1024, '1 ko'],
    // 2 411 724 / 1024^2 = 2,29999..., so the rendered value is 2,3 and not
    // the 2,4 a division by 1 000 000 would give. Units here are binary.
    [2_411_724, '2,3 Mo'],
    // Above 100 the decimal buys nothing and costs a column in the table.
    [200 * 1024 * 1024, '200 Mo'],
  ])('renders %i as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })
})

describe('safeFileName', () => {
  // The real attack the display has to survive: U+202E flips what follows, so
  // a browser shows "facturexe.pdf" for a file actually named ".exe".
  // Written as an escape, never as the character itself: an RLO pasted into
  // this file would reverse the rest of the line in every editor, hiding what
  // the test is about.
  it('strips the right-to-left override that disguises an extension', () => {
    expect(safeFileName('facture\u202Efdp.exe')).toBe('facturefdp.exe')
  })

  it('strips control characters', () => {
    expect(safeFileName('bail\x00\x1fsigne.pdf')).toBe('bailsigne.pdf')
  })

  it('never returns an empty label', () => {
    expect(safeFileName('\u202E\u202E')).toBe('Fichier sans nom')
  })

  it('truncates a name long enough to break the layout', () => {
    expect(safeFileName('a'.repeat(200))).toHaveLength(80)
  })

  // Cutting on UTF-16 units would end the label on half a surrogate pair, which
  // the browser draws as a replacement square.
  it('truncates on code points, not on UTF-16 units', () => {
    const truncated = safeFileName('\u{1F642}'.repeat(100))
    expect(Array.from(truncated)).toHaveLength(80)
    expect(truncated.endsWith('…')).toBe(true)
  })
})

describe('pluralize', () => {
  // French keeps the singular at zero, unlike English -- "0 pieces" would be
  // the mistake a naive `count === 1` makes.
  it.each([
    [0, '0 piece'],
    [2, '2 pieces'],
  ])('renders %i as %s', (count, expected) => {
    expect(pluralize(count, 'piece', 'pieces')).toBe(expected)
  })
})

describe('expiryDateFrom', () => {
  it('adds the days to the reference instant', () => {
    const at = expiryDateFrom(14, new Date('2026-03-12T09:00:00.000Z'))
    expect(at.toISOString()).toBe('2026-03-26T09:00:00.000Z')
  })
})
