import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithTheme } from '../test/render'
import { EmptyState, ErrorPanel, LoadingSkeleton } from './screen-state'

describe('LoadingSkeleton', () => {
  it('is announced as a loading state, not left silent', () => {
    renderWithTheme(<LoadingSkeleton />)
    expect(screen.getByRole('status')).toHaveAccessibleName(/chargement/i)
  })

  // A 24px spinner replaced by a 140px card makes the page jump under the
  // cursor the moment the data lands. The height is asserted as DECLARED --
  // jsdom lays nothing out, so this reads the style, not a measured box.
})

describe('EmptyState', () => {
  it('says there is nothing and offers the way out', () => {
    renderWithTheme(
      <EmptyState
        title="Aucune demande en cours"
        description="Creez une demande pour recuperer des pieces."
        action={<button type="button">Creer une demande</button>}
      />,
    )
    expect(screen.getByText('Aucune demande en cours')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Creer une demande' })).toBeInTheDocument()
  })
})

describe('ErrorPanel', () => {
  it('is announced as an alert, so the page does not silently stop changing', () => {
    renderWithTheme(<ErrorPanel message="Serveur injoignable." onRetry={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Serveur injoignable.')
  })

  // Reessayer calls reload(), never location.reload(): a page reload would
  // replay /auth/me and the renewal round trip for nothing.
  it('retries in place instead of reloading the page', async () => {
    const onRetry = vi.fn<() => void>()
    renderWithTheme(<ErrorPanel message="Serveur injoignable." onRetry={onRetry} />)

    await userEvent.click(screen.getByRole('button', { name: /reessayer/i }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  // The lie this forbids: "Aucune demande en cours" on a GET that failed tells
  // the lawyer they have no case file. A failure says it failed, and offers a
  // retry -- never a creation.
  it('never reads as an empty list', () => {
    renderWithTheme(<ErrorPanel message="Serveur injoignable." onRetry={() => {}} />)
    expect(screen.queryByText(/aucune demande/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
