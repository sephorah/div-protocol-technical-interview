import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DetailedItem, IssuedLink, RequestDetail } from '../api/requests'
import { SessionContext } from '../auth/session'
import type { SessionState } from '../auth/session'
import { saveBlob } from '../save-blob'
import { renderWithTheme } from '../test/render'
import { RequestDetailPage } from './request-detail-page'

// jsdom implements neither URL.createObjectURL nor a real download, so the
// handover to the browser is stubbed and asserted on instead. That it actually
// saves a file is checked in a real Chromium, not here.
vi.mock('../save-blob', () => ({
  saveBlob: vi.fn<(blob: Blob, filename: string) => void>(),
}))

type FetchMock = (url: string, init: RequestInit) => Promise<Response>

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const pending = (label: string, id = label): DetailedItem => ({
  id,
  label,
  received: false,
  file: null,
})

const received = (originalName: string, label = 'Contrat de bail signe'): DetailedItem => ({
  id: label,
  label,
  received: true,
  file: {
    originalName,
    mimeType: 'application/pdf',
    sizeBytes: 2411724,
    receivedAt: '2026-03-14T09:00:00.000Z',
  },
})

const detail = (over: Partial<RequestDetail> = {}): RequestDetail => ({
  id: 'r1',
  title: 'Dossier Martin, pieces 2026',
  createdAt: '2026-03-12T09:00:00.000Z',
  status: 'pending',
  expectedCount: 3,
  receivedCount: 1,
  link: { state: 'active', expiresAt: '2026-03-26T09:00:00.000Z' },
  items: [pending("Piece d'identite")],
  ...over,
})

const issued: IssuedLink = {
  url: 'https://portail.example/depot/newtoken',
  pin: '4816',
  expiresAt: '2026-04-09T09:00:00.000Z',
}

// Each entry BUILDS a response rather than being one: a Response body can only
// be read once, and the same detail payload is fetched again after a mutation.
const stubSequence = (builders: (() => Response)[]) => {
  const fetchMock = vi.fn<FetchMock>()
  for (const build of builders) fetchMock.mockImplementationOnce(() => Promise.resolve(build()))
  // Anything past the sequence keeps answering the last payload rather than
  // undefined, which would throw somewhere unrelated to the assertion.
  const last = builders.at(-1)
  if (last !== undefined) fetchMock.mockImplementation(() => Promise.resolve(last()))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const session: SessionState = {
  status: 'authenticated',
  lawyer: { id: 'l1', name: 'Maitre Martin', email: 'martin@cabinet.fr' },
  signIn: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  signOut: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}

const renderDetail = () =>
  renderWithTheme(
    <SessionContext.Provider value={session}>
      <MemoryRouter initialEntries={['/requests/r1']}>
        <Routes>
          <Route path="/requests/:id" element={<RequestDetailPage />} />
          <Route path="/dashboard" element={<p>Tableau de bord</p>} />
        </Routes>
      </MemoryRouter>
    </SessionContext.Provider>,
  )

afterEach(() => {
  vi.unstubAllGlobals()
  // The saveBlob spy is module-level, so its calls would otherwise carry over
  // and the "did not save" assertion would pass or fail on test ORDER.
  vi.clearAllMocks()
})

describe('RequestDetailPage', () => {
  // The open point B4 left, and the reason this test exists: originalName is
  // supplied by an anonymous client. React escapes HTML, it does not neutralise
  // U+202E -- which reverses the text after it and turns ".exe" into ".pdf" on
  // screen.
  it('strips the bidirectional override from a deposited file name', async () => {
    stubSequence([() => jsonResponse(detail({ items: [received('facture‮fdp.exe')] }))])
    renderDetail()

    expect(await screen.findByText('facturefdp.exe')).toBeInTheDocument()
    expect(screen.queryByText(/‮/)).not.toBeInTheDocument()
  })

  // Rendered as text and never as markup: the day someone reaches for
  // dangerouslySetInnerHTML to "display a file name properly", this fails.
  it('shows both the status and the link state', async () => {
    stubSequence([
      () =>
        jsonResponse(
          detail({
            status: 'complete',
            link: { state: 'revoked', expiresAt: '2026-03-26T09:00:00.000Z' },
          }),
        ),
    ])
    renderDetail()

    expect(await screen.findByText('Complete')).toBeInTheDocument()
    expect(screen.getByText(/lien revoque/i)).toBeInTheDocument()
  })

  it('lists expected pieces in the order the API returns them', async () => {
    stubSequence([
      () =>
        jsonResponse(
          detail({
            items: [pending('Bail'), pending('Facture EDF'), pending('Attestation')],
          }),
        ),
    ])
    renderDetail()

    await screen.findByText('Bail')
    const labels = screen
      .getAllByText(/^(Bail|Facture EDF|Attestation)$/)
      .map((node) => node.textContent)
    expect(labels).toEqual(['Bail', 'Facture EDF', 'Attestation'])
  })

  it('shows file metadata for a received piece and "en attente" otherwise', async () => {
    stubSequence([
      () =>
        jsonResponse(detail({ items: [received('contrat-signe.pdf'), pending('Facture EDF')] })),
    ])
    renderDetail()

    expect(await screen.findByText(/contrat-signe\.pdf/)).toBeInTheDocument()
    expect(screen.getByText(/PDF/)).toBeInTheDocument()
    expect(screen.getByText(/recu le/)).toBeInTheDocument()
    // Twice, and both are wanted: the request's own status pill, and the piece
    // nobody has deposited yet.
    expect(screen.getAllByText('En attente')).toHaveLength(2)
  })

  // Regeneration is the ONLY way back to a link in clear, so it must show it the
  // same way the creation does -- warning included.
  it('shows the new link and PIN after regenerating', async () => {
    stubSequence([
      () => jsonResponse(detail()),
      () => jsonResponse(issued),
      () => jsonResponse(detail()),
    ])
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: /regenerer/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirmer/i }))

    expect(await screen.findByDisplayValue(/depot\/newtoken/)).toBeInTheDocument()
    expect(screen.getByText(/affiche qu'une fois/i)).toBeInTheDocument()
  })

  // Naming the consequence is the point: "Confirmer ?" alone would let a lawyer
  // cut a link their client is already using without knowing it.
  it('names what regenerating costs before doing it', async () => {
    stubSequence([() => jsonResponse(detail())])
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: /regenerer/i }))

    expect(screen.getByText(/cessera de fonctionner/i)).toBeInTheDocument()
  })

  it('asks for confirmation before revoking, and refreshes the state after', async () => {
    stubSequence([
      () => jsonResponse(detail()),
      () => new Response(null, { status: 204 }),
      () =>
        jsonResponse(
          detail({ link: { state: 'revoked', expiresAt: '2026-03-26T09:00:00.000Z' } }),
        ),
    ])
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: /revoquer/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirmer/i }))

    expect(await screen.findByText(/lien revoque/i)).toBeInTheDocument()
  })

  it('does not revoke when the confirmation is dismissed', async () => {
    const fetchMock = stubSequence([() => jsonResponse(detail())])
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: /revoquer/i }))
    await userEvent.click(screen.getByRole('button', { name: /annuler/i }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /confirmer/i })).not.toBeInTheDocument()
  })

  // A revoked link cannot be revoked again; only regenerating gets the client
  // back in.
  it('drops the revoke button once the link is revoked', async () => {
    stubSequence([
      () =>
        jsonResponse(
          detail({ link: { state: 'revoked', expiresAt: '2026-03-26T09:00:00.000Z' } }),
        ),
    ])
    renderDetail()

    expect(await screen.findByRole('button', { name: /regenerer/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /revoquer/i })).not.toBeInTheDocument()
  })

  it('shows a 404 as "demande introuvable", not as a network error', async () => {
    stubSequence([() => jsonResponse({}, 404)])
    renderDetail()

    expect(await screen.findByRole('alert')).toHaveTextContent(/demande introuvable/i)
  })

  it('offers a retry on a server error rather than a dead screen', async () => {
    const fetchMock = vi
      .fn<FetchMock>()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockImplementation(() => Promise.resolve(jsonResponse(detail())))
    vi.stubGlobal('fetch', fetchMock)
    renderDetail()

    await userEvent.click(await screen.findByRole('button', { name: /reessayer/i }))

    expect(await screen.findByText("Piece d'identite")).toBeInTheDocument()
  })

  // B4b shipped the route and no way to reach it: the lawyer could not get the
  // pieces their client had deposited, which is what the product is for.
  describe('downloading a piece', () => {
    it('offers nothing on a piece nobody has deposited yet', async () => {
      stubSequence([() => jsonResponse(detail({ items: [pending("Piece d'identite")] }))])
      renderDetail()

      expect(await screen.findByText("Piece d'identite")).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /telecharger/i })).not.toBeInTheDocument()
    })

    it('saves the bytes under the name the server chose', async () => {
      const fetchMock = stubSequence([
        () => jsonResponse(detail({ items: [received('contrat.pdf')] })),
        () =>
          new Response('%PDF-1.4', {
            status: 200,
            headers: {
              'content-type': 'application/pdf',
              'content-disposition': "attachment; filename*=UTF-8''contrat.pdf",
            },
          }),
      ])
      renderDetail()

      await userEvent.click(await screen.findByRole('button', { name: /telecharger/i }))

      expect(fetchMock.mock.calls[1][0]).toBe(
        '/api/v1/requests/r1/items/Contrat%20de%20bail%20signe/file',
      )
      // The bytes themselves, not `expect.any(Blob)`: response.blob() hands
      // back Node's Blob, which is not the jsdom global this file would
      // compare against -- and the content is what actually matters.
      const [blob, filename] = vi.mocked(saveBlob).mock.calls[0]
      expect(filename).toBe('contrat.pdf')
      expect(await blob.text()).toBe('%PDF-1.4')
    })

    // The accessible name carries the piece, not just the verb: a request with
    // three received pieces would otherwise expose three identical buttons.
    it('names the piece in the accessible label', async () => {
      stubSequence([
        () => jsonResponse(detail({ items: [received('contrat.pdf', 'Bail signe')] })),
      ])
      renderDetail()

      expect(
        await screen.findByRole('button', { name: 'Telecharger Bail signe' }),
      ).toBeInTheDocument()
    })

    // The piece can vanish between the page load and the click. The screen has
    // to say so: a click that does nothing reads as a broken button.
    it('reports a refusal instead of failing silently', async () => {
      stubSequence([
        () => jsonResponse(detail({ items: [received('contrat.pdf')] })),
        () => jsonResponse({ message: 'Not Found' }, 404),
      ])
      renderDetail()

      await userEvent.click(await screen.findByRole('button', { name: /telecharger/i }))

      expect(await screen.findByRole('alert')).toHaveTextContent(/introuvable/i)
      expect(saveBlob).not.toHaveBeenCalled()
    })
  })
})
