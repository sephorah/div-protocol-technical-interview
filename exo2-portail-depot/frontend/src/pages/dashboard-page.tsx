import { Box, Button, Card, Heading, Stack, Text } from '@chakra-ui/react'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { ApiError } from '../api/client'
import { listRequests } from '../api/requests'
import type { RequestSummary } from '../api/requests'
import { AppShell } from '../components/app-shell'
import { Reveal } from '../components/reveal'
import { EmptyState, ErrorPanel, LoadingSkeleton } from '../components/screen-state'
import { LinkStateBadge, StatusBadge } from '../components/status-badge'
import { formatDate, pluralize } from '../format'
import { useResource } from '../hooks/use-resource'

// Grouped at the top, like login-page.tsx: the product is single-language and
// gathering the strings here keeps a later translation mechanical.
const TEXT = {
  title: 'Mes demandes',
  create: 'Creer une demande',
  manage: 'Gerer le lien →',
  emptyTitle: 'Aucune demande en cours',
  emptyBody:
    'Creez une demande de depot pour transmettre a votre client un lien protege par un code.',
  previous: 'Precedent',
  next: 'Suivant',
  unexpected: 'Une erreur est survenue.',
  count: (total: number) => pluralize(total, 'demande', 'demandes'),
  page: (current: number, total: number) => `Page ${String(current)} sur ${String(total)}`,
  created: (date: string) => `Creee le ${date}`,
  expires: (date: string) => `expire le ${date}`,
  expired: (date: string) => `a expire le ${date}`,
  progress: (received: number, expected: number) =>
    `${pluralize(received, 'piece', 'pieces')} sur ${String(expected)}`,
}

// The message comes from the API layer, which already tells "Serveur
// injoignable" from "API introuvable" -- two different outages that a single
// rewritten sentence here would merge.
const messageFor = (error: unknown): string =>
  error instanceof ApiError ? error.message : TEXT.unexpected

const REVEAL_STEP_MS = 60

const detailPath = (id: string) => `/requests/${encodeURIComponent(id)}`

const RequestCard = ({ item }: { item: RequestSummary }) => {
  const expiry = formatDate(item.link.expiresAt)
  const passed = new Date(item.link.expiresAt).getTime() <= Date.now()

  return (
    <Card.Root>
      <Card.Body>
        <Stack gap="12px">
          <Stack
            direction={{ base: 'column', md: 'row' }}
            justify="space-between"
            align={{ base: 'flex-start', md: 'center' }}
            gap="8px"
          >
            <Heading size="md">{item.title}</Heading>
            {/* Two pills, never one: the status and the link state are
                independent, and a request can be complete AND cut off. */}
            <Stack direction="row" gap="8px" align="center" flexShrink="0">
              <StatusBadge status={item.status} />
              <LinkStateBadge state={item.link.state} />
            </Stack>
          </Stack>

          <Text color="fg.muted" fontSize="12px">
            {`${TEXT.created(formatDate(item.createdAt))} · ${
              passed ? TEXT.expired(expiry) : TEXT.expires(expiry)
            }`}
          </Text>

          <Box borderTopWidth="1px" borderColor="border" />

          <Stack
            direction={{ base: 'column', md: 'row' }}
            justify="space-between"
            align={{ base: 'flex-start', md: 'center' }}
            gap="8px"
          >
            <Text fontSize="14px">{TEXT.progress(item.receivedCount, item.expectedCount)}</Text>
            {/* A link and not a button: the lawyer must be able to open a case
                in another tab. It reads "Gerer le lien" and not "Copier le
                lien" -- the token only exists in clear at issuance, so copying
                from here could only mean regenerating, i.e. breaking a link
                already in service. */}
            <Text asChild color="brand.fg" fontSize="14px" fontWeight="600">
              <RouterLink to={detailPath(item.id)}>{TEXT.manage}</RouterLink>
            </Text>
          </Stack>
        </Stack>
      </Card.Body>
    </Card.Root>
  )
}

export const DashboardPage = () => {
  const [page, setPage] = useState(1)
  const { data, error, reload } = useResource(() => listRequests(page), [page])

  const createButton = (
    <Button asChild w={{ base: '100%', md: 'auto' }}>
      <RouterLink to="/requests/new">{TEXT.create}</RouterLink>
    </Button>
  )

  return (
    <AppShell>
      <Stack gap="24px">
        <Stack
          direction={{ base: 'column', md: 'row' }}
          justify="space-between"
          align={{ base: 'stretch', md: 'flex-end' }}
          gap="12px"
        >
          <Stack gap="4px">
            <Heading size="xl">{TEXT.title}</Heading>
            {data === null ? null : (
              <Text color="fg.muted" fontSize="12px">
                {TEXT.count(data.total)}
              </Text>
            )}
          </Stack>
          {/* Stack stretches its children; the charter's button hugs its label
              on md. On base it is deliberately full width: a 153px target on a
              375px screen is uncomfortable (README, limitations). */}
          <Box alignSelf={{ base: 'stretch', md: 'center' }}>{createButton}</Box>
        </Stack>

        {error !== null ? (
          <ErrorPanel message={messageFor(error)} onRetry={() => void reload()} />
        ) : data === null ? (
          <LoadingSkeleton />
        ) : data.items.length === 0 ? (
          <EmptyState
            title={TEXT.emptyTitle}
            description={TEXT.emptyBody}
            action={createButton}
          />
        ) : (
          <Stack gap="16px">
            {data.items.map((item, index) => (
              <Reveal key={item.id} delay={index * REVEAL_STEP_MS}>
                <RequestCard item={item} />
              </Reveal>
            ))}
          </Stack>
        )}

        {data !== null && data.totalPages > 1 ? (
          <Stack direction="row" gap="12px" justify="center" align="center">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              {TEXT.previous}
            </Button>
            <Text color="fg.muted" fontSize="12px">
              {TEXT.page(data.page, data.totalPages)}
            </Text>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= data.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              {TEXT.next}
            </Button>
          </Stack>
        ) : null}
      </Stack>
    </AppShell>
  )
}
