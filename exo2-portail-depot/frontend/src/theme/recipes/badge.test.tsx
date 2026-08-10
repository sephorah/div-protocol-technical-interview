import { describe, expect, it } from 'vitest'
import { system } from '../index'

// What the browser applies, not what `base` declares: `getRecipeFn` layers
// Chakra's own default variants over ours and resolves every token to its CSS
// variable. Reading `base` alone is what let a size variant win unnoticed in E1.
const resolvedVariant = (variant: string): Record<string, unknown> => {
  const styles = system.getRecipeFn('badge')({ variant }) as Record<string, unknown>
  return styles['@layer recipes'] as Record<string, unknown>
}

describe('badge recipe', () => {
  // Chakra ships its own `size` variant for the badge and it wins over our
  // `base`: the charter's 12px horizontal padding rendered at 6px, silently.
  // The only case here jsdom can really fail on -- it computes no styles, so
  // the charter itself is checked in the browser (docs/tests-manuels.md B3).
  it('keeps the charter box on the variant a screen actually renders', () => {
    expect(resolvedVariant('pending')).toMatchObject({
      paddingInline: '12px',
      paddingBlock: '6px',
      // Spelled out rather than a token: `xs` happens to be 12px today, so a
      // retuned scale would move the pastille with nothing to signal it.
      fontSize: '12px',
    })
  })
})
