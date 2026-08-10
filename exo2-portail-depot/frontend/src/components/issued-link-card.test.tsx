import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { IssuedLink } from '../api/requests'
import { renderWithTheme } from '../test/render'
import { IssuedLinkCard } from './issued-link-card'

const link: IssuedLink = {
  url: 'https://portail/depot/8f3a2c1b',
  pin: '4207',
  expiresAt: '2026-04-14T10:00:00.000Z',
}

describe('IssuedLinkCard', () => {
  it('shows the link, the four PIN digits and the expiry date', () => {
    renderWithTheme(<IssuedLinkCard link={link} />)

    expect(screen.getByLabelText(/lien a envoyer/i)).toHaveValue(link.url)
    for (const digit of ['4', '2', '0', '7']) {
      expect(screen.getAllByText(digit).length).toBeGreaterThan(0)
    }
    expect(screen.getByText(/14 avril 2026/)).toBeInTheDocument()
  })

  // The PIN exists in clear exactly once. A lawyer who closes this card without
  // reading that has to regenerate the link, which invalidates the one already
  // sent -- so the warning is part of the component, not of the page.
  it('warns that the code is shown once and cannot be redisplayed', () => {
    renderWithTheme(<IssuedLinkCard link={link} />)
    expect(screen.getByText(/qu'une fois/i)).toBeInTheDocument()
    expect(screen.getByText(/regenerer/i)).toBeInTheDocument()
  })

  it('copies the PIN on its own, without the link around it', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    // Object.create, not a spread: navigator is a class instance and a spread
    // drops its prototype.
    vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: { writeText } } }))
    renderWithTheme(<IssuedLinkCard link={link} />)

    await userEvent.click(screen.getByRole('button', { name: /copier le code/i }))

    expect(writeText).toHaveBeenCalledWith('4207')
  })

  it('offers the way on only when the screen gives it one', async () => {
    const onDone = vi.fn<() => void>()
    const { unmount } = renderWithTheme(<IssuedLinkCard link={link} onDone={onDone} doneLabel="Terminer" />)
    await userEvent.click(screen.getByRole('button', { name: 'Terminer' }))
    expect(onDone).toHaveBeenCalledTimes(1)

    unmount()
    renderWithTheme(<IssuedLinkCard link={link} />)
    expect(screen.queryByRole('button', { name: 'Terminer' })).not.toBeInTheDocument()
  })
})
