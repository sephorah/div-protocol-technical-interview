import { defineSlotRecipe } from '@chakra-ui/react'
import { cardAnatomy } from '@chakra-ui/react/anatomy'

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
    title: {
      color: 'brand.fg',
      fontSize: '11px',
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
    },
    description: { color: 'fg.muted', fontSize: '12px' },
    body: { padding: '16px' },
    footer: { paddingInline: '16px', paddingBottom: '16px' },
  },
})
