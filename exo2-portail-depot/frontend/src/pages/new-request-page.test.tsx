import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CreatedRequest } from '../api/requests'
import { SessionContext } from '../auth/session'
import type { SessionState } from '../auth/session'
import { expiryDateFrom, formatDate } from '../format'
import { renderWithTheme } from '../test/render'
import { NewRequestPage } from './new-request-page'

type FetchMock = (url: string, init: RequestInit) => Promise<Response>

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const created: CreatedRequest = {
  id: 'r1',
  title: 'Dossier Martin, pieces 2026',
  createdAt: '2026-03-12T09:00:00.000Z',
  status: 'pending',
  items: [{ id: 'i1', label: "Piece d'identite", received: false }],
  link: {
    url: 'https://portail.example/depot/8f3a2c1b',
    pin: '4816',
    expiresAt: '2026-03-26T09:00:00.000Z',
  },
}

// Supplied as a context value rather than through SessionProvider, whose
// /auth/me call on mount would sit in front of every fetch assertion.
const session: SessionState = {
  status: 'authenticated',
  lawyer: { id: 'l1', name: 'Maitre Martin', email: 'martin@cabinet.fr' },
  signIn: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  signOut: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}

const renderPage = () =>
  renderWithTheme(
    <SessionContext.Provider value={session}>
      <MemoryRouter initialEntries={['/requests/new']}>
        <Routes>
          <Route path="/requests/new" element={<NewRequestPage />} />
          <Route path="/dashboard" element={<p>Tableau de bord</p>} />
        </Routes>
      </MemoryRouter>
    </SessionContext.Provider>,
  )

const fillValidForm = async () => {
  await userEvent.type(screen.getByLabelText(/intitule du dossier/i), 'Dossier Martin')
  await userEvent.type(screen.getAllByLabelText(/piece attendue/i)[0], "Piece d'identite")
}

const submit = () => userEvent.click(screen.getByRole('button', { name: /creer la demande/i }))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NewRequestPage', () => {
  it('adds and removes piece rows, and stops at twenty', async () => {
    renderPage()

    for (let index = 0; index < 25; index += 1) {
      const add = screen.queryByRole('button', { name: /ajouter une piece/i })
      if (add === null) break
      await userEvent.click(add)
    }

    expect(screen.getAllByLabelText(/piece attendue/i)).toHaveLength(20)
    expect(screen.queryByRole('button', { name: /ajouter une piece/i })).not.toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: /retirer la piece/i })[0])
    expect(screen.getAllByLabelText(/piece attendue/i)).toHaveLength(19)
  })

  // Removing a row must take ITS text with it. Keyed on the index, React reuses
  // the DOM node and the label of the row below jumps into the field above.
  it('removes the row that was clicked, not the text of its neighbour', async () => {
    renderPage()
    await userEvent.type(screen.getAllByLabelText(/piece attendue/i)[0], 'Bail')
    await userEvent.click(screen.getByRole('button', { name: /ajouter une piece/i }))
    await userEvent.type(screen.getAllByLabelText(/piece attendue/i)[1], 'Facture')

    await userEvent.click(screen.getAllByRole('button', { name: /retirer la piece/i })[0])

    const remaining = screen.getAllByLabelText(/piece attendue/i)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]).toHaveValue('Facture')
  })

  it('shows the expiry as a date, because the lawyer does not think in days', () => {
    renderPage()
    const expected = formatDate(expiryDateFrom(14).toISOString())
    expect(screen.getByText(new RegExp(`expire le ${expected}`, 'i'))).toBeInTheDocument()
  })

  // The client guides, the server decides: a 400 must show what the server said,
  // never a message invented here that could contradict it.
  it('shows the API message when the server refuses the body', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<FetchMock>()
        .mockResolvedValue(
          jsonResponse({ message: ['Deux pieces attendues portent le meme libelle.'] }, 400),
        ),
    )
    renderPage()

    await fillValidForm()
    await submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(/meme libelle/i)
  })

  it('keeps the form filled when the server refuses it', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchMock>().mockResolvedValue(jsonResponse({}, 400)))
    renderPage()

    await fillValidForm()
    await submit()

    await screen.findByRole('alert')
    expect(screen.getByLabelText(/intitule du dossier/i)).toHaveValue('Dossier Martin')
  })

  it('replaces the form with the link and the PIN once created', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchMock>().mockResolvedValue(jsonResponse(created)))
    renderPage()

    await fillValidForm()
    await submit()

    expect(await screen.findByDisplayValue(/depot\/8f3a2c1b/)).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText(/affiche qu'une fois/i)).toBeInTheDocument()
    // The form is gone: resubmitting would create a SECOND request, and the
    // first PIN would vanish with the screen.
    expect(screen.queryByRole('button', { name: /creer la demande/i })).not.toBeInTheDocument()
  })

  // Two separate buttons, and no prefilled mail: gathering the address and the
  // code in one gesture is exactly the leak the README describes.
  it('sends once on a double click', async () => {
    let release: (value: Response) => void = () => {}
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    const fetchMock = vi.fn<FetchMock>().mockReturnValue(pending)
    vi.stubGlobal('fetch', fetchMock)
    renderPage()

    await fillValidForm()
    const button = screen.getByRole('button', { name: /creer la demande/i })
    await userEvent.click(button)

    await waitFor(() => {
      expect(button).toBeDisabled()
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    release(jsonResponse(created))
  })

  it('refuses to submit an empty form rather than letting the server say so', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /creer la demande/i })).toBeDisabled()
  })
})
