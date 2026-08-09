import { describe, expect, it } from 'vitest'
import { system } from './index'

// These values are the DIV charter. The test exists so a colour changed by
// accident breaks here, and not six screens later.
describe('theme tokens', () => {
  it.each([
    ['colors.primary', '#5100FF'],
    ['colors.secondary', '#916ED8'],
    ['colors.hairline', '#E9E9E9'],
    ['colors.accentSurface', '#F7F6FF'],
    ['colors.accentSoft', '#DBCDFF'],
    ['colors.success', '#12AC64'],
    ['colors.danger', '#FF4C4C'],
    ['colors.warning', '#DA9705'],
    ['colors.info', '#52A0EE'],
  ])('%s is %s', (path, expected) => {
    expect(system.token(path)).toBe(expected)
  })

  // Semantic tokens are read through getByName, not token(): the latter
  // resolves them to the CSS variable that carries them at runtime, so it
  // would compare `var(--chakra-radii-l1)` and never see a changed value.
  it.each([
    ['radii.l1', '4px'],
    ['radii.l2', '8px'],
    ['radii.l3', '12px'],
  ])('semantic radius %s is %s', (name, expected) => {
    expect(system.tokens.getByName(name)?.value).toBe(expected)
  })

  // The virtual palette every component reaches through colorPalette="brand".
  // Rewired to another colour, nothing else in the suite would notice.
  it('points the brand palette at the charter primary', () => {
    expect(system.tokens.getByName('colors.brand.solid')?.value).toBe(
      'var(--chakra-colors-primary)',
    )
    expect(system.tokens.getByName('colors.brand.contrast')?.value).toBe('#FFFFFF')
  })

  it('uses Inter for body and headings', () => {
    expect(system.token('fonts.body')).toContain('Inter')
    expect(system.token('fonts.heading')).toContain('Inter')
  })
})

describe('heading recipe', () => {
  // The charter reserves 700 for headings; Chakra ships 600.
  it('sets headings at the charter weight', () => {
    const base = system.getRecipe('heading').base as Record<string, unknown> | undefined
    expect(base?.fontWeight).toBe(700)
  })
})
