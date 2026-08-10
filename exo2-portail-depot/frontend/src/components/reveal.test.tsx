import { act, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithTheme } from '../test/render'
import { Reveal } from './reveal'

describe('Reveal', () => {
  // The failure this guards is invisible content, which is worse than no
  // animation: a browser without IntersectionObserver, or a stubbed one that
  // never fires, must still show the list.
  it('shows its children when the observer never fires', () => {
    renderWithTheme(
      <Reveal>
        <p>Dossier Martin</p>
      </Reveal>,
    )
    expect(screen.getByText('Dossier Martin')).toBeVisible()
  })

  it('hides what the observer reports off-screen, then reveals it', () => {
    let fire: (entries: { isIntersecting: boolean }[]) => void = () => {}
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          fire = callback
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    )
    renderWithTheme(
      <Reveal>
        <p>Dossier Martin</p>
      </Reveal>,
    )

    act(() => {
      fire([{ isIntersecting: false }])
    })
    expect(screen.getByText('Dossier Martin')).not.toBeVisible()

    act(() => {
      fire([{ isIntersecting: true }])
    })
    expect(screen.getByText('Dossier Martin')).toBeVisible()
  })
})
