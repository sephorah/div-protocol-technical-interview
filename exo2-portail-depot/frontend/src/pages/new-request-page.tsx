import { Box, Button, Card, Field, Heading, IconButton, Input, Stack, Text } from '@chakra-ui/react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { ApiError } from '../api/client'
import { createRequest } from '../api/requests'
import type { CreatedRequest } from '../api/requests'
import { AppShell } from '../components/app-shell'
import { IssuedLinkCard } from '../components/issued-link-card'
import { ErrorPanel } from '../components/screen-state'
import { StatusBadge } from '../components/status-badge'
import { expiryDateFrom, formatDate } from '../format'

// Mirrors the server's bounds (backend/src/requests/dto). They are RECALLED
// here, not enforced: the server decides, and a client rule that drifts from it
// would refuse a body the API accepts -- or promise one it refuses.
const MAX_ITEMS = 20
const MAX_TITLE = 200
const MAX_LABEL = 200
const MIN_DAYS = 1
const MAX_DAYS = 90
const DEFAULT_DAYS = 14

const TEXT = {
  back: '← Retour au tableau de bord',
  eyebrow: 'Nouvelle demande',
  title: 'Intitule du dossier',
  titlePlaceholder: 'Dossier Martin, pieces 2026',
  items: 'Pieces attendues',
  itemLabel: (position: number) => `Piece attendue ${String(position)}`,
  removeItem: (position: number) => `Retirer la piece ${String(position)}`,
  addItem: '+ Ajouter une piece',
  validity: 'Validite du lien',
  days: 'jours',
  bounds: `(${String(MIN_DAYS)} a ${String(MAX_DAYS)})`,
  expiresOn: (date: string) => `expire le ${date}`,
  cancel: 'Annuler',
  submit: 'Creer la demande',
  submitting: 'Creation...',
  itemCount: (count: number) => `${String(count)} sur ${String(MAX_ITEMS)}`,
  seeRequest: 'Voir la demande',
  createAnother: 'Creer une autre demande',
  unexpected: 'Une erreur est survenue.',
}

// Rows carry a stable key of their own, not their index: React would otherwise
// reuse the DOM node of the removed row and the text of the row below would
// jump into the field above.
type PieceRow = { key: string; label: string }

let nextKey = 0
const emptyRow = (): PieceRow => {
  nextKey += 1
  return { key: `piece-${String(nextKey)}`, label: '' }
}

// The API layer already tells "Serveur injoignable" from "API introuvable", and
// it quotes the server on a refused body -- class-validator answers one message
// per broken rule. Nothing is rewritten here.
const messageFor = (error: unknown): string =>
  error instanceof ApiError ? error.message : TEXT.unexpected

const parseDays = (raw: string): number | null => {
  const value = Number(raw)
  return raw.trim() !== '' && Number.isInteger(value) ? value : null
}

export const NewRequestPage = () => {
  const [title, setTitle] = useState('')
  const [rows, setRows] = useState<PieceRow[]>(() => [emptyRow()])
  const [days, setDays] = useState(String(DEFAULT_DAYS))
  const [issued, setIssued] = useState<CreatedRequest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const labels = rows.map((row) => row.label.trim()).filter((label) => label !== '')
  const parsedDays = parseDays(days)
  const canSubmit = title.trim() !== '' && labels.length > 0 && !submitting

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    setError(null)
    try {
      // The empty rows are dropped rather than sent: a three-row form with two
      // blanks must create a one-piece request, not a 400.
      setIssued(
        await createRequest({
          title: title.trim(),
          items: labels,
          expiresInDays: parsedDays ?? DEFAULT_DAYS,
        }),
      )
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    setIssued(null)
    setTitle('')
    setRows([emptyRow()])
    setDays(String(DEFAULT_DAYS))
    setError(null)
  }

  return (
    <AppShell>
      <Stack gap="24px">
        <Text asChild color="fg.muted" fontSize="12px">
          <RouterLink to="/dashboard">{TEXT.back}</RouterLink>
        </Text>

        {issued === null ? (
          <Card.Root>
            <Card.Header>
              <Card.Title>{TEXT.eyebrow}</Card.Title>
            </Card.Header>
            <Card.Body>
              {/* noValidate: the browser's own bubble would contradict the
                  server's message in its own words. */}
              <form onSubmit={(event) => void onSubmit(event)} noValidate>
                <Stack gap="24px">
                  <Field.Root>
                    <Field.Label>{TEXT.title}</Field.Label>
                    <Input
                      value={title}
                      maxLength={MAX_TITLE}
                      placeholder={TEXT.titlePlaceholder}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </Field.Root>

                  <Stack gap="8px">
                    <Stack direction="row" justify="space-between" align="baseline">
                      <Text fontSize="12px" fontWeight="600">
                        {TEXT.items}
                      </Text>
                      <Text color="fg.muted" fontSize="12px">
                        {TEXT.itemCount(rows.length)}
                      </Text>
                    </Stack>

                    {rows.map((row, index) => (
                      <Stack key={row.key} direction="row" gap="8px" align="center">
                        <Box flex="1" minW="0">
                          <Input
                            aria-label={TEXT.itemLabel(index + 1)}
                            value={row.label}
                            maxLength={MAX_LABEL}
                            onChange={(event) => {
                              const { value } = event.target
                              setRows((current) =>
                                current.map((candidate) =>
                                  candidate.key === row.key
                                    ? { ...candidate, label: value }
                                    : candidate,
                                ),
                              )
                            }}
                          />
                        </Box>
                        {/* The last row keeps no remove button: a request
                            without a single piece cannot be created. */}
                        {rows.length > 1 ? (
                          <IconButton
                            variant="secondary"
                            size="sm"
                            aria-label={TEXT.removeItem(index + 1)}
                            onClick={() => {
                              setRows((current) =>
                                current.filter((candidate) => candidate.key !== row.key),
                              )
                            }}
                          >
                            ×
                          </IconButton>
                        ) : null}
                      </Stack>
                    ))}

                    {rows.length < MAX_ITEMS ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        alignSelf="flex-start"
                        onClick={() => setRows((current) => [...current, emptyRow()])}
                      >
                        {TEXT.addItem}
                      </Button>
                    ) : null}
                  </Stack>

                  <Stack gap="8px">
                    <Field.Root>
                      <Field.Label>{TEXT.validity}</Field.Label>
                      <Stack direction="row" gap="8px" align="center">
                        <Box w="88px">
                          <Input
                            type="number"
                            inputMode="numeric"
                            min={MIN_DAYS}
                            max={MAX_DAYS}
                            value={days}
                            onChange={(event) => setDays(event.target.value)}
                          />
                        </Box>
                        <Text color="fg.muted" fontSize="12px">
                          {`${TEXT.days} ${TEXT.bounds}`}
                        </Text>
                      </Stack>
                    </Field.Root>
                    {/* Recomputed under the field on every keystroke: the API
                        counts in days, the lawyer reasons in dates. */}
                    {parsedDays === null ? null : (
                      <Text color="fg.muted" fontSize="12px">
                        {TEXT.expiresOn(formatDate(expiryDateFrom(parsedDays).toISOString()))}
                      </Text>
                    )}
                  </Stack>

                  {error === null ? null : <ErrorPanel message={error} />}

                  <Stack
                    direction={{ base: 'column', md: 'row' }}
                    gap="12px"
                    justify="flex-end"
                    align={{ base: 'stretch', md: 'center' }}
                  >
                    <Button asChild variant="secondary" alignSelf={{ md: 'center' }}>
                      <RouterLink to="/dashboard">{TEXT.cancel}</RouterLink>
                    </Button>
                    <Button type="submit" alignSelf={{ md: 'center' }} disabled={!canSubmit}>
                      {submitting ? TEXT.submitting : TEXT.submit}
                    </Button>
                  </Stack>
                </Stack>
              </form>
            </Card.Body>
          </Card.Root>
        ) : (
          <Stack gap="16px">
            <Stack direction="row" justify="space-between" align="center" gap="8px">
              <Heading size="lg">{issued.title}</Heading>
              <StatusBadge status={issued.status} />
            </Stack>

            {/* The card carries the two copy buttons and the warning. There is
                deliberately no prefilled mail: putting the address and the code
                in one message is the leak the whole design avoids. */}
            <IssuedLinkCard link={issued.link} />

            <Stack direction={{ base: 'column', md: 'row' }} gap="12px">
              <Button asChild alignSelf={{ md: 'center' }}>
                <RouterLink to={`/requests/${encodeURIComponent(issued.id)}`}>
                  {TEXT.seeRequest}
                </RouterLink>
              </Button>
              <Button variant="secondary" alignSelf={{ md: 'center' }} onClick={reset}>
                {TEXT.createAnother}
              </Button>
            </Stack>
          </Stack>
        )}
      </Stack>
    </AppShell>
  )
}
