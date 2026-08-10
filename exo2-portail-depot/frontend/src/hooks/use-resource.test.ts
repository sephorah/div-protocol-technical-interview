import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useResource } from './use-resource'

describe('useResource', () => {
  it('goes from loading to data', async () => {
    const { result } = renderHook(() => useResource(() => Promise.resolve('ok'), []))

    expect(result.current.loading).toBe(true)
    await waitFor(() => {
      expect(result.current.data).toBe('ok')
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('exposes the rejection instead of throwing it at the screen', async () => {
    const boom = new Error('boom')
    const { result } = renderHook(() => useResource(() => Promise.reject(boom), []))

    await waitFor(() => {
      expect(result.current.error).toBe(boom)
    })
    expect(result.current.loading).toBe(false)
  })

  it('reloads on demand, which is what a mutation calls', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second')
    const { result } = renderHook(() => useResource(load, []))
    await waitFor(() => {
      expect(result.current.data).toBe('first')
    })

    await act(async () => {
      await result.current.reload()
    })

    expect(result.current.data).toBe('second')
  })

  // A retry after a failure must clear the panel it retried from, or the error
  // stays under the data it just replaced and the lawyer reads a live list
  // topped by "Reessayer".
  it('clears a previous error once the retry succeeds', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('recovered')
    const { result } = renderHook(() => useResource(load, []))
    await waitFor(() => {
      expect(result.current.error).not.toBeNull()
    })

    await act(async () => {
      await result.current.reload()
    })

    expect(result.current.data).toBe('recovered')
    expect(result.current.error).toBeNull()
  })

  // The real failure this guards: the lawyer clicks page 2 while page 1 is
  // still in flight. Page 1 answers last and overwrites page 2 -- the list
  // then contradicts the "Page 2 sur 3" printed beside it.
  it('ignores an answer that a newer call has superseded', async () => {
    let releaseFirst: (value: string) => void = () => {}
    const load = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            releaseFirst = resolve
          }),
      )
      .mockResolvedValueOnce('page 2')

    const { result, rerender } = renderHook(({ page }) => useResource(load, [page]), {
      initialProps: { page: 1 },
    })

    rerender({ page: 2 })
    await waitFor(() => {
      expect(result.current.data).toBe('page 2')
    })

    await act(async () => {
      releaseFirst('page 1')
    })

    expect(result.current.data).toBe('page 2')
  })
})
