import { Box } from '@chakra-ui/react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'

// Fires a little before the element reaches the fold, so the card is already
// settled when the eye gets there.
const ROOT_MARGIN = '0px 0px -10% 0px'

const prefersReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia(REDUCED_MOTION).matches

export const Reveal = ({ children, delay = 0 }: { children: ReactNode; delay?: number }) => {
  // The default is VISIBLE, and the state only ever goes to false when the
  // observer is actually going to run. Defaulting to hidden means a browser
  // without IntersectionObserver shows a blank page for ever.
  const [shown, setShown] = useState(true)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = ref.current
    if (node === null) return
    if (prefersReducedMotion() || typeof IntersectionObserver !== 'function') return

    const observer = new IntersectionObserver(
      (entries) => {
        // Hidden only once the observer has SAID the element is off-screen,
        // never at observe() time. An observer that never fires -- a browser
        // bug, a polyfill, the noop double in the test suite -- would
        // otherwise leave the page blank for ever, which is far worse than
        // losing an animation. Hiding something already reported off-screen
        // cannot flash: nobody is looking at it.
        if (entries.some((entry) => entry.isIntersecting)) {
          // Once revealed, never hidden again: re-hiding on scroll-up makes
          // the page flicker on every direction change.
          setShown(true)
          observer.disconnect()
          return
        }
        setShown(false)
      },
      { rootMargin: ROOT_MARGIN },
    )
    observer.observe(node)
    return () => {
      observer.disconnect()
    }
  }, [])

  return (
    <Box
      ref={ref}
      opacity={shown ? 1 : 0}
      transform={shown ? 'translateY(0)' : 'translateY(12px)'}
      transitionProperty="opacity, transform"
      transitionDuration="320ms"
      transitionTimingFunction="ease-out"
      transitionDelay={`${String(delay)}ms`}
    >
      {children}
    </Box>
  )
}
