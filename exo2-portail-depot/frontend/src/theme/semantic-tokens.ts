import { defineSemanticTokens } from '@chakra-ui/react'

// `l1` / `l2` / `l3` are the semantic radii Chakra's own recipes already read:
// redefining them puts the whole library on charter at once, instead of
// component by component.
export const semanticTokens = defineSemanticTokens({
  radii: {
    l1: { value: '4px' },
    l2: { value: '8px' },
    l3: { value: '12px' },
  },
  colors: {
    bg: {
      DEFAULT: { value: '#FFFFFF' },
      subtle: { value: '{colors.accentSurface}' },
    },
    fg: {
      DEFAULT: { value: '{colors.ink}' },
      muted: { value: '{colors.graphite}' },
      subtle: { value: '{colors.mist}' },
      error: { value: '{colors.danger}' },
    },
    border: {
      DEFAULT: { value: '{colors.hairline}' },
      accent: { value: '{colors.accentSoft}' },
    },
    // Virtual palette: `colorPalette="brand"` makes it available to every
    // Chakra component without any of them naming a colour.
    brand: {
      solid: { value: '{colors.primary}' },
      contrast: { value: '#FFFFFF' },
      fg: { value: '{colors.primary}' },
      muted: { value: '{colors.accentSurface}' },
      subtle: { value: '{colors.accentSoft}' },
      emphasized: { value: '{colors.secondary}' },
    },
  },
})
