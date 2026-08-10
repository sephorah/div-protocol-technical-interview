import { ChakraProvider } from '@chakra-ui/react'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { system } from '../theme'

/**
 * Every component under test reads the DIV system: rendered bare, a Chakra
 * component throws "forgot to wrap within <ChakraProvider />" before the first
 * assertion. Written once so a suite cannot accidentally test a component
 * against Chakra's default theme instead of ours.
 */
export const renderWithTheme = (ui: ReactElement) =>
  render(<ChakraProvider value={system}>{ui}</ChakraProvider>)
