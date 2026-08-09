import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from './session-provider'
import { useSession } from './session'

type FetchMock = (url: string, init: RequestInit) => Promise<Response>

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const profile = { id: '1', name: 'Me Test', email: 'a@b.c' }

const Probe = () => {
  const { status, lawyer, signOut } = useSession()
  return (
    <div>
      <p>
        {status}:{lawyer?.email ?? 'none'}
      </p>
      <button type="button" onClick={() => void signOut()}>
        sortir
      </button>
    </div>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SessionProvider', () => {
  it('asks the API who is logged in, the cookies being unreadable from JavaScript', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchMock>().mockResolvedValue(jsonResponse(profile)))
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    )
    await waitFor(() => expect(screen.getByText('authenticated:a@b.c')).toBeInTheDocument())
  })

  it('settles on anonymous rather than loading forever when there is no session', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchMock>().mockResolvedValue(jsonResponse({}, 401)))
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    )
    await waitFor(() => expect(screen.getByText('anonymous:none')).toBeInTheDocument())
  })

  // A definitive "loading" would show an empty screen and never say why.
  it('settles on anonymous when the API is unreachable, so the app never hangs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>().mockRejectedValue(new TypeError('failed to fetch')),
    )
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    )
    await waitFor(() => expect(screen.getByText('anonymous:none')).toBeInTheDocument())
  })

  // A refused logout must still close the interface: the opposite leaves a
  // screen that looks signed in with no session behind it.
  it('closes the session locally even when the server refuses the logout', async () => {
    const fetchMock = vi
      .fn<FetchMock>()
      .mockResolvedValueOnce(jsonResponse(profile))
      .mockRejectedValue(new TypeError('failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    )
    await waitFor(() => expect(screen.getByText('authenticated:a@b.c')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'sortir' }))

    await waitFor(() => expect(screen.getByText('anonymous:none')).toBeInTheDocument())
  })

  it('refuses to be used outside its provider rather than handing out a blank session', () => {
    // React logs the thrown error; silenced so the run stays readable.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/SessionProvider/)
    consoleError.mockRestore()
  })
})
