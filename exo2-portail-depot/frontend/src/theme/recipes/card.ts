import { defineSlotRecipe } from '@chakra-ui/react'
import { cardAnatomy } from '@chakra-ui/react/anatomy'

// `cardTitle` is defined in src/theme/index.ts. It has to be a textStyle and
// not a set of loose properties: Chakra's own size variants set
// `textStyle: 'lg'` on this slot, which wins over a fontSize declared next to
// it. Replacing the same key is what makes the charter apply.
const CHARTER_TITLE = { color: 'brand.fg', textStyle: 'cardTitle' } as const

export const cardRecipe = defineSlotRecipe({
  className: 'chakra-card',
  slots: cardAnatomy.keys(),
  base: {
    root: {
      bg: 'bg',
      borderWidth: '1px',
      borderColor: 'border',
      borderRadius: 'l3',
      // The charter says so explicitly, and it is what most distinguishes a
      // DIV card from a stock Chakra one.
      boxShadow: 'none',
      // Without it the header band's corners escape the rounded root.
      overflow: 'hidden',
    },
    header: {
      bg: 'bg.subtle',
      paddingInline: '16px',
      paddingBlock: '8px',
      borderBottomWidth: '1px',
      borderColor: 'border',
      gap: '2px',
    },
    title: CHARTER_TITLE,
    description: { color: 'fg.muted', fontSize: '12px' },
    body: { padding: '16px' },
    footer: { paddingInline: '16px', paddingBottom: '16px' },
  },
  // Chakra's own size variants set the title's font size, and a variant beats
  // `base` -- the title rendered at 18px with 11px written above. Repeating
  // the charter in all three sizes is what makes it win whichever size a
  // screen names. Caught in the browser; the unit tests now read the
  // effective value rather than `base`.
  variants: {
    size: {
      sm: { title: CHARTER_TITLE },
      md: { title: CHARTER_TITLE },
      lg: { title: CHARTER_TITLE },
    },
    // `outline` is the default variant and sets bg.panel and a shadow of its
    // own -- the same precedence trap as the title.
    variant: {
      outline: { root: { bg: 'bg', borderColor: 'border', boxShadow: 'none' } },
    },
  },
})
