import { useCallback, useEffect, useRef, useState } from 'react'

/** `manual` is not an error: the value is on screen, it just was not copied. */
export type CopyFeedback = 'idle' | 'copied' | 'manual'

const CONFIRMATION_MS = 2000

/**
 * The clipboard, its refusal, and the confirmation that fades.
 *
 * It lives apart from CopyField because the PIN is copied from a button beside
 * four digit boxes, not from a text field -- two renderings, one behaviour. A
 * file exporting both the hook and the component would break fast refresh,
 * which the blocking lint reports.
 *
 * `onRefused` is what the field uses to select its text: a refused clipboard
 * must never look like a successful copy, since the PIN is shown exactly once.
 */
export const useCopy = (value: string, onRefused?: () => void) => {
  const [feedback, setFeedback] = useState<CopyFeedback>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const copy = useCallback(async () => {
    try {
      // No guard on navigator.clipboard: an insecure origin does not expose it
      // at all, and the TypeError that raises must land in the same "copy it by
      // hand" branch as a denied permission.
      await navigator.clipboard.writeText(value)
      setFeedback('copied')
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        setFeedback('idle')
      }, CONFIRMATION_MS)
    } catch {
      onRefused?.()
      setFeedback('manual')
    }
  }, [value, onRefused])

  return { feedback, copy }
}
