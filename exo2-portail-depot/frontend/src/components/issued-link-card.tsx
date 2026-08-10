import { Box, Button, Card, Stack, Text, chakra, useRecipe } from '@chakra-ui/react'
import type { IssuedLink } from '../api/requests'
import { formatDate } from '../format'
import { useCopy } from '../hooks/use-copy'
import { CopyField } from './copy-field'

const TEXT = {
  eyebrow: 'Lien genere',
  linkLabel: 'Lien a envoyer au client',
  pinLabel: 'Code PIN',
  copyPin: 'Copier le code',
  copied: 'Code copie',
  manual: 'Copiez le code avec Ctrl+C',
  expiry: (date: string) => `Ce lien expire le ${date}.`,
  warning:
    "Ce code n'est affiche qu'une fois. Il n'est pas conserve en clair : si vous le perdez, il faudra regenerer le lien, ce qui invalidera celui-ci.",
}

const PinDigits = ({ pin }: { pin: string }) => {
  const recipe = useRecipe({ key: 'pinDigit' })
  const styles = recipe()
  return (
    <>
      {/* The boxes are hidden from screen readers and the value spelled out
          beside them: four separate boxes are announced as four unrelated
          characters, and spaced digits are what makes a PIN read as a PIN
          rather than as the number four thousand two hundred and seven. */}
      <Box srOnly>{`${TEXT.pinLabel} : ${Array.from(pin).join(' ')}`}</Box>
      <Stack direction="row" gap="8px" aria-hidden="true">
        {Array.from(pin, (digit, index) => (
          <chakra.span key={index} css={styles}>
            {digit}
          </chakra.span>
        ))}
      </Stack>
    </>
  )
}

/**
 * The "LIEN GENERE" card, shared by the creation and the regeneration: two
 * screens hand over the same two secrets, and drawing it twice is how one of
 * them would end up without the warning.
 */
export const IssuedLinkCard = ({
  link,
  title,
  onDone,
  doneLabel,
}: {
  link: IssuedLink
  title?: string
  onDone?: () => void
  doneLabel?: string
}) => {
  const { feedback, copy } = useCopy(link.pin)

  return (
    <Card.Root>
      <Card.Header>
        <Card.Title>{TEXT.eyebrow}</Card.Title>
      </Card.Header>
      <Card.Body>
        <Stack gap="16px">
          {title === undefined ? null : <Text fontSize="14px">{title}</Text>}

          <CopyField label={TEXT.linkLabel} value={link.url} />

          <Stack gap="8px">
            <Text fontSize="12px" fontWeight="600">
              {TEXT.pinLabel}
            </Text>
            <Stack direction={{ base: 'column', md: 'row' }} gap="12px" align={{ md: 'center' }}>
              <PinDigits pin={link.pin} />
              {/* The digits are a display, not a field: the copy button is the
                  only way to take the PIN without retyping it. */}
              <Button
                variant="secondary"
                size="sm"
                alignSelf={{ base: 'flex-start', md: 'center' }}
                onClick={() => void copy()}
              >
                {TEXT.copyPin}
              </Button>
            </Stack>
            {feedback === 'idle' ? null : (
              <Text role="status" color="fg.muted" fontSize="12px">
                {feedback === 'copied' ? TEXT.copied : TEXT.manual}
              </Text>
            )}
          </Stack>

          <Text color="fg.muted" fontSize="12px">
            {TEXT.expiry(formatDate(link.expiresAt))}
          </Text>

          <Box bg="warningSurface" borderRadius="l2" p="12px">
            <Text color="warning" fontSize="12px">
              {TEXT.warning}
            </Text>
          </Box>

          {onDone === undefined || doneLabel === undefined ? null : (
            <Button alignSelf="flex-start" onClick={onDone}>
              {doneLabel}
            </Button>
          )}
        </Stack>
      </Card.Body>
    </Card.Root>
  )
}
