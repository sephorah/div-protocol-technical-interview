import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithTheme } from '../test/render'
import { LinkStateBadge, StatusBadge } from './status-badge'

describe('StatusBadge', () => {
  it('names the three statuses in French', () => {
    renderWithTheme(
      <>
        <StatusBadge status="pending" />
        <StatusBadge status="complete" />
        <StatusBadge status="expired" />
      </>,
    )
    expect(screen.getByText('En attente')).toBeInTheDocument()
    expect(screen.getByText('Complete')).toBeInTheDocument()
    expect(screen.getByText('Expiree')).toBeInTheDocument()
  })
})

describe('LinkStateBadge', () => {
  // Two independent facts (B4): a complete request whose link is revoked must
  // still say so, or the lawyer cannot tell whether to regenerate.
  it('says the state of the link, next to and not instead of the status', () => {
    renderWithTheme(
      <>
        <StatusBadge status="complete" />
        <LinkStateBadge state="revoked" />
      </>,
    )
    expect(screen.getByText('Complete')).toBeInTheDocument()
    expect(screen.getByText('Lien revoque')).toBeInTheDocument()
  })

  it('distinguishes an active link from a revoked one', () => {
    renderWithTheme(<LinkStateBadge state="active" />)
    expect(screen.getByText('Lien actif')).toBeInTheDocument()
    expect(screen.queryByText('Lien revoque')).not.toBeInTheDocument()
  })
})
