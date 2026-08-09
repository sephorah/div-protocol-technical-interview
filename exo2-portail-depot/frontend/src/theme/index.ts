import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react'
import { semanticTokens } from './semantic-tokens'
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
  theme: { tokens, semanticTokens },
})

export const system = createSystem(defaultConfig, config)
