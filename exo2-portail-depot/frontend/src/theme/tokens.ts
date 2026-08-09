import { defineTokens } from '@chakra-ui/react'

export const tokens = defineTokens({
  colors: {
    primary: { value: '#5100FF' },
    secondary: { value: '#916ED8' },
    ink: { value: '#000000' },
    graphite: { value: '#585858' },
    mist: { value: '#CECECE' },
    hairline: { value: '#E9E9E9' },
    accentSurface: { value: '#F7F6FF' },
    accentSoft: { value: '#DBCDFF' },
    success: { value: '#12AC64' },
    successSurface: { value: '#D9FFED' },
    danger: { value: '#FF4C4C' },
    dangerSurface: { value: '#FFD0D0' },
    warning: { value: '#DA9705' },
    warningSurface: { value: '#FFEDCA' },
    info: { value: '#52A0EE' },
    infoSurface: { value: '#DBEDFF' },
  },
  fonts: {
    body: { value: "'Inter Variable', Inter, system-ui, sans-serif" },
    heading: { value: "'Inter Variable', Inter, system-ui, sans-serif" },
  },
})
