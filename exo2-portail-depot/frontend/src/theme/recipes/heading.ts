import { defineRecipe } from '@chakra-ui/react'

export const headingRecipe = defineRecipe({
  // The charter reserves 700 for headings; Chakra ships 600 (semibold). It
  // sits in `base` and no size variant touches fontWeight, so overriding base
  // is enough here -- unlike the card title, where a variant's textStyle wins.
  base: { fontWeight: 700, color: 'fg' },
})
