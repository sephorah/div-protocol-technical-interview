import { defineRecipe } from '@chakra-ui/react'

// One constant for two variant names rather than two literals: a revoked link
// and an expired request are the same "nobody gets in" for the reader, and
// duplicating the pair is how the two would drift.
const DANGER_TONE = { bg: 'dangerSurface', color: 'danger' } as const

export const badgeRecipe = defineRecipe({
  base: {
    borderRadius: 'full',
    paddingInline: '12px',
    paddingBlock: '6px',
    fontSize: '12px',
    fontWeight: 600,
    textTransform: 'none',
  },
  variants: {
    variant: {
      pending: { bg: 'warningSurface', color: 'warning' },
      complete: { bg: 'successSurface', color: 'success' },
      expired: DANGER_TONE,
      revoked: DANGER_TONE,
      info: { bg: 'infoSurface', color: 'info' },
      // The kit's counting badge ("3 pieces"). Primary at 6 %, a value read
      // off the reference in the browser -- there is no token for it because
      // no other component uses that tint.
      neutral: { bg: 'rgba(81, 0, 255, 0.06)', color: 'brand.fg' },
    },
  },
  defaultVariants: { variant: 'neutral' },
})
