import { ChakraProvider } from '@chakra-ui/react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '../auth/session-provider'
import { system } from '../theme'
import { LoginPage } from './login-page'

type FetchMock = (url: string, init: RequestInit) => Promise<Response>

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const renderPage = () =>
  render(
    <ChakraProvider value={system}>
      <MemoryRouter>
        <SessionProvider>
          <LoginPage />
        </SessionProvider>
      </MemoryRouter>
    </ChakraProvider>,
  )

const fillAndSubmit = async (password = 'secret') => {
  await userEvent.type(screen.getByLabelText(/adresse e-mail/i), 'avocat@example.com')
  await userEvent.type(screen.getByLabelText(/mot de passe/i), password)
  await userEvent.click(screen.getByRole('button', { name: /se connecter/i }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('LoginPage', () => {
  it('does not call the API when the form is empty', async () => {
    const fetchMock = vi.fn<FetchMock>().mockResolvedValue(jsonResponse({}, 401))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    // Mounting costs two calls, not one: /auth/me answers 401 and the client
    // spends its single renewal attempt on /auth/refresh. Both have to land
    // before the count below means anything.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    await userEvent.click(screen.getByRole('button', { name: /se connecter/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shows one neutral message on refused credentials, never naming which field is wrong', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchMock>().mockResolvedValue(jsonResponse({}, 401)))
    renderPage()

    await fillAndSubmit('mauvais')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/identifiants/i)
    expect(alert).not.toHaveTextContent(/inconnue|inexistant|introuvable/i)
  })

  it('distinguishes an unreachable API from refused credentials', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<FetchMock>()
        .mockResolvedValueOnce(jsonResponse({}, 401))
        .mockRejectedValue(new TypeError('failed to fetch')),
    )
    renderPage()

    await fillAndSubmit()

    expect(await screen.findByRole('alert')).toHaveTextContent(/injoignable/i)
  })

  // A prefix drifting apart from nginx must not read as a network outage.
  it('names a missing API when the prefix no longer resolves', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<FetchMock>()
        .mockResolvedValueOnce(jsonResponse({}, 401))
        .mockResolvedValue(jsonResponse({}, 404)),
    )
    renderPage()

    await fillAndSubmit()

    expect(await screen.findByRole('alert')).toHaveTextContent(/introuvable/i)
  })

  it('disables the button while the request is in flight, so a double click sends once', async () => {
    let release: (value: Response) => void = () => {}
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn<FetchMock>()
        .mockResolvedValueOnce(jsonResponse({}, 401))
        .mockReturnValue(pending),
    )
    renderPage()

    await fillAndSubmit()
    const button = screen.getByRole('button', { name: /connexion/i })

    await waitFor(() => expect(button).toBeDisabled())
    release(jsonResponse({ id: '1', name: 'Me Test', email: 'avocat@example.com' }))
  })
})
