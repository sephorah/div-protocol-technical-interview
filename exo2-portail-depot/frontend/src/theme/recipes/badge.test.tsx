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

// What the browser applies, not what `base` declares: `getRecipeFn` layers
// Chakra's own default variants over ours and resolves every token to its CSS
// variable. Reading `base` alone is what let a size variant win unnoticed in E1.
const resolvedVariant = (variant: string): Record<string, unknown> => {
  const styles = system.getRecipeFn('badge')({ variant }) as Record<string, unknown>
  return styles['@layer recipes'] as Record<string, unknown>
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

  it('gives a revoked link the same tone as an expired request', () => {
    // Two facts, one tone: a revoked link and an expired request are both
    // "nobody gets in", and the charter has one danger surface.
    expect(resolvedVariant('revoked')).toMatchObject({
      background: 'var(--chakra-colors-danger-surface)',
      color: 'var(--chakra-colors-danger)',
    })
    expect(resolvedVariant('revoked')).toEqual(resolvedVariant('expired'))
  })

  // Chakra ships its own `size` variant for the badge and it wins over our
  // `base`: the charter's 12px horizontal padding rendered at 6px, silently.
  it('keeps the charter box on the variant a screen actually renders', () => {
    expect(resolvedVariant('pending')).toMatchObject({
      paddingInline: '12px',
      paddingBlock: '6px',
      // Spelled out rather than a token: `xs` happens to be 12px today, so a
      // retuned scale would move the pastille with nothing to signal it.
      fontSize: '12px',
    })
  })

  it('pairs every status with its own surface, so none reads as another', () => {
    const variants = badgeVariants()
    const surfaces = ['pending', 'complete', 'expired', 'info'].map((n) => variants[n]?.bg)
    expect(new Set(surfaces).size).toBe(surfaces.length)
  })
})
