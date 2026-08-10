import { Box, Button, Heading, Stack, Text } from '@chakra-ui/react'
import type { ReactNode } from 'react'

/**
 * The three states every loaded screen owes its reader, and the reason they
 * live in one file: an empty list and a failed load look identical on screen
 * and call for opposite actions -- create, or retry. Serving one for the other
 * is a lie, not a cosmetic slip.
 */

const TEXT = {
  loading: 'Chargement en cours',
  retry: 'Reessayer',
}

// The ghosts carry the height of the real thing. A 24px spinner replaced by a
// 140px card makes the page jump under the cursor the moment data lands. No
// pulsing animation either: it pulls the eye to what is not there yet.
export const LoadingSkeleton = ({ count = 3, height = '140px' }: { count?: number; height?: string }) => (
  <Stack gap="16px" role="status" aria-label={TEXT.loading}>
    {Array.from({ length: count }, (_, index) => (
      <Box key={index} data-testid="skeleton-block" h={height} bg="bg.subtle" borderRadius="l3" />
    ))}
  </Stack>
)

export const EmptyState = ({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) => (
  <Stack
    role="status"
    gap="12px"
    align="center"
    textAlign="center"
    bg="bg.subtle"
    borderWidth="1px"
    borderColor="border.accent"
    borderRadius="l3"
    p="32px"
  >
    <Heading size="md">{title}</Heading>
    <Text color="fg.muted" fontSize="14px">
      {description}
    </Text>
    {/* Stack stretches its children; the button keeps the charter's box. */}
    {action === undefined ? null : <Box alignSelf="center">{action}</Box>}
  </Stack>
)

// role="alert" and not a plain paragraph: a screen reader must hear the
// failure, otherwise the page silently stops changing.
export const ErrorPanel = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <Stack
    role="alert"
    gap="12px"
    align="flex-start"
    bg="dangerSurface"
    borderRadius="l3"
    p="16px"
  >
    <Text color="fg" fontSize="14px">
      {message}
    </Text>
    {onRetry === undefined ? null : (
      <Button variant="secondary" size="sm" alignSelf="flex-start" onClick={onRetry}>
        {TEXT.retry}
      </Button>
    )}
  </Stack>
)
