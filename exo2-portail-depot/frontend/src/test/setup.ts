import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Chakra v3 queries both when several components mount. jsdom implements
// neither: without these doubles, rendering throws before the first assertion.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Same reason one component further: without the observer, every <Reveal>
// throws on mount and takes the whole screen suite with it. Assigned rather
// than stubbed through vi.stubGlobal, because the afterEach below restores
// stubs and would drop it after the first test of a file.
globalThis.IntersectionObserver = class {
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds: readonly number[] = []
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
} as unknown as typeof IntersectionObserver

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn<() => void>(),
    removeEventListener: vi.fn<() => void>(),
    dispatchEvent: () => false,
  }),
})

// Testing Library does not unmount on its own when `globals` is off.
afterEach(cleanup)

// The clipboard and a reduced-motion matchMedia are stubbed PER TEST -- a test
// has to be able to simulate a refused clipboard -- so they are undone here.
// Without it, one test's refusing clipboard would still be installed for the
// next file's copy test, which would then pass or fail for the wrong reason.
afterEach(() => {
  vi.unstubAllGlobals()
})
