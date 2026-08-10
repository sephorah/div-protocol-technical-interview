import { Badge, Box, Stack, Text } from '@chakra-ui/react'
import type { ReceivedFile } from '../api/requests'
import { formatBytes, formatDate, safeFileName } from '../format'

/**
 * The four states of an expected piece. Only `pending` and `received` can occur
 * today: the API does not expose UploadedFile.status (ReceivedFileView carries
 * name, type, size and date, and nothing else), and `received` means "a file
 * hangs off the piece" whatever its status.
 *
 * The other two are drawn anyway. C2 is the first thing able to write a
 * `failed`, and deciding here what "received" means against one would be
 * deciding blind -- but the day it does, this screen changes ONE line, the
 * state computation, instead of inventing a design.
 */
export type ItemState = 'pending' | 'uploading' | 'received' | 'failed'

const TEXT = {
  pending: 'En attente',
  failed: 'Depot echoue',
  uploading: 'envoi en cours',
  redo: 'Le client doit le deposer a nouveau.',
  receivedAt: (date: string) => `recu le ${date}`,
}

// The marker column, one character wide, so the four states are told apart at a
// glance without reading the badge.
const MARKER: Record<ItemState, string> = {
  pending: '·',
  uploading: '⟳',
  received: '✓',
  failed: '⚠',
}

const MARKER_COLOR: Record<ItemState, string> = {
  pending: 'fg.subtle',
  uploading: 'info',
  received: 'success',
  failed: 'danger',
}

// The subtype, upper-cased: "application/pdf" reads PDF, "image/jpeg" JPEG.
// A lookup table would have to list every type C2 accepts, and would show a
// blank for the first one nobody thought of.
const typeLabel = (mimeType: string): string => {
  const subtype = mimeType.split('/').at(-1) ?? mimeType
  return subtype.toUpperCase()
}

const SEPARATOR = ' · '

const receivedMeta = (file: ReceivedFile): string =>
  [typeLabel(file.mimeType), formatBytes(file.sizeBytes), TEXT.receivedAt(formatDate(file.receivedAt))].join(
    SEPARATOR,
  )

const ProgressBar = ({ value }: { value: number }) => (
  <Box
    role="progressbar"
    aria-valuenow={value}
    aria-valuemin={0}
    aria-valuemax={100}
    w="100%"
    h="4px"
    bg="bg.subtle"
    borderRadius="full"
    overflow="hidden"
  >
    <Box w={`${String(value)}%`} h="100%" bg="brand.solid" />
  </Box>
)

export const ItemRow = ({
  label,
  state,
  file = null,
  progress = 0,
}: {
  label: string
  state: ItemState
  file?: ReceivedFile | null
  progress?: number
}) => {
  // Never rendered raw, and never in an href: `originalName` is supplied by an
  // anonymous client, and the invisible direction overrides it may carry are
  // what makes an .exe read as a .pdf.
  const name = file === null ? null : safeFileName(file.originalName)

  return (
    <Stack
      direction={{ base: 'column', md: 'row' }}
      justify="space-between"
      align={{ base: 'flex-start', md: 'flex-start' }}
      gap="8px"
      py="12px"
      borderBottomWidth="1px"
      borderColor="border"
    >
      <Stack direction="row" gap="8px" align="flex-start" minW="0" flex="1">
        <Text aria-hidden="true" color={MARKER_COLOR[state]} fontSize="14px" lineHeight="1.5">
          {MARKER[state]}
        </Text>
        <Stack gap="4px" minW="0">
          <Text fontSize="14px" color="fg">
            {label}
          </Text>

          {state === 'received' && file !== null && name !== null ? (
            <Text fontSize="12px" color="fg.muted" wordBreak="break-word">
              {/* The name in its own node: it is what identifies the piece to
                  the client, so it is styled and read apart from the size and
                  date that follow it. */}
              <Text as="span" color="fg">
                {name}
              </Text>
              {SEPARATOR}
              {receivedMeta(file)}
            </Text>
          ) : null}

          {state === 'uploading' ? (
            <Stack gap="4px" w="100%">
              <Text fontSize="12px" color="fg.muted" wordBreak="break-word">
                {name === null ? null : (
                  <>
                    <Text as="span" color="fg">
                      {name}
                    </Text>
                    {SEPARATOR}
                  </>
                )}
                {TEXT.uploading}
              </Text>
              <ProgressBar value={progress} />
            </Stack>
          ) : null}

          {state === 'failed' ? (
            <Stack gap="4px">
              <Text fontSize="12px" color="fg.muted" wordBreak="break-word">
                {name === null ? TEXT.failed : name}
              </Text>
              <Text fontSize="12px" color="fg.error">
                {TEXT.redo}
              </Text>
            </Stack>
          ) : null}
        </Stack>
      </Stack>

      {state === 'pending' ? <Badge variant="pending">{TEXT.pending}</Badge> : null}
      {state === 'failed' ? <Badge variant="expired">{TEXT.failed}</Badge> : null}
    </Stack>
  )
}
