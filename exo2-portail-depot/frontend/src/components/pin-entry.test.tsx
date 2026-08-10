import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { renderWithTheme } from '../test/render'
import { PinEntry } from './pin-entry'

// Controlled by a host, like the screen does: driving it with a fixed value
// would test a component that can never change.
const Host = () => {
  const [pin, setPin] = useState('')
  return (
    <>
      <PinEntry value={pin} onChange={setPin} />
      <p>{`saisi:${pin}`}</p>
    </>
  )
}

const boxes = () => screen.getAllByRole('textbox')

describe('PinEntry', () => {
  it('moves to the next box as each digit is typed', async () => {
    const user = userEvent.setup()
    renderWithTheme(<Host />)

    await user.click(boxes()[0])
    await user.keyboard('4207')

    expect(screen.getByText('saisi:4207')).toBeInTheDocument()
    expect(boxes()[3]).toHaveFocus()
  })

  // A client copying the code out of the e-mail pastes four digits into the
  // first box. Kept to that box, three of them would be dropped in silence.
  it('spreads a pasted code over the four boxes', async () => {
    const user = userEvent.setup()
    renderWithTheme(<Host />)

    await user.click(boxes()[0])
    await user.paste('1234')

    expect(screen.getByText('saisi:1234')).toBeInTheDocument()
  })

  it('ignores anything that is not a digit', async () => {
    const user = userEvent.setup()
    renderWithTheme(<Host />)

    await user.click(boxes()[0])
    await user.keyboard('1a2')

    expect(screen.getByText('saisi:12')).toBeInTheDocument()
  })

  // Backspace on an empty box doing nothing is how a correction turns into
  // four taps instead of one.
  it('steps back on backspace when the box is already empty', async () => {
    const user = userEvent.setup()
    renderWithTheme(<Host />)

    await user.click(boxes()[0])
    await user.keyboard('12')
    // The caret sits on the empty third box: the first backspace only walks
    // back to the last digit, the second erases it.
    await user.keyboard('{Backspace}')
    expect(screen.getByText('saisi:12')).toBeInTheDocument()
    expect(boxes()[1]).toHaveFocus()

    await user.keyboard('{Backspace}')
    expect(screen.getByText('saisi:1')).toBeInTheDocument()
  })

  // Four boxes are announced as four unrelated characters without a name each.
  it('names every box for a screen reader', () => {
    renderWithTheme(<Host />)
    expect(screen.getByLabelText('Chiffre 1 sur 4')).toBeInTheDocument()
    expect(screen.getByLabelText('Chiffre 4 sur 4')).toBeInTheDocument()
  })
})
