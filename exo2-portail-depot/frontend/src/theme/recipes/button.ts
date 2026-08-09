import { defineRecipe } from '@chakra-ui/react'

export const buttonRecipe = defineRecipe({
  base: {
    borderRadius: 'full',
    fontFamily: 'body',
    // Chakra sets a height per size; left alone it wins over the charter's
    // padding and flattens the button.
    height: 'auto',
    transitionProperty: 'background-color, color, box-shadow',
    transitionDuration: 'fast',
    _focusVisible: {
      outline: '2px solid',
      outlineColor: 'brand.solid',
      outlineOffset: '2px',
    },
  },
  variants: {
    variant: {
      primary: {
        bg: 'brand.solid',
        color: 'brand.contrast',
        fontWeight: 600,
        // The charter's interaction signature: background and text swap.
        _hover: {
          bg: 'bg.subtle',
          color: 'brand.fg',
          boxShadow: 'inset 0 0 0 1px var(--chakra-colors-brand-solid)',
        },
        _disabled: {
          opacity: 0.5,
          _hover: { bg: 'brand.solid', color: 'brand.contrast', boxShadow: 'none' },
        },
      },
      secondary: {
        bg: 'bg',
        color: 'fg.muted',
        fontWeight: 400,
        boxShadow: 'inset 0 0 0 1px var(--chakra-colors-border)',
        _hover: { bg: 'bg.subtle' },
      },
    },
    size: {
      md: { paddingInline: '24px', paddingBlock: '14px', fontSize: '16px' },
      sm: { paddingInline: '16px', paddingBlock: '10px', fontSize: '14px' },
    },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
})
