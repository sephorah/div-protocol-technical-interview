import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiRequest } from './client'

// Typed with its arguments, not just its return: the tests read back the URL
// and the init of each call, which an argument-less signature types as [].
type FetchMock = (url: string, init: RequestInit) => Promise<Response>

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apiRequest', () => {
  it('prefixes the path and sends cookies, the session being httpOnly', async () => {
    const fetchMock = vi.fn<FetchMock>().mockResolvedValue(jsonResponse({ id: '1' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiRequest('/auth/me')).resolves.toEqual({ id: '1' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/auth/me')
    expect(init.credentials).toBe('same-origin')
  })

  // The caller's headers used to overwrite the merged object wholesale, so a
  // POST sending content-type silently lost accept.
  it('keeps its own headers when the caller supplies some', async () => {
    const fetchMock = vi.fn<FetchMock>().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    await apiRequest('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers).toMatchObject({
      accept: 'application/json',
      'content-type': 'application/json',
    })
    expect(init.method).toBe('POST')
  })

  it('renews once on 401 and replays the original call', async () => {
    const fetchMock = vi
      .fn<FetchMock>()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({ id: '1' }))
      .mockResolvedValueOnce(jsonResponse({ id: '1' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiRequest('/auth/me')).resolves.toEqual({ id: '1' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/auth/refresh')
  })

  it('gives up after a refused renewal instead of looping', async () => {
    const fetchMock = vi
      .fn<FetchMock>()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({}, 401))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiRequest('/auth/me')).rejects.toMatchObject({ kind: 'unauthorized' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // A 401 there means "wrong password", not "expired token". Renewing after
  // one costs a wasted round trip on every failed sign-in.
  it('never renews after a refused login', async () => {
    const fetchMock = vi.fn<FetchMock>().mockResolvedValue(jsonResponse({}, 401))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      apiRequest('/auth/login', { method: 'POST', body: '{}' }),
    ).rejects.toMatchObject({ kind: 'unauthorized' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never renews on the refresh route itself', async () => {
    const fetchMock = vi.fn<FetchMock>().mockResolvedValue(jsonResponse({}, 401))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiRequest('/auth/refresh', { method: 'POST' })).rejects.toBeInstanceOf(
      ApiError,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a 404 as its own kind, because a misaligned prefix looks like an outage', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchMock>().mockResolvedValue(jsonResponse({}, 404)))
    await expect(apiRequest('/auth/me')).rejects.toMatchObject({ kind: 'notFound' })
  })

  it('turns a thrown fetch into a typed error rather than letting it escape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>().mockRejectedValue(new TypeError('failed to fetch')),
    )
    await expect(apiRequest('/auth/me')).rejects.toMatchObject({ kind: 'network' })
  })

  it('reports a 500 as a server error, not as refused credentials', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchMock>().mockResolvedValue(jsonResponse({}, 500)))
    await expect(apiRequest('/auth/me')).rejects.toMatchObject({ kind: 'server' })
  })

  // /auth/logout answers 204. Calling .json() on an empty body throws, and the
  // caller would read a successful logout as a failure.
  it('resolves on an empty 204 body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>().mockResolvedValue(new Response(null, { status: 204 })),
    )
    await expect(apiRequest('/auth/logout', { method: 'POST' })).resolves.toBeUndefined()
  })
})
