// The browser cannot read .env, so the prefix has to be written somewhere.
// This is the fourth place /api/v1 is frozen, alongside .env,
// infra/nginx/portal-locations.conf and the healthcheck in docker-compose.yml.
// A VITE_API_PREFIX would be baked into the image at build time in CI:
// configurable in appearance only.
export const API_PREFIX = '/api/v1'

const REFRESH_PATH = '/auth/refresh'

// Routes whose 401 means "wrong credentials", not "expired token". Renewing
// after one is a wasted round trip on every failed login -- observed in the
// browser: a refused sign-in fired /auth/login then /auth/refresh.
const NEVER_RENEWED: readonly string[] = [REFRESH_PATH, '/auth/login']

// The client side of the portal (C1/C3) has no lawyer session at all: its 401
// means the link is closed or the PIN is wrong. Renewing there would make an
// anonymous visitor's browser call the lawyer's refresh route on every refusal.
const CLIENT_PREFIX = '/public/'

const isNeverRenewed = (path: string): boolean =>
  NEVER_RENEWED.includes(path) || path.startsWith(CLIENT_PREFIX)

export type ApiErrorKind =
  | 'unauthorized'
  | 'notFound'
  | 'badRequest'
  | 'server'
  | 'network'

// The field is assigned in the body, not declared in the constructor
// signature: erasableSyntaxOnly forbids parameter properties.
export class ApiError extends Error {
  kind: ApiErrorKind

  constructor(kind: ApiErrorKind, message: string) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
  }
}

const kindForStatus = (status: number): ApiErrorKind => {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 404) return 'notFound'
  if (status < 500) return 'badRequest'
  return 'server'
}

const messageForKind = (kind: ApiErrorKind): string => {
  if (kind === 'unauthorized') return 'Identifiants refuses.'
  if (kind === 'notFound') return 'API introuvable.'
  if (kind === 'network') return 'Serveur injoignable.'
  return 'Une erreur est survenue.'
}

// Merged through Headers rather than by spreading: HeadersInit is also a
// Headers instance or an array of pairs, and spreading either of those into an
// object yields indices instead of header names.
const withAccept = (headers: HeadersInit | undefined): Record<string, string> => {
  const merged = new Headers(headers)
  if (!merged.has('accept')) merged.set('accept', 'application/json')
  return Object.fromEntries(merged.entries())
}

/**
 * The statuses whose body OUR code writes, in French, for the person reading
 * the screen. Everything else keeps our own wording: a 401/404/500 body is
 * Nest's English default ("Unauthorized", "Internal server error"), which would
 * replace a deliberately neutral French message with a technical one.
 *
 * 413 and 415 are the deposit's two refusals (C2, upload.constants.ts) --
 * "Fichier trop volumineux (20 Mo maximum)." and "Format refuse. PDF, JPG ou
 * PNG uniquement." Rewriting them here would be a second copy of a limit the
 * server owns, free to drift the day it changes.
 */
const QUOTED_STATUSES: readonly number[] = [400, 409, 413, 415]

/**
 * What the API said about a refused body, or null when it said nothing usable.
 *
 * class-validator answers `message` as a string OR an array of strings, one per
 * broken rule; rendering the array raw prints "a,b", so it is joined.
 */
const quotedMessage = (contentType: string, raw: string): string | null => {
  if (!contentType.includes('json')) return null
  try {
    const body: unknown = JSON.parse(raw)
    if (typeof body !== 'object' || body === null) return null
    const { message } = body as { message?: unknown }
    if (typeof message === 'string' && message !== '') return message
    if (Array.isArray(message)) {
      const lines = message.filter((entry): entry is string => typeof entry === 'string')
      if (lines.length > 0) return lines.join(' ')
    }
    return null
  } catch {
    // A body announced as JSON that does not parse is not a message.
    return null
  }
}

/**
 * The error a refused answer becomes, from its raw parts rather than from a
 * Response: the deposit goes through XMLHttpRequest (see api/upload.ts), which
 * has no Response object, and two mappings of the same statuses would drift.
 */
export const apiErrorFor = (status: number, contentType: string, raw: string): ApiError => {
  const kind = kindForStatus(status)
  const quoted = QUOTED_STATUSES.includes(status) ? quotedMessage(contentType, raw) : null
  return new ApiError(kind, quoted ?? messageForKind(kind))
}

export const networkError = (): ApiError => new ApiError('network', messageForKind('network'))

const send = async (path: string, init: RequestInit): Promise<Response> => {
  try {
    return await fetch(`${API_PREFIX}${path}`, {
      ...init,
      // Both session cookies are httpOnly: the browser attaches them, the
      // code never sees them.
      credentials: 'same-origin',
      headers: withAccept(init.headers),
    })
  } catch {
    throw networkError()
  }
}

// 204 resolves to undefined: calling .json() on an empty body throws, and a
// successful logout would read as a failure.
//
// A 200 that is NOT JSON is an error, not an empty answer. When the prefix
// drifts, nginx stops routing /api/ and the SPA's own index.html comes back
// with 200 text/html; returning undefined there would make SessionProvider
// announce an authenticated lawyer with no profile behind them.
const parse = async <T>(response: Response): Promise<T> => {
  if (response.status === 204) return undefined as T
  if (!(response.headers.get('content-type') ?? '').includes('json')) {
    throw new ApiError('notFound', messageForKind('notFound'))
  }
  return (await response.json()) as T
}

export const apiRequest = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  let response = await send(path, init)

  // The access token lives 15 minutes. One renewal, one replay: without that
  // bound, a refused renewal would loop.
  if (response.status === 401 && !isNeverRenewed(path)) {
    const renewed = await send(REFRESH_PATH, { method: 'POST' })
    if (renewed.ok) {
      response = await send(path, init)
    }
  }

  if (!response.ok) {
    // The body is read here because this is the last place that still holds the
    // response. A screen showing "Une erreur est survenue" over "Deux pieces
    // portent le meme libelle" would hide the one sentence that says what to
    // change. `.text()` and not `.json()`: a body that is not JSON must not
    // throw over the error it is describing.
    const raw = await response.text().catch(() => '')
    throw apiErrorFor(response.status, response.headers.get('content-type') ?? '', raw)
  }

  return parse<T>(response)
}
