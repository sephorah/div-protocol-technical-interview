import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { renderWithTheme } from '../test/render'
import { CopyField } from './copy-field'

const VALUE = 'https://portail/depot/8f3a2c1b'

const renderField = (value = VALUE) =>
  renderWithTheme(<CopyField label="Lien a envoyer au client" value={value} />)

// Object.create rather than a spread: navigator is a class instance, and
// spreading it drops its prototype -- along with everything userEvent reads
// off it.
const withClipboard = (clipboard: { writeText: (text: string) => Promise<void> } | undefined) => {
  vi.stubGlobal('navigator', Object.create(navigator, { clipboard: { value: clipboard } }))
}

describe('CopyField', () => {
  it('copies the value and confirms it', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    withClipboard({ writeText })
    renderField()

    await userEvent.click(screen.getByRole('button', { name: /copier/i }))

    expect(writeText).toHaveBeenCalledWith(VALUE)
    // Through the live region, not by text: the button says "Copie" too, and
    // what matters is that a screen reader is told the copy happened.
    expect(await screen.findByRole('status')).toHaveTextContent(/copie/i)
  })

  // A refused clipboard must not look like a successful copy: the PIN is shown
  // once, and a lawyer who believes it is copied loses it.
  it('tells the lawyer to copy by hand when the clipboard refuses', async () => {
    withClipboard({
      writeText: vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error('denied')),
    })
    renderField()

    await userEvent.click(screen.getByRole('button', { name: /copier/i }))

    expect(await screen.findByText(/ctrl\+c/i)).toBeInTheDocument()
  })

  // An insecure origin exposes no clipboard at all. The TypeError must take
  // the same exit as a denied permission, not crash the screen.
  it('falls back to copying by hand when there is no clipboard at all', async () => {
    withClipboard(undefined)
    renderField()

    await userEvent.click(screen.getByRole('button', { name: /copier/i }))

    expect(await screen.findByText(/ctrl\+c/i)).toBeInTheDocument()
  })

  it('shows the value in a read-only field, so it cannot be edited before copying', () => {
    renderField()
    const input = screen.getByLabelText('Lien a envoyer au client')
    expect(input).toHaveValue(VALUE)
    expect(input).toHaveAttribute('readonly')
  })
})
