import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { SessionContext } from '../auth/session'
import type { SessionState } from '../auth/session'
import { renderWithTheme } from '../test/render'
import { AppShell } from './app-shell'

const session = (overrides: Partial<SessionState> = {}): SessionState => ({
  status: 'authenticated',
  lawyer: { id: 'l1', name: 'Maitre Martin', email: 'martin@cabinet.fr' },
  signIn: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  signOut: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  ...overrides,
})

const renderShell = (state: SessionState) =>
  renderWithTheme(
    <SessionContext.Provider value={state}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route
            path="/dashboard"
            element={
              <AppShell>
                <p>Contenu</p>
              </AppShell>
            }
          />
          <Route path="/login" element={<p>Ecran de connexion</p>} />
        </Routes>
      </MemoryRouter>
    </SessionContext.Provider>,
  )

describe('AppShell', () => {
  it('names the signed-in lawyer and renders the screen under the bar', () => {
    renderShell(session())
    expect(screen.getByText('martin@cabinet.fr')).toBeInTheDocument()
    expect(screen.getByText('Contenu')).toBeInTheDocument()
  })

  // Signing out has to leave the portal, not merely drop the cookie: staying on
  // /dashboard would show the lawyer a screen they can no longer load.
  it('signs out and lands on the login screen', async () => {
    const state = session()
    renderShell(state)

    await userEvent.click(screen.getByRole('button', { name: /se deconnecter/i }))

    expect(state.signOut).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Ecran de connexion')).toBeInTheDocument()
  })

  it('points its title at the dashboard, so every screen has a way back', () => {
    renderShell(session())
    expect(screen.getByRole('link', { name: /portail de depot/i })).toHaveAttribute(
      'href',
      '/dashboard',
    )
  })
})
