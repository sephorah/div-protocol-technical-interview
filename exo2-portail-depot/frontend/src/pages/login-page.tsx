import { Box, Button, Card, Field, Heading, Input, Stack, Text } from '@chakra-ui/react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { useSession } from '../auth/session'

// Grouped at the top: the product is single-language (see README, limitations),
// and gathering the strings here makes a later translation mechanical.
const TEXT = {
  eyebrow: 'Espace avocat',
  title: 'Portail de depot',
  subtitle: 'Connectez-vous pour gerer vos demandes de pieces.',
  email: 'Adresse e-mail',
  password: 'Mot de passe',
  submit: 'Se connecter',
  submitting: 'Connexion...',
  missingFields: 'Renseignez votre adresse e-mail et votre mot de passe.',
  refused: 'Identifiants refuses.',
  unreachable: 'Serveur injoignable. Reessayez dans un instant.',
  notFound: 'API introuvable.',
  unexpected: 'Une erreur est survenue.',
}

const messageFor = (error: unknown): string => {
  if (error instanceof ApiError) {
    // One message for "unknown address" and "wrong password": the backend
    // already equalises their cost, and separating them here would reinstate
    // the account enumerator. 400 joins them -- a rejected body says nothing
    // more useful and would leak which field the API disliked.
    if (error.kind === 'unauthorized' || error.kind === 'badRequest') return TEXT.refused
    if (error.kind === 'network') return TEXT.unreachable
    if (error.kind === 'notFound') return TEXT.notFound
  }
  return TEXT.unexpected
}

export const LoginPage = () => {
  const { signIn } = useSession()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (email.trim() === '' || password === '') {
      setError(TEXT.missingFields)
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await signIn(email.trim(), password)
      // Awaited, not voided: react-router 7 returns a promise here, and the
      // button must stay disabled until the navigation has actually happened.
      await navigate('/dashboard', { replace: true })
    } catch (caught) {
      setError(messageFor(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box display="flex" minH="100dvh" alignItems="center" justifyContent="center" p="16px">
      <Card.Root maxW="420px" w="100%">
        {/* The kit's header band is a SECTION LABEL at 11px, not a page
            title. The readable heading belongs in the body. */}
        <Card.Header>
          <Card.Title>{TEXT.eyebrow}</Card.Title>
        </Card.Header>
        <Card.Body>
          {/* noValidate: the browser's own bubble would say which field is
              empty in its own words, next to our single message. */}
          <form onSubmit={(event) => void onSubmit(event)} noValidate>
            <Stack gap="16px">
              <Stack gap="4px">
                <Heading size="xl">{TEXT.title}</Heading>
                <Text color="fg.muted" fontSize="14px">
                  {TEXT.subtitle}
                </Text>
              </Stack>

              <Field.Root invalid={error !== null}>
                <Field.Label>{TEXT.email}</Field.Label>
                <Input
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field.Root>

              <Field.Root invalid={error !== null}>
                <Field.Label>{TEXT.password}</Field.Label>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field.Root>

              {error !== null ? (
                <Text role="alert" color="fg.error" fontSize="12px">
                  {error}
                </Text>
              ) : null}

              {/* Stack stretches its children; the charter's buttons hug
                  their label with 14x24 of padding, like the kit's
                  "Creer une demande". */}
              <Button type="submit" alignSelf="center" disabled={submitting}>
                {submitting ? TEXT.submitting : TEXT.submit}
              </Button>
            </Stack>
          </form>
        </Card.Body>
      </Card.Root>
    </Box>
  )
}
