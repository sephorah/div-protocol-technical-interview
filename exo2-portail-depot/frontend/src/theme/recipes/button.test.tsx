import { Button, ChakraProvider } from '@chakra-ui/react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { system } from '../index'

type VariantGroups = Record<string, Record<string, Record<string, unknown>>>

const groups = (): VariantGroups =>
  (system.getRecipe('button').variants ?? {}) as VariantGroups

const variantStyles = (name: string): Record<string, unknown> => {
  const found = groups().variant?.[name]
  if (found === undefined) throw new Error(`no "${name}" button variant`)
  return found
}

describe('button recipe', () => {
  it('renders a bare Button, which the defaults already put on charter', () => {
    render(
      <ChakraProvider value={system}>
        <Button>Creer une demande</Button>
      </ChakraProvider>,
    )
    expect(screen.getByRole('button', { name: 'Creer une demande' })).toBeInTheDocument()
  })

  it('exposes both charter variants and both sizes', () => {
    expect(Object.keys(groups().variant)).toEqual(
      expect.arrayContaining(['primary', 'secondary']),
    )
    expect(Object.keys(groups().size)).toEqual(expect.arrayContaining(['md', 'sm']))
  })

  it('defaults to primary/md, so a screen never has to name them', () => {
    expect(system.getRecipe('button').defaultVariants).toMatchObject({
      variant: 'primary',
      size: 'md',
    })
  })

  // jsdom computes no styles, so what is checked is the declaration. A border
  // appearing on hover would shift the label by a pixel; an inset ring takes
  // no space. Same reason on the secondary variant's resting outline.
  it.each(['primary', 'secondary'])('outlines %s with an inset ring, never a border', (name) => {
    const styles = variantStyles(name)
    const hover = styles._hover as Record<string, unknown> | undefined
    const ring = (styles.boxShadow ?? hover?.boxShadow) as string | undefined
    expect(ring).toContain('inset')
    expect(styles.border).toBeUndefined()
    expect(styles.borderWidth).toBeUndefined()
    expect(hover?.border).toBeUndefined()
    expect(hover?.borderWidth).toBeUndefined()
  })

  it('secondary stays at weight 400, the detail that separates it from primary', () => {
    expect(variantStyles('secondary').fontWeight).toBe(400)
    expect(variantStyles('primary').fontWeight).toBe(600)
  })
})
