import { Box, Button, Card, Heading, Stack, Text, chakra } from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { ACCEPTED_TYPES, depositFile, getDepositSession, unlockDeposit } from '../api/public'
import type { DepositedFileView, PublicItemView, PublicRequestView } from '../api/public'
import type { ReceivedFile } from '../api/requests'
import { ItemRow } from '../components/item-row'
import type { ItemState } from '../components/item-row'
import { PIN_LENGTH, PinEntry } from '../components/pin-entry'
import { ErrorPanel, LoadingSkeleton } from '../components/screen-state'
import { formatDate } from '../format'

const TEXT = {
  brand: 'Portail de depot',
  eyebrow: 'Acces protege',
  title: 'Vos pieces a deposer',
  subtitle: 'Saisissez le code a 4 chiffres que votre avocat vous a communique.',
  submit: 'Ouvrir le dossier',
  submitting: 'Verification...',
  incomplete: `Saisissez les ${String(PIN_LENGTH)} chiffres du code.`,
  /**
   * The ONE refusal, and it must stay one. The API answers the same 401 for an
   * unknown token, a revoked link, an expired one and a wrong code, precisely
   * so that an anonymous caller cannot tell a live link from a dead one. Three
   * wordings here would hand that oracle back, on the screen instead of in the
   * body. Mirrors REFUSED in backend/src/public/public.service.ts.
   */
  refused:
    "Ce lien n'est pas accessible. Il a peut-etre expire ou ete revoque, ou le code saisi n'est pas le bon. Verifiez le code, puis demandez un nouveau lien a votre avocat.",
  unreachable: 'Serveur injoignable. Reessayez dans un instant.',
  unexpected: 'Une erreur est survenue.',
  staleItem: 'Cette piece ne fait plus partie de la demande. Rechargez la page.',
  progress: (received: number, total: number) =>
    `${String(received)} sur ${String(total)} pieces deposees`,
  expiry: (date: string) => `Ce lien expire le ${date}.`,
  itemsEyebrow: 'Pieces demandees',
  complete: 'Toutes les pieces ont ete deposees. Vous pouvez fermer cette page.',
  choose: 'Deposer un fichier',
  replace: 'Remplacer le fichier',
  accepted: 'PDF, JPG ou PNG, 20 Mo maximum. Une seule piece par ligne.',
  /**
   * The second half of the deposit, and the reason it is named: the bytes are
   * all sent, the server is still reading the magic bytes and can still refuse
   * the file. "Termine" before the 201 would be a promise nobody has made.
   */
  verifying: 'verification en cours',
}

/**
 * Which link THIS tab has unlocked: the session cookie names one dossier, so a
 * tab opening link B must not be shown the dossier of link A. The token is
 * already in this tab's address bar, so storing it here exposes nothing new.
 */
const SESSION_KEY = 'portail-depot:token'

const rememberedToken = (): string | null => {
  try {
    return sessionStorage.getItem(SESSION_KEY)
  } catch {
    // Private modes throw on access rather than returning null. Forgetting is
    // the safe answer: the client is asked for their code again.
    return null
  }
}

const rememberToken = (token: string): void => {
  try {
    sessionStorage.setItem(SESSION_KEY, token)
  } catch {
    // Nothing to repair: the next reload asks for the code again.
  }
}

/** The client-side half of a deposit, which no API answer describes yet. */
type Upload =
  | { phase: 'uploading' | 'verifying'; progress: number; name: string }
  | { phase: 'failed'; name: string; message: string }

const messageFor = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.kind === 'network') return TEXT.unreachable
    // 413 and 415 arrive with the server's own French wording, quoted by the
    // API layer; a 400 carries the validation message the same way.
    if (error.kind === 'badRequest') return error.message
    if (error.kind === 'notFound') return TEXT.staleItem
  }
  return TEXT.unexpected
}

const noteFor = (upload: Upload | undefined): string | undefined => {
  if (upload?.phase === 'verifying') return TEXT.verifying
  if (upload?.phase === 'failed') return upload.message
  return undefined
}

const progressOf = (upload: Upload | undefined): number =>
  upload !== undefined && 'progress' in upload ? upload.progress : 0

/**
 * What ItemRow prints beside the state. While an upload is in flight or has
 * just failed, the only known fact is the name the client picked -- the size
 * and the date belong to a file the server has not confirmed, and ItemRow reads
 * neither in those two states.
 */
const fileFor = (
  upload: Upload | undefined,
  receipt: DepositedFileView | undefined,
): ReceivedFile | null => {
  if (upload !== undefined) {
    return { originalName: upload.name, mimeType: '', sizeBytes: 0, receivedAt: '' }
  }
  return receipt ?? null
}

/**
 * What a refused unlock says. The four causes -- unknown token, revoked link,
 * expired link, wrong code -- all arrive as the same 401 and all read the same
 * here. An unreachable server and a broken one are separated because neither is
 * an answer about this link.
 */
const refusalFor = (error: unknown): string => {
  if (error instanceof ApiError) {
    if (error.kind === 'network') return TEXT.unreachable
    if (error.kind === 'server') return TEXT.unexpected
  }
  return TEXT.refused
}

const isReceived = (item: PublicItemView, receipts: Record<string, DepositedFileView>): boolean =>
  item.received || receipts[item.id] !== undefined

// An upload in flight wins over what the server last said: a client replacing
// a piece they already deposited must see the new attempt, not the old receipt.
const stateOf = (
  item: PublicItemView,
  upload: Upload | undefined,
  receipts: Record<string, DepositedFileView>,
): ItemState => {
  if (upload?.phase === 'uploading' || upload?.phase === 'verifying') return 'uploading'
  if (upload?.phase === 'failed') return 'failed'
  return isReceived(item, receipts) ? 'received' : 'pending'
}

const DepositButton = ({
  label,
  variant,
  onPick,
}: {
  label: string
  /** The kit draws "Deposer" as the primary action; replacing a piece already
   *  received is a second thought, so it stays secondary. */
  variant: 'primary' | 'secondary'
  onPick: (file: File) => void
}) => {
  const input = useRef<HTMLInputElement | null>(null)

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset before handing the file over: picking the SAME file twice fires no
    // change event otherwise, so a client retrying after a refusal would tap a
    // dead button.
    event.target.value = ''
    if (file !== undefined) onPick(file)
  }

  return (
    <>
      {/* The button carries the focus and the visible ring; the input is driven
          from it -- a clipped input taking the focus would give a keyboard user
          a ring they cannot see. Bigger on a phone, which is where this screen
          is actually opened: sm is 40px tall, and a finger wants more. */}
      <Button
        variant={variant}
        size={{ base: 'md', md: 'sm' }}
        alignSelf="center"
        onClick={() => input.current?.click()}
      >
        {label}
      </Button>
      <chakra.input
        ref={input}
        srOnly
        tabIndex={-1}
        type="file"
        accept={ACCEPTED_TYPES}
        aria-label={label}
        onChange={onChange}
      />
    </>
  )
}

export const DepositPage = () => {
  const { token = '' } = useParams<{ token: string }>()

  const [view, setView] = useState<PublicRequestView | null>(null)
  const [loading, setLoading] = useState(true)
  const [pin, setPin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [uploads, setUploads] = useState<Record<string, Upload>>({})
  const [receipts, setReceipts] = useState<Record<string, DepositedFileView>>({})

  useEffect(() => {
    let active = true

    // Only this tab's own link is restored; anything else starts at the code.
    if (rememberedToken() !== token) {
      setLoading(false)
      return
    }

    getDepositSession()
      .then((restored) => {
        if (!active) return
        setView(restored)
        setLoading(false)
      })
      .catch((caught: unknown) => {
        if (!active) return
        // A 401 here is ordinary: the session simply ran out. It carries no
        // message, or every reload would accuse the client of a wrong code.
        if (caught instanceof ApiError && caught.kind === 'network') {
          setMessage(TEXT.unreachable)
        }
        setLoading(false)
      })

    return () => {
      active = false
    }
  }, [token])

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pin.length < PIN_LENGTH) {
      setMessage(TEXT.incomplete)
      return
    }

    setSubmitting(true)
    setMessage(null)
    try {
      const unlocked = await unlockDeposit(token, pin)
      rememberToken(token)
      setView(unlocked)
      setPin('')
    } catch (caught) {
      // Every refusal reads the same, whatever its cause -- the API answers one
      // 401 for the four of them, and four wordings here would hand back the
      // oracle it exists to remove. An outage is separated because it is not a
      // refusal at all: it says nothing about this link.
      setMessage(refusalFor(caught))
      setPin('')
    } finally {
      setSubmitting(false)
    }
  }

  const onPick = async (item: PublicItemView, file: File) => {
    setUploads((previous) => ({
      ...previous,
      [item.id]: { phase: 'uploading', progress: 0, name: file.name },
    }))

    try {
      const receipt = await depositFile(item.id, file, (percent) => {
        setUploads((previous) => {
          const current = previous[item.id]
          if (current === undefined || current.phase === 'failed') return previous
          // All the bytes are out; the server is still reading them. The row
          // says "verification", never "termine" -- the magic bytes check can
          // still refuse the file from here.
          return {
            ...previous,
            [item.id]:
              percent >= 100
                ? { phase: 'verifying', progress: 100, name: current.name }
                : { phase: 'uploading', progress: percent, name: current.name },
          }
        })
      })

      setReceipts((previous) => ({ ...previous, [item.id]: receipt }))
      // Rebuilt without the entry rather than destructured: an unused binding
      // is what the blocking lint would refuse.
      setUploads((previous) =>
        Object.fromEntries(Object.entries(previous).filter(([id]) => id !== item.id)),
      )
    } catch (caught) {
      // The link died under the client -- revoked, or the session ran out.
      // Back to the code screen, with the one refusal.
      if (caught instanceof ApiError && caught.kind === 'unauthorized') {
        setView(null)
        setUploads({})
        setMessage(TEXT.refused)
        return
      }
      setUploads((previous) => ({
        ...previous,
        [item.id]: { phase: 'failed', name: file.name, message: messageFor(caught) },
      }))
    }
  }

  const receivedCount =
    view === null ? 0 : view.items.filter((item) => isReceived(item, receipts)).length
  const complete = view !== null && view.items.length > 0 && receivedCount === view.items.length

  return (
    <Box minH="100dvh" bg="bg">
      {/* No link and no sign-out: this bar names the product, and nothing
          about the practice behind it. */}
      <Box as="header" borderBottomWidth="1px" borderColor="border" bg="bg">
        <Box maxW="1040px" mx="auto" px={{ base: '16px', md: '24px' }} py="16px">
          <Text fontWeight="600" fontSize="16px" color="brand.fg">
            {TEXT.brand}
          </Text>
        </Box>
      </Box>

      <Box as="main" maxW="1040px" mx="auto" px={{ base: '16px', md: '24px' }} py="24px">
        {loading ? (
          <LoadingSkeleton count={1} height="220px" />
        ) : view === null ? (
          <Box display="flex" justifyContent="center">
            <Card.Root maxW="420px" w="100%">
              <Card.Header>
                <Card.Title>{TEXT.eyebrow}</Card.Title>
              </Card.Header>
              <Card.Body>
                {/* noValidate: the browser's own bubble would name the empty
                    box in its own words, next to our single message. */}
                <form onSubmit={(event) => void onSubmit(event)} noValidate>
                  <Stack gap="16px">
                    <Stack gap="4px">
                      <Heading size="xl">{TEXT.title}</Heading>
                      <Text color="fg.muted" fontSize="14px">
                        {TEXT.subtitle}
                      </Text>
                    </Stack>

                    <PinEntry value={pin} onChange={setPin} disabled={submitting} />

                    {message === null ? null : <ErrorPanel message={message} />}

                    <Button type="submit" alignSelf="center" disabled={submitting}>
                      {submitting ? TEXT.submitting : TEXT.submit}
                    </Button>
                  </Stack>
                </form>
              </Card.Body>
            </Card.Root>
          </Box>
        ) : (
          <Stack gap="24px">
            <Stack gap="4px">
              <Heading size="xl">{view.title}</Heading>
              <Text color="fg.muted" fontSize="12px">
                {TEXT.expiry(formatDate(view.expiresAt))}
              </Text>
            </Stack>

            <Card.Root>
              <Card.Header>
                <Card.Title>{TEXT.itemsEyebrow}</Card.Title>
              </Card.Header>
              <Card.Body>
                <Stack gap="16px">
                  <Stack gap="4px">
                    <Text fontSize="14px" fontWeight="600">
                      {TEXT.progress(receivedCount, view.items.length)}
                    </Text>
                    <Text color="fg.muted" fontSize="12px">
                      {TEXT.accepted}
                    </Text>
                  </Stack>

                  {complete ? (
                    <Box role="status" bg="bg.subtle" borderRadius="l2" p="16px">
                      <Text fontSize="14px">{TEXT.complete}</Text>
                    </Box>
                  ) : null}

                  <Stack gap="0">
                    {view.items.map((item) => {
                      const upload = uploads[item.id]
                      const state = stateOf(item, upload, receipts)
                      return (
                        <ItemRow
                          key={item.id}
                          label={item.label}
                          state={state}
                          file={fileFor(upload, receipts[item.id])}
                          progress={progressOf(upload)}
                          note={noteFor(upload)}
                          action={
                            state === 'uploading' ? null : (
                              <DepositButton
                                label={state === 'received' ? TEXT.replace : TEXT.choose}
                                variant={state === 'received' ? 'secondary' : 'primary'}
                                onPick={(file) => void onPick(item, file)}
                              />
                            )
                          }
                        />
                      )
                    })}
                  </Stack>
                </Stack>
              </Card.Body>
            </Card.Root>
          </Stack>
        )}
      </Box>
    </Box>
  )
}
