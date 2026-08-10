import { apiRequest } from './client'

// Mirrors backend/src/requests/request.types.ts. Nothing generates it, so a
// field renamed there has to be renamed here by hand -- the same contract as
// LawyerProfile in src/auth/session.ts. Dates arrive as ISO strings: JSON has
// no Date, and typing them as Date would lie to every caller.
export type RequestStatus = 'pending' | 'complete' | 'expired'
export type LinkState = 'active' | 'revoked'

/**
 * The state of the LAST link, which survives its own revocation. It is kept
 * beside the status and not folded into it: the two are independent, and a
 * request can be complete AND cut off.
 */
export type LinkView = { state: LinkState; expiresAt: string }

export type RequestSummary = {
  id: string
  title: string
  createdAt: string
  status: RequestStatus
  expectedCount: number
  receivedCount: number
  link: LinkView
}

export type RequestPage = {
  items: RequestSummary[]
  page: number
  pageSize: number
  total: number
  /** 0 when the lawyer has no request yet, not 1: there is no page to show. */
  totalPages: number
}

export type ReceivedFile = {
  originalName: string
  mimeType: string
  sizeBytes: number
  receivedAt: string
}

export type DetailedItem = {
  id: string
  label: string
  received: boolean
  file: ReceivedFile | null
}

export type RequestDetail = RequestSummary & { items: DetailedItem[] }

/**
 * The link IN CLEAR. It exists at exactly two moments -- the creation response
 * and the regeneration response -- because the database holds a SHA-256 of the
 * token and an argon2id of the PIN. Whatever the lawyer does not copy here is
 * gone: a lost PIN is not redisplayed, it is REPLACED by regenerating.
 */
export type IssuedLink = { url: string; pin: string; expiresAt: string }

export type CreatedRequest = {
  id: string
  title: string
  createdAt: string
  status: RequestStatus
  items: { id: string; label: string; received: boolean }[]
  link: IssuedLink
}

export type CreateRequestBody = {
  title: string
  items: string[]
  expiresInDays: number
}

export const listRequests = (page: number): Promise<RequestPage> =>
  apiRequest<RequestPage>(`/requests?page=${String(page)}`)

export const getRequest = (id: string): Promise<RequestDetail> =>
  apiRequest<RequestDetail>(`/requests/${encodeURIComponent(id)}`)

const jsonBody = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const createRequest = (body: CreateRequestBody): Promise<CreatedRequest> =>
  apiRequest<CreatedRequest>('/requests', jsonBody(body))

export const regenerateLink = (id: string, expiresInDays: number): Promise<IssuedLink> =>
  apiRequest<IssuedLink>(`/requests/${encodeURIComponent(id)}/link`, jsonBody({ expiresInDays }))

// 204, so apiRequest resolves to undefined rather than parsing an empty body.
export const revokeLink = (id: string): Promise<void> =>
  apiRequest<void>(`/requests/${encodeURIComponent(id)}/link`, { method: 'DELETE' })
