import { defineRecipe } from '@chakra-ui/react'

// The kit's "Code PIN": four boxed digits, not an input. It is a display, so
// no size variant of Chakra's can reach it -- unlike the button and the card,
// this one needs no defensive repetition.
export const pinDigitRecipe = defineRecipe({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    borderWidth: '1px',
    borderColor: 'border.accent',
    borderRadius: 'l2',
    bg: 'bg.subtle',
    color: 'brand.fg',
    fontSize: '16px',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
})
