import { defineRecipe, defineSlotRecipe } from '@chakra-ui/react'
import { fieldAnatomy } from '@chakra-ui/react/anatomy'

export const fieldRecipe = defineSlotRecipe({
  className: 'chakra-field',
  slots: fieldAnatomy.keys(),
  base: {
    root: { gap: '6px' },
    label: { color: 'fg', fontSize: '12px', fontWeight: 600 },
    errorText: { color: 'fg.error', fontSize: '12px' },
    helperText: { color: 'fg.muted', fontSize: '12px' },
  },
})

export const inputRecipe = defineRecipe({
  base: {
    borderWidth: '1px',
    borderColor: 'border',
    borderRadius: 'l2',
    bg: 'bg',
    color: 'fg',
    fontSize: '14px',
    // Same reason as the button: Chakra's per-size height wins over padding.
    height: 'auto',
    paddingInline: '12px',
    paddingBlock: '10px',
    _placeholder: { color: 'fg.subtle' },
    // A ring, not a wider border: the second option shifts the next line by a
    // pixel every time the field is entered.
    _focusVisible: {
      borderColor: 'brand.solid',
      boxShadow: '0 0 0 1px var(--chakra-colors-brand-solid)',
      outline: 'none',
    },
    _invalid: { borderColor: 'fg.error' },
  },
  // Same trap as the card: Chakra's `outline` variant is the default and sets
  // a transparent background, which beats `base`. On white it looks right and
  // would only diverge once a field sits on a tinted surface.
  variants: {
    variant: {
      outline: { bg: 'bg', borderWidth: '1px', borderColor: 'border' },
    },
  },
})
