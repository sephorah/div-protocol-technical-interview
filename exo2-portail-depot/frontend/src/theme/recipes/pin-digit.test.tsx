import { describe, expect, it } from 'vitest'
import { system } from '../index'

// Same reading as the badge: the styles the browser applies, tokens already
// resolved to their CSS variables.
const resolved = (): Record<string, unknown> => {
  const styles = system.getRecipeFn('pinDigit')({}) as Record<string, unknown>
  return styles['@layer recipes'] as Record<string, unknown>
}

describe('pinDigit recipe', () => {
  it('draws the kit box: soft accent border, l2 radius, primary digit', () => {
    expect(resolved()).toMatchObject({
      borderColor: 'var(--chakra-colors-border-accent)',
      borderRadius: 'var(--chakra-radii-l2)',
      color: 'var(--chakra-colors-brand-fg)',
    })
  })

  // A PIN is read digit by digit, so the four boxes must not resize under it.
  it('keeps every digit the same width', () => {
    expect(resolved()).toMatchObject({
      width: '40px',
      height: '40px',
      fontVariantNumeric: 'tabular-nums',
    })
  })
})
