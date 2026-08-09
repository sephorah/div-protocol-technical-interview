import { Card, ChakraProvider } from '@chakra-ui/react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { system } from '../index'
import { textStyles } from '../text-styles'

type SlotStyles = Record<string, Record<string, unknown>>

// What the browser actually applies: `base`, then the default variants layered
// over it. Reading `base` alone hid a real bug -- Chakra's own `size` variant
// sets the card title's font size, so the title rendered at 18px with 11px
// written in `base` and every unit test green.
const slot = (name: string): Record<string, unknown> => {
  const recipe = system.getSlotRecipe('card')
  const base = recipe.base as SlotStyles | undefined
  const groups = (recipe.variants ?? {}) as Record<string, Record<string, SlotStyles>>
  const defaults = (recipe.defaultVariants ?? {}) as Record<string, string>

  const layered = Object.entries(defaults).reduce<Record<string, unknown>>(
    (styles, [group, value]) => ({ ...styles, ...groups[group]?.[value]?.[name] }),
    { ...base?.[name] },
  )
  if (Object.keys(layered).length === 0) throw new Error(`no "${name}" card slot`)
  return layered
}

describe('card recipe', () => {
  it('renders a header band and a body without a screen naming a colour', () => {
    render(
      <ChakraProvider value={system}>
        <Card.Root>
          <Card.Header>
            <Card.Title>Boutons</Card.Title>
            <Card.Description>Survole le primaire</Card.Description>
          </Card.Header>
          <Card.Body>corps</Card.Body>
        </Card.Root>
      </ChakraProvider>,
    )
    expect(screen.getByText('Boutons')).toBeInTheDocument()
    expect(screen.getByText('Survole le primaire')).toBeInTheDocument()
    expect(screen.getByText('corps')).toBeInTheDocument()
  })

  // What distinguishes a DIV card from a stock Chakra one most visibly.
  it('declares no shadow', () => {
    expect(slot('root').boxShadow).toBe('none')
  })

  it('tints the header band and leaves the body white', () => {
    expect(slot('header').bg).toBe('bg.subtle')
    expect(slot('root').bg).toBe('bg')
  })

  it('sets the header title in small uppercase brand type', () => {
    expect(slot('title')).toMatchObject({ color: 'brand.fg', textStyle: 'cardTitle' })
    expect(textStyles.cardTitle.value).toMatchObject({
      fontSize: '11px',
      fontWeight: '700',
      textTransform: 'uppercase',
    })
  })

  // The charter has one card, so naming a size must not undo it. Chakra sets
  // textStyle lg/md/xl per size, and a textStyle beats a neighbouring
  // fontSize -- so every size has to carry ours.
  it.each(['sm', 'md', 'lg'])('keeps the charter title at size %s', (size) => {
    const variants = system.getSlotRecipe('card').variants as
      | Record<string, Record<string, SlotStyles>>
      | undefined
    expect(variants?.size?.[size]?.title).toMatchObject({ textStyle: 'cardTitle' })
  })
})
