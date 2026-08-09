import { Card, ChakraProvider } from '@chakra-ui/react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { system } from '../index'

const slot = (name: string): Record<string, unknown> => {
  const base = system.getSlotRecipe('card').base as
    | Record<string, Record<string, unknown>>
    | undefined
  const found = base?.[name]
  if (found === undefined) throw new Error(`no "${name}" card slot`)
  return found
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
    const title = slot('title')
    expect(title.color).toBe('brand.fg')
    expect(title.textTransform).toBe('uppercase')
    expect(title.fontWeight).toBe(700)
  })
})
