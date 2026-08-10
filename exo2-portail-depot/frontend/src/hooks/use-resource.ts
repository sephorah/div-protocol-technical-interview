import { useCallback, useEffect, useRef, useState } from 'react'

export type Resource<T> = {
  data: T | null
  error: unknown
  loading: boolean
  reload: () => Promise<void>
}

/**
 * Loading, error and data for one endpoint, plus the reload a mutation needs.
 *
 * Deliberately not TanStack Query: three screens, no shared cache, no
 * background refetch. What a library would buy here is 13 kB and a provider.
 *
 * `deps` is passed as an array rather than read from the closure, because the
 * loader is rebuilt on every render -- taking it as a dependency would refetch
 * forever.
 */
export const useResource = <T,>(load: () => Promise<T>, deps: unknown[]): Resource<T> => {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)

  // Monotonic, not a boolean: two calls can be in flight, and only the answer
  // to the LAST one may be written. A plain "is mounted" flag lets a slow
  // first page overwrite the second one.
  const generation = useRef(0)
  const loadRef = useRef(load)
  loadRef.current = load

  const run = useCallback(async () => {
    generation.current += 1
    const mine = generation.current
    setLoading(true)
    try {
      const result = await loadRef.current()
      if (generation.current !== mine) return
      setData(result)
      setError(null)
    } catch (caught) {
      if (generation.current !== mine) return
      setError(caught)
    } finally {
      if (generation.current === mine) setLoading(false)
    }
  }, [])

  // One serialised key rather than `...deps`: the caller's array is rebuilt on
  // every render, so passing it whole would refetch for ever, and spreading it
  // is refused by react-hooks(exhaustive-deps) ("complex expression in the
  // dependency array"), which the blocking lint turns into a failure. The
  // callers pass page numbers and ids, which JSON round-trips exactly.
  const key = JSON.stringify(deps)

  useEffect(() => {
    void run()
    return () => {
      // Bumping on unmount discards an answer nobody is waiting for.
      generation.current += 1
    }
  }, [run, key])

  return { data, error, loading, reload: run }
}
