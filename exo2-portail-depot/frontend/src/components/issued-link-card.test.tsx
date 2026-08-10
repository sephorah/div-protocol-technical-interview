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
