import { Badge, ChakraProvider } from '@chakra-ui/react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { system } from '../index'

const badgeVariants = (): Record<string, Record<string, unknown>> => {
  const variants = system.getRecipe('badge').variants as
    | { variant?: Record<string, Record<string, unknown>> }
    | undefined
  return variants?.variant ?? {}
}

describe('badge recipe', () => {
  // The three names come straight from deriveStatus
  // (backend/src/requests/request-status.ts). B5 can then render a status
  // without a mapping table -- and a renamed variant breaks here.
  it('names its variants after the API statuses', () => {
    expect(Object.keys(badgeVariants())).toEqual(
      expect.arrayContaining(['pending', 'complete', 'expired', 'info', 'neutral']),
    )
  })

  it('renders the three request statuses', () => {
    render(
      <ChakraProvider value={system}>
        <Badge variant="pending">En attente</Badge>
        <Badge variant="complete">Complete</Badge>
        <Badge variant="expired">Expiree</Badge>
      </ChakraProvider>,
    )
    expect(screen.getByText('En attente')).toBeInTheDocument()
    expect(screen.getByText('Complete')).toBeInTheDocument()
    expect(screen.getByText('Expiree')).toBeInTheDocument()
  })

  it('pairs every status with its own surface, so none reads as another', () => {
    const variants = badgeVariants()
    const surfaces = ['pending', 'complete', 'expired', 'info'].map((n) => variants[n]?.bg)
    expect(new Set(surfaces).size).toBe(surfaces.length)
  })
})
