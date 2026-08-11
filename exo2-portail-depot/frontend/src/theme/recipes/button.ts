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
        // The charter takes the violet on all three planes, not the fill alone.
        _hover: {
          bg: 'bg.subtle',
          color: 'brand.fg',
          boxShadow: 'inset 0 0 0 1px var(--chakra-colors-border-accent)',
        },
        // Without this, a disabled "Precedent" turns violet under the cursor
        // and reads as clickable (the dashboard's pagination).
        _disabled: {
          opacity: 0.5,
          _hover: {
            bg: 'bg',
            color: 'fg.muted',
            boxShadow: 'inset 0 0 0 1px var(--chakra-colors-border)',
          },
        },
      },
      // The copy action sitting INSIDE the link box: the kit draws it as violet
      // text, with no fill and no ring. Hovering underlines rather than fills --
      // a fill would shift the URL next to it.
      link: {
        bg: 'transparent',
        color: 'brand.fg',
        fontWeight: 600,
        boxShadow: 'none',
        _hover: { textDecoration: 'underline' },
      },
    },
    size: {
      md: { paddingInline: '24px', paddingBlock: '14px', fontSize: '16px' },
      sm: { paddingInline: '16px', paddingBlock: '10px', fontSize: '14px' },
      // `size` is declared AFTER `variant`, so it wins: the size and padding of
      // the `link` variant have to live here rather than in the variant, or
      // `md` overrides them in silence.
      inline: { paddingInline: '0', paddingBlock: '0', fontSize: '13px' },
    },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
})
