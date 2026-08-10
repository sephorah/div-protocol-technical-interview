import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RequestPage, RequestSummary } from '../api/requests'
import { SessionContext } from '../auth/session'
import type { SessionState } from '../auth/session'
import { renderWithTheme } from '../test/render'
import { DashboardPage } from './dashboard-page'

type FetchMock = (url: string, init: RequestInit) => Promise<Response>

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const stubFetch = (response: Response) => {
  const fetchMock = vi.fn<FetchMock>().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const summary = (over: Partial<RequestSummary> = {}): RequestSummary => ({
  id: 'r1',
  title: 'Dossier Martin, pieces 2026',
  createdAt: '2026-03-12T09:00:00.000Z',
  status: 'pending',
  expectedCount: 4,
  receivedCount: 2,
  link: { state: 'active', expiresAt: '2026-03-26T09:00:00.000Z' },
  ...over,
})

const page = (over: Partial<RequestPage> = {}): RequestPage => ({
  items: [summary()],
  page: 1,
  pageSize: 10,
  total: 1,
  totalPages: 1,
  ...over,
})

// The session is supplied as a context value rather than through
// SessionProvider: the provider calls /auth/me on mount, and every assertion
// on "which URL was fetched" would then have to look past that call.
const session: SessionState = {
  status: 'authenticated',
  lawyer: { id: 'l1', name: 'Maitre Martin', email: 'martin@cabinet.fr' },
  signIn: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  signOut: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}

const renderDashboard = () =>
  renderWithTheme(
    <SessionContext.Provider value={session}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/requests/new" element={<p>Ecran de creation</p>} />
        </Routes>
      </MemoryRouter>
    </SessionContext.Provider>,
  )

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DashboardPage', () => {
  it('shows the empty state rather than a blank screen', async () => {
    stubFetch(jsonResponse(page({ items: [], total: 0, totalPages: 0 })))
    renderDashboard()

    expect(await screen.findByText(/aucune demande/i)).toBeInTheDocument()
    // Two entry points carry the same label -- the header action and the empty
    // state's own button -- and both must reach the creation screen.
    const links = screen.getAllByRole('link', { name: /creer une demande/i })
    expect(links).toHaveLength(2)
    for (const link of links) expect(link).toHaveAttribute('href', '/requests/new')
  })

  // The point B4 makes and a single column would lose: the two facts are
  // independent, so a complete request whose link is cut must show both.
  it('renders the status and the link state as two separate pills', async () => {
    stubFetch(
      jsonResponse(
        page({
          items: [
            summary({
              status: 'complete',
              link: { state: 'revoked', expiresAt: '2026-03-26T09:00:00.000Z' },
            }),
          ],
        }),
      ),
    )
    renderDashboard()

    expect(await screen.findByText('Complete')).toBeInTheDocument()
    expect(screen.getByText(/lien revoque/i)).toBeInTheDocument()
  })

  it('reads the progress off the counts', async () => {
    stubFetch(jsonResponse(page()))
    renderDashboard()

    expect(await screen.findByText(/2 pieces sur 4/i)).toBeInTheDocument()
  })

  it('points each card at its own detail screen', async () => {
    stubFetch(jsonResponse(page({ items: [summary({ id: 'abc' })] })))
    renderDashboard()

    expect(await screen.findByRole('link', { name: /gerer le lien/i })).toHaveAttribute(
      'href',
      '/requests/abc',
    )
  })

  it('asks for the next page and says which one it is showing', async () => {
    const fetchMock = stubFetch(jsonResponse(page({ total: 25, totalPages: 2 })))
    renderDashboard()

    expect(await screen.findByText('Page 1 sur 2')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /suivant/i }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('page=2'),
        expect.anything(),
      )
    })
  })

  // On page one there is nothing before: an enabled arrow would ask the API for
  // a page zero and answer 400.
  it('disables the backward arrow on the first page', async () => {
    stubFetch(jsonResponse(page({ total: 25, totalPages: 2 })))
    renderDashboard()

    expect(await screen.findByRole('button', { name: /precedent/i })).toBeDisabled()
  })

  // Hidden rather than disabled: two dead arrows and a "Page 1 sur 1" are three
  // controls that say nothing on the only page there is.
  it('hides the pagination when there is a single page', async () => {
    stubFetch(jsonResponse(page()))
    renderDashboard()

    await screen.findByText(/2 pieces sur 4/i)
    expect(screen.queryByRole('button', { name: /suivant/i })).not.toBeInTheDocument()
  })

  // A failed list must say so; the empty state would claim the lawyer has no
  // request, which is a different and wrong statement.
  it('distinguishes a failed load from an empty list', async () => {
    stubFetch(jsonResponse({}, 500))
    renderDashboard()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText(/aucune demande/i)).not.toBeInTheDocument()
  })

  it('retries the same page rather than reloading the browser', async () => {
    const fetchMock = vi
      .fn<FetchMock>()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValue(jsonResponse(page()))
    vi.stubGlobal('fetch', fetchMock)
    renderDashboard()

    await userEvent.click(await screen.findByRole('button', { name: /reessayer/i }))

    expect(await screen.findByText(/2 pieces sur 4/i)).toBeInTheDocument()
  })
})
