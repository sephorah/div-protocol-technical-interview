import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiDownload, apiRequest, filenameFromDisposition } from './client'

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

  // The client screen (C3) is anonymous: its 401 means the link is closed or
  // the code is wrong, never "the lawyer's access token expired". Renewing
  // there makes an anonymous visitor's browser call the lawyer's refresh route.
  it('never renews on the client routes', async () => {
    const fetchMock = vi.fn<FetchMock>().mockResolvedValue(jsonResponse({}, 401))
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiRequest('/public/abc/unlock', { method: 'POST' })).rejects.toBeInstanceOf(
      ApiError,
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // 400, 409, 413 and 415 are the statuses whose body our own API writes, in
  // French, for the person reading the screen. Rewriting the deposit limits
  // here would be a second copy of a rule the server owns.
  it.each([[413, 'Fichier trop volumineux (20 Mo maximum).']])(
    'quotes the API message of a %i',
    async (status, message) => {
      vi.stubGlobal(
        'fetch',
        vi.fn<FetchMock>().mockResolvedValue(jsonResponse({ message }, status)),
      )
      await expect(apiRequest('/public/files', { method: 'POST' })).rejects.toMatchObject({
        message,
      })
    },
  )

  // Nest answers a bare "Unauthorized" there. Quoted, it would replace a
  // deliberately neutral French message with an English technical one.
  it('keeps its own wording over the English default of a 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>().mockResolvedValue(jsonResponse({ message: 'Unauthorized' }, 401)),
    )
    await expect(apiRequest('/public/session')).rejects.toMatchObject({
      message: 'Identifiants refuses.',
    })
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

  // When the prefix drifts, nginx stops routing /api/ and the SPA's index.html
  // comes back with 200 text/html. Read as an empty answer, that would make the
  // session context announce an authenticated lawyer with no profile.
  it('refuses a 200 that is not JSON instead of reading it as an empty answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>().mockResolvedValue(
        new Response('<!doctype html><title>Portail</title>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    )
    await expect(apiRequest('/auth/me')).rejects.toMatchObject({ kind: 'notFound' })
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

describe('filenameFromDisposition', () => {
  it('reads the RFC 5987 name the backend sends', () => {
    expect(filenameFromDisposition("attachment; filename*=UTF-8''piece-valide.pdf")).toBe(
      'piece-valide.pdf',
    )
  })

  // The name comes from an anonymous client, so it carries whatever they typed.
  it('decodes the percent-encoding, or an accented name is saved mangled', () => {
    expect(
      filenameFromDisposition("attachment; filename*=UTF-8''pi%C3%A8ce%20d%27identit%C3%A9.pdf"),
    ).toBe("pièce d'identité.pdf")
  })

  // A header we cannot read must not throw in the middle of a download: the
  // lawyer gets a dull name rather than no file at all.
  it.each([
    ['absent', null],
    ['undecodable', "attachment; filename*=UTF-8''%E0%A4%A"],
    ['empty', "attachment; filename*=UTF-8''"],
  ])('falls back on a %s header', (_case, header) => {
    expect(filenameFromDisposition(header)).toBe('piece')
  })
})

// The body is a string, not a Blob: jsdom's Blob has no `stream()`, so passing
// one to Response throws before the test even reaches the code under test.
// `response.blob()` still hands back a real Blob, which is what is asserted.
const pdfResponse = (status = 200) =>
  new Response('%PDF-1.4', {
    status,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': "attachment; filename*=UTF-8''contrat.pdf",
    },
  })

describe('apiDownload', () => {
  it('returns the bytes and the name the server chose', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchMock>().mockResolvedValue(pdfResponse()))

    const { blob, filename } = await apiDownload('/requests/r1/items/i1/file')

    expect(filename).toBe('contrat.pdf')
    expect(await blob.text()).toBe('%PDF-1.4')
  })

  // THE reason this does not go through a plain <a href>: the access token
  // lives 15 minutes, and a lawyer who left the screen open would otherwise
  // save Nest's 401 body under the name of their client's contract.
  it('renews an expired session and replays, instead of downloading the refusal', async () => {
    const fetchMock = vi
      .fn<FetchMock>()
      .mockResolvedValueOnce(jsonResponse({}, 401))
      .mockResolvedValueOnce(jsonResponse({}, 200))
      .mockResolvedValueOnce(pdfResponse())
    vi.stubGlobal('fetch', fetchMock)

    await expect(apiDownload('/requests/r1/items/i1/file')).resolves.toMatchObject({
      filename: 'contrat.pdf',
    })
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/auth/refresh')
  })

  it('raises a typed error rather than handing a JSON body to the browser as a file', async () => {
    vi.stubGlobal('fetch', vi.fn<FetchMock>().mockResolvedValue(jsonResponse({}, 404)))

    await expect(apiDownload('/requests/r1/items/i1/file')).rejects.toMatchObject({
      kind: 'notFound',
    })
  })
})
