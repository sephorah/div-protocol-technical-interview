import { Badge, Box, Button, Card, Heading, Input, Stack, Text } from '@chakra-ui/react'
import { useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { getRequest, regenerateLink, revokeLink } from '../api/requests'
import type { IssuedLink } from '../api/requests'
import { AppShell } from '../components/app-shell'
import { IssuedLinkCard } from '../components/issued-link-card'
import { ItemRow } from '../components/item-row'
import { ErrorPanel, LoadingSkeleton } from '../components/screen-state'
import { LinkStateBadge, StatusBadge } from '../components/status-badge'
import { formatDate, pluralize } from '../format'
import { useResource } from '../hooks/use-resource'

const MIN_DAYS = 1
const MAX_DAYS = 90
const DEFAULT_DAYS = 14

const TEXT = {
  back: '← Retour au tableau de bord',
  createdOn: (date: string) => `Creee le ${date}`,
  pieces: (count: number) => pluralize(count, 'piece', 'pieces'),
  linkEyebrow: 'Lien public',
  linkExpiry: (date: string) => `Expire le ${date}, protege par un code a 4 chiffres.`,
  linkStored:
    "L'adresse et le code ne sont pas conserves en clair : les regenerer emet un nouveau lien et invalide l'actuel.",
  linkRevoked: "L'acces a ete revoque : le lien ne fonctionne plus. Regenerez-en un pour rouvrir le depot.",
  regenerate: 'Regenerer le lien',
  revoke: "Revoquer l'acces",
  confirm: 'Confirmer',
  cancel: 'Annuler',
  validity: 'Validite du nouveau lien, en jours',
  regenerateWarning:
    "Le lien actuel cessera de fonctionner immediatement. Si votre client l'a deja recu, il faudra lui envoyer le nouveau.",
  revokeWarning:
    'Le lien actuel cessera de fonctionner immediatement et votre client ne pourra plus deposer de piece.',
  itemsEyebrow: 'Pieces attendues',
  notFound: 'Demande introuvable.',
  unexpected: 'Une erreur est survenue.',
  working: 'En cours...',
}

// The one place a screen knows better than the API layer: on this route a 404
// is a request that does not exist, not the prefix drift "API introuvable" was
// written for. A genuinely misrouted /api would read as a missing request here,
// which is the accepted cost of naming the common case.
const messageFor = (error: unknown): string => {
  if (error instanceof ApiError) {
    return error.kind === 'notFound' ? TEXT.notFound : error.message
  }
  return TEXT.unexpected
}

type Confirmation = 'regenerate' | 'revoke' | null

export const RequestDetailPage = () => {
  const { id = '' } = useParams<{ id: string }>()
  const { data, error, reload } = useResource(() => getRequest(id), [id])

  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [days, setDays] = useState(String(DEFAULT_DAYS))
  const [issued, setIssued] = useState<IssuedLink | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const runAction = async (action: () => Promise<IssuedLink | void>) => {
    setWorking(true)
    setActionError(null)
    try {
      const result = await action()
      setIssued(result ?? null)
      setConfirmation(null)
      // Re-read rather than guess: the new expiry and the link state come from
      // the server, and patching them locally is how the screen would end up
      // showing a state the database does not have.
      await reload()
    } catch (caught) {
      setActionError(messageFor(caught))
    } finally {
      setWorking(false)
    }
  }

  const onRegenerate = () => {
    const parsed = Number(days)
    void runAction(() =>
      regenerateLink(id, Number.isInteger(parsed) ? parsed : DEFAULT_DAYS),
    )
  }

  return (
    <AppShell>
      <Stack gap="24px">
        <Text asChild color="fg.muted" fontSize="12px">
          <RouterLink to="/dashboard">{TEXT.back}</RouterLink>
        </Text>

        {error !== null ? (
          <ErrorPanel message={messageFor(error)} onRetry={() => void reload()} />
        ) : data === null ? (
          <LoadingSkeleton count={3} />
        ) : (
          <>
            <Stack gap="8px">
              <Stack
                direction={{ base: 'column', md: 'row' }}
                justify="space-between"
                align={{ base: 'flex-start', md: 'center' }}
                gap="8px"
              >
                <Heading size="xl">{data.title}</Heading>
                {/* Two pills and a count: the status and the link state are
                    independent facts, and one column would drop either. */}
                <Stack direction="row" gap="8px" align="center">
                  <StatusBadge status={data.status} />
                  <LinkStateBadge state={data.link.state} />
                  <Badge>{TEXT.pieces(data.expectedCount)}</Badge>
                </Stack>
              </Stack>
              <Text color="fg.muted" fontSize="12px">
                {TEXT.createdOn(formatDate(data.createdAt))}
              </Text>
            </Stack>

            <Card.Root>
              <Card.Header>
                <Card.Title>{TEXT.linkEyebrow}</Card.Title>
              </Card.Header>
              <Card.Body>
                <Stack gap="16px">
                  <Stack gap="4px">
                    <Text fontSize="14px">
                      {data.link.state === 'revoked'
                        ? TEXT.linkRevoked
                        : TEXT.linkExpiry(formatDate(data.link.expiresAt))}
                    </Text>
                    <Text color="fg.muted" fontSize="12px">
                      {TEXT.linkStored}
                    </Text>
                  </Stack>

                  {actionError === null ? null : <ErrorPanel message={actionError} />}

                  {/* Inline, never window.confirm: that dialog cannot be
                      styled, jsdom answers it false, and it does not say what
                      the action costs. */}
                  {confirmation === null ? (
                    <Stack direction={{ base: 'column', md: 'row' }} gap="12px">
                      <Button
                        variant="secondary"
                        alignSelf={{ md: 'center' }}
                        onClick={() => {
                          setIssued(null)
                          setConfirmation('regenerate')
                        }}
                      >
                        {TEXT.regenerate}
                      </Button>
                      {data.link.state === 'active' ? (
                        <Button
                          variant="secondary"
                          alignSelf={{ md: 'center' }}
                          onClick={() => setConfirmation('revoke')}
                        >
                          {TEXT.revoke}
                        </Button>
                      ) : null}
                    </Stack>
                  ) : (
                    <Stack gap="12px" bg="bg.subtle" borderRadius="l2" p="16px">
                      <Text fontSize="14px">
                        {confirmation === 'regenerate'
                          ? TEXT.regenerateWarning
                          : TEXT.revokeWarning}
                      </Text>

                      {confirmation === 'regenerate' ? (
                        <Stack direction="row" gap="8px" align="center">
                          <Box w="88px">
                            <Input
                              type="number"
                              inputMode="numeric"
                              aria-label={TEXT.validity}
                              min={MIN_DAYS}
                              max={MAX_DAYS}
                              value={days}
                              onChange={(event) => setDays(event.target.value)}
                            />
                          </Box>
                          <Text color="fg.muted" fontSize="12px">
                            {`jours (${String(MIN_DAYS)} a ${String(MAX_DAYS)})`}
                          </Text>
                        </Stack>
                      ) : null}

                      <Stack direction={{ base: 'column', md: 'row' }} gap="12px">
                        <Button
                          alignSelf={{ md: 'center' }}
                          disabled={working}
                          onClick={
                            confirmation === 'regenerate'
                              ? onRegenerate
                              : () => void runAction(() => revokeLink(id))
                          }
                        >
                          {working ? TEXT.working : TEXT.confirm}
                        </Button>
                        <Button
                          variant="secondary"
                          alignSelf={{ md: 'center' }}
                          disabled={working}
                          onClick={() => setConfirmation(null)}
                        >
                          {TEXT.cancel}
                        </Button>
                      </Stack>
                    </Stack>
                  )}
                </Stack>
              </Card.Body>
            </Card.Root>

            {/* The same card the creation shows, warning included: two
                renderings of the same handover is how one of them would end up
                without the "displayed once" notice. */}
            {issued === null ? null : <IssuedLinkCard link={issued} />}

            <Card.Root>
              <Card.Header>
                <Card.Title>{TEXT.itemsEyebrow}</Card.Title>
              </Card.Header>
              <Card.Body>
                <Stack gap="0">
                  {data.items.map((item) => (
                    // THE line C2 will change: the API exposes no upload status,
                    // so "received" means a file hangs off the piece. ItemRow
                    // already draws the failed and uploading states.
                    <ItemRow
                      key={item.id}
                      label={item.label}
                      state={item.received ? 'received' : 'pending'}
                      file={item.file}
                    />
                  ))}
                </Stack>
              </Card.Body>
            </Card.Root>
          </>
        )}
      </Stack>
    </AppShell>
  )
}
