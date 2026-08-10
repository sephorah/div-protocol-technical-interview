import { defineTextStyles } from '@chakra-ui/react'

export const textStyles = defineTextStyles({
  // The kit's card header band: a SECTION LABEL ("BOUTONS", "CARTES"), not a
  // page title. It has to be a textStyle and not loose properties, because
  // Chakra's card recipe sets `textStyle: 'lg'` on that slot and a textStyle
  // wins over a fontSize declared beside it.
  cardTitle: {
    value: {
      fontSize: '11px',
      fontWeight: '700',
      lineHeight: '1.3',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
    },
  },
  // The generated link, as the kit draws it: monospace, truncated, selectable.
  codeLink: {
    value: {
      fontFamily: 'mono',
      fontSize: '13px',
      lineHeight: '1.4',
      letterSpacing: '0',
    },
  },
})
