import { Stack, chakra, useRecipe } from '@chakra-ui/react'
import { useRef } from 'react'
import type { ChangeEvent, KeyboardEvent } from 'react'

export const PIN_LENGTH = 4

const TEXT = {
  group: 'Code a 4 chiffres',
  digit: (position: number) => `Chiffre ${String(position)} sur ${String(PIN_LENGTH)}`,
}

const DIGITS_ONLY = /\D/g

/**
 * The four boxes the client types their code into.
 *
 * The same `pinDigit` recipe the lawyer's "LIEN GENERE" card displays, on an
 * input rather than a span: the code is handed over and typed back in, and two
 * drawings of one object is how the second ends up off-charter.
 *
 * Four inputs and not one field of length four, because that is what makes the
 * code readable digit by digit on a phone -- which is where this screen is
 * actually opened. The cost is the focus plumbing below, and one screen-reader
 * label per box.
 */
export const PinEntry = ({
  value,
  onChange,
  disabled = false,
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}) => {
  const recipe = useRecipe({ key: 'pinDigit' })
  const styles = recipe()
  const boxes = useRef<(HTMLInputElement | null)[]>([])

  const focus = (index: number) => {
    boxes.current[Math.min(Math.max(index, 0), PIN_LENGTH - 1)]?.focus()
  }

  const onDigitChange = (index: number) => (event: ChangeEvent<HTMLInputElement>) => {
    // The whole field, not the last character: a paste lands here as four
    // digits at once, and an autofilled one-time code as the entire value.
    const typed = event.target.value.replace(DIGITS_ONLY, '')
    const next = Array.from({ length: PIN_LENGTH }, (_, position) => value[position] ?? '')

    if (typed === '') {
      next[index] = ''
      onChange(next.join(''))
      return
    }

    Array.from(typed)
      .slice(0, PIN_LENGTH - index)
      .forEach((digit, offset) => {
        next[index + offset] = digit
      })

    onChange(next.join(''))
    focus(index + typed.length)
  }

  // Backspace on an empty box moves back instead of doing nothing, which is
  // what every code field does and what a client will expect.
  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace' && (value[index] ?? '') === '') focus(index - 1)
    if (event.key === 'ArrowLeft') focus(index - 1)
    if (event.key === 'ArrowRight') focus(index + 1)
  }

  return (
    <Stack direction="row" gap="8px" role="group" aria-label={TEXT.group}>
      {Array.from({ length: PIN_LENGTH }, (_, index) => (
        <chakra.input
          key={index}
          ref={(element: HTMLInputElement | null) => {
            boxes.current[index] = element
          }}
          css={styles}
          textAlign="center"
          // type="text" with inputMode: type="number" brings the spinner
          // arrows and lets a client type "e" or a minus sign into a PIN.
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={PIN_LENGTH}
          aria-label={TEXT.digit(index + 1)}
          disabled={disabled}
          value={value[index] ?? ''}
          onChange={onDigitChange(index)}
          onKeyDown={onKeyDown(index)}
        />
      ))}
    </Stack>
  )
}
