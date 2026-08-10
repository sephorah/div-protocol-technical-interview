import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react'
import { badgeRecipe } from './recipes/badge'
import { buttonRecipe } from './recipes/button'
import { cardRecipe } from './recipes/card'
import { fieldRecipe, inputRecipe } from './recipes/field'
import { headingRecipe } from './recipes/heading'
import { pinDigitRecipe } from './recipes/pin-digit'
import { semanticTokens } from './semantic-tokens'
import { textStyles } from './text-styles'
import { tokens } from './tokens'

const config = defineConfig({
  // Light only: no `_dark` condition is declared anywhere, and nothing puts the
  // `dark` class on the document.
  globalCss: {
    'html, body': {
      bg: 'bg',
      color: 'fg',
      fontFamily: 'body',
      fontSize: '16px',
      lineHeight: '1.5',
    },
  },
  theme: {
    tokens,
    semanticTokens,
    textStyles,
    recipes: {
      badge: badgeRecipe,
      button: buttonRecipe,
      heading: headingRecipe,
      input: inputRecipe,
      pinDigit: pinDigitRecipe,
    },
    slotRecipes: { card: cardRecipe, field: fieldRecipe },
  },
})

export const system = createSystem(defaultConfig, config)
