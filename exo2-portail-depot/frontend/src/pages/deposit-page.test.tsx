import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PublicRequestView } from '../api/public'
import { renderWithTheme } from '../test/render'
import { DepositPage } from './deposit-page'

const TOKEN = 'jeton-de-depot'

type FetchMock = (url: string, init: RequestInit) => Promise<Response>

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const view = (over: Partial<PublicRequestView> = {}): PublicRequestView => ({
  requestId: 'r1',
  title: 'Dossier Martin, pieces 2026',
  expiresAt: '2026-03-26T09:00:00.000Z',
  items: [
    { id: 'i1', label: 'Contrat de bail signe', received: false },
    { id: 'i2', label: "Piece d'identite", received: true },
  ],
  ...over,
})

/**
 * The deposit goes through XMLHttpRequest, which is the only transport that
 * reports how much of the body has left the browser. The double lets a test
 * stop between "all the bytes are sent" and "the server answered" -- the exact
 * window rule 3 of C3 is about.
 */
class FakeXhr extends EventTarget {
  static instances: FakeXhr[] = []
  upload = new EventTarget()
  status = 0
  responseText = ''
  body: FormData | null = null

  constructor() {
    super()
    FakeXhr.instances.push(this)
  }

  open() {}
  setRequestHeader() {}
  getResponseHeader(name: string) {
    return name === 'content-type' ? 'application/json' : null
  }
  send(body: FormData) {
    this.body = body
  }

  /** All the bytes are out; nothing has come back yet. */
  sent() {
    this.upload.dispatchEvent(new Event('load'))
  }

  answer(status: number, payload: unknown) {
    this.status = status
    this.responseText = JSON.stringify(payload)
    this.dispatchEvent(new Event('load'))
  }
}

const stubXhr = () => {
  FakeXhr.instances = []
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
}

const lastXhr = (): FakeXhr => {
  const instance = FakeXhr.instances.at(-1)
  if (instance === undefined) throw new Error('no upload was started')
  return instance
}

const renderDeposit = () =>
  renderWithTheme(
    <MemoryRouter initialEntries={[`/deposit/${TOKEN}`]}>
      <Routes>
        <Route path="/deposit/:token" element={<DepositPage />} />
      </Routes>
    </MemoryRouter>,
  )

const unlock = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getAllByRole('textbox')[0])
  await user.keyboard('4207')
  await user.click(screen.getByRole('button', { name: 'Ouvrir le dossier' }))
}

const pdf = (name = 'contrat.pdf') =>
  new File(['%PDF-1.4'], name, { type: 'application/pdf' })

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

describe('DepositPage', () => {
  /**
   * The rule the whole screen hangs on. The API answers ONE 401 for an unknown
   * token, a revoked link, an expired link and a wrong code, so that nobody can
   * walk a list of links and see which are alive. Quoting the body, or telling
   * the four apart in any way, would rebuild that oracle on the screen.
   */
  it('gives one and the same refusal whatever the server says about it', async () => {
    const user = userEvent.setup()
    const bodies = [
      { message: 'Lien ou code invalide.' },
      { message: 'Ce lien a expire le 3 mars.' },
    ]
    const seen: string[] = []

    for (const body of bodies) {
      vi.stubGlobal('fetch', vi.fn<FetchMock>().mockResolvedValue(jsonResponse(body, 401)))
      const { unmount } = renderDeposit()
      await unlock(user)

      const alert = await screen.findByRole('alert')
      seen.push(alert.textContent ?? '')
      expect(alert).not.toHaveTextContent(/expire le 3 mars/)
      expect(alert).not.toHaveTextContent(/invalide/)
      unmount()
    }

    expect(seen[0]).toBe(seen[1])
  })

  it('shows the checklist and the count once the code is right', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn<FetchMock>().mockResolvedValue(jsonResponse(view())))
    renderDeposit()
    await unlock(user)

    expect(await screen.findByText('Dossier Martin, pieces 2026')).toBeInTheDocument()
    expect(screen.getByText('1 sur 2 pieces deposees')).toBeInTheDocument()
    expect(screen.getByText('Contrat de bail signe')).toBeInTheDocument()
    expect(screen.getByText(/26 mars 2026/)).toBeInTheDocument()
  })

  // Rule 2: this page is reachable by anyone holding the link. Nothing about
  // the practice, its other cases or its identifiers may appear on it.
  it('says nothing about the lawyer or any other case', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn<FetchMock>().mockResolvedValue(jsonResponse(view())))
    renderDeposit()
    await unlock(user)

    await screen.findByText('Dossier Martin, pieces 2026')
    expect(screen.queryByText(/deconnecter/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/@/)).not.toBeInTheDocument()
    // The technical identifiers of the request and its pieces stay internal.
    expect(screen.queryByText(/\br1\b/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\bi1\b/)).not.toBeInTheDocument()
  })

  /**
   * Rule 3, and the reason the upload does not go through fetch: between the
   * last byte sent and the 201 the server is still reading the magic bytes and
   * can still refuse the file. A row saying "termine" there would be a promise
   * nobody has made.
   */
  it('never calls a deposit done before the server has answered', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn<FetchMock>().mockResolvedValue(jsonResponse(view())))
    stubXhr()
    renderDeposit()
    await unlock(user)
    await screen.findByText('Contrat de bail signe')

    await user.upload(screen.getAllByLabelText('Deposer un fichier')[0], pdf())
    act(() => {
      lastXhr().sent()
    })

    expect(await screen.findByText(/verification en cours/i)).toBeInTheDocument()
    expect(screen.queryByText(/recu le/i)).not.toBeInTheDocument()
    expect(screen.getByText('1 sur 2 pieces deposees')).toBeInTheDocument()

    act(() => {
      lastXhr().answer(201, {
        itemId: 'i1',
        originalName: 'contrat.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 2_411_724,
        receivedAt: '2026-03-14T10:32:00.000Z',
      })
    })

    expect(await screen.findByText(/recu le 14 mars 2026/i)).toBeInTheDocument()
    expect(screen.getByText('2 sur 2 pieces deposees')).toBeInTheDocument()
    expect(screen.getByText(/Toutes les pieces ont ete deposees/)).toBeInTheDocument()
  })

  /**
   * Rule 4: the 413 and the 415 are the only two refusals whose wording our own
   * backend writes (upload.constants.ts). Rewritten here they would be a second
   * copy of a limit the server owns, free to drift the day it changes.
   */
  it('shows the server wording of a refused format', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn<FetchMock>().mockResolvedValue(jsonResponse(view())))
    stubXhr()
    renderDeposit()
    await unlock(user)
    await screen.findByText('Contrat de bail signe')

    await user.upload(screen.getAllByLabelText('Deposer un fichier')[0], pdf('photo.gif'))
    act(() => {
      lastXhr().answer(415, { message: 'Format refusé. PDF, JPG ou PNG uniquement.' })
    })

    expect(await screen.findByText('Format refusé. PDF, JPG ou PNG uniquement.')).toBeInTheDocument()
    expect(screen.getByText(/depot echoue/i)).toBeInTheDocument()
    // The piece is not counted as deposited, and the client can retry.
    expect(screen.getByText('1 sur 2 pieces deposees')).toBeInTheDocument()
  })

  it('shows the server wording of an oversized file', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn<FetchMock>().mockResolvedValue(jsonResponse(view())))
    stubXhr()
    renderDeposit()
    await unlock(user)
    await screen.findByText('Contrat de bail signe')

    await user.upload(screen.getAllByLabelText('Deposer un fichier')[0], pdf('gros.pdf'))
    act(() => {
      lastXhr().answer(413, { message: 'Fichier trop volumineux (20 Mo maximum).' })
    })

    expect(
      await screen.findByText('Fichier trop volumineux (20 Mo maximum).'),
    ).toBeInTheDocument()
  })

  // A link revoked while the client had the page open. The screen closes back
  // to the code, with the one refusal -- not with a technical 401.
  it('closes back to the code screen when the link dies mid-deposit', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn<FetchMock>().mockResolvedValue(jsonResponse(view())))
    stubXhr()
    renderDeposit()
    await unlock(user)
    await screen.findByText('Contrat de bail signe')

    await user.upload(screen.getAllByLabelText('Deposer un fichier')[0], pdf())
    act(() => {
      lastXhr().answer(401, { message: 'Unauthorized' })
    })

    expect(await screen.findByRole('button', { name: 'Ouvrir le dossier' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/demandez un nouveau lien/i)
    expect(screen.queryByText('Contrat de bail signe')).not.toBeInTheDocument()
  })

  /**
   * The client session cookie names ONE dossier and is scoped to the whole
   * /public prefix. A tab opening a second link must not be shown the first
   * link's dossier because its cookie is still there.
   */
  it('does not restore a session opened by another link', async () => {
    sessionStorage.setItem('portail-depot:token', 'un-autre-jeton')
    const fetchMock = vi.fn<FetchMock>().mockResolvedValue(jsonResponse(view()))
    vi.stubGlobal('fetch', fetchMock)
    renderDeposit()

    expect(await screen.findByRole('button', { name: 'Ouvrir le dossier' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('restores its own session on a reload, without asking for the code again', async () => {
    sessionStorage.setItem('portail-depot:token', TOKEN)
    const fetchMock = vi.fn<FetchMock>().mockResolvedValue(jsonResponse(view()))
    vi.stubGlobal('fetch', fetchMock)
    renderDeposit()

    expect(await screen.findByText('Dossier Martin, pieces 2026')).toBeInTheDocument()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/public/session')
  })

  // An expired session on reload is ordinary, not an accusation: the code
  // screen comes back silent.
  it('asks for the code again without a message when the session has run out', async () => {
    sessionStorage.setItem('portail-depot:token', TOKEN)
    vi.stubGlobal('fetch', vi.fn<FetchMock>().mockResolvedValue(jsonResponse({}, 401)))
    renderDeposit()

    expect(await screen.findByRole('button', { name: 'Ouvrir le dossier' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('refuses to submit an incomplete code without calling the API', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn<FetchMock>().mockResolvedValue(jsonResponse(view()))
    vi.stubGlobal('fetch', fetchMock)
    renderDeposit()

    await user.click(screen.getAllByRole('textbox')[0])
    await user.keyboard('42')
    await user.click(screen.getByRole('button', { name: 'Ouvrir le dossier' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/4 chiffres/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the code to the unlock route of this token', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn<FetchMock>().mockResolvedValue(jsonResponse(view()))
    vi.stubGlobal('fetch', fetchMock)
    renderDeposit()
    await unlock(user)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/v1/public/${TOKEN}/unlock`)
    expect(init.body).toBe(JSON.stringify({ pin: '4207' }))
  })

  it('posts the file against the piece it was picked for', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn<FetchMock>().mockResolvedValue(jsonResponse(view())))
    stubXhr()
    renderDeposit()
    await unlock(user)
    await screen.findByText('Contrat de bail signe')

    // The second row is the one already received: its control replaces.
    await user.upload(screen.getByLabelText('Remplacer le fichier'), pdf('cni.jpg'))

    expect(lastXhr().body?.get('itemId')).toBe('i2')
  })
})
