import { apiRequest } from './client'
import { postWithProgress } from './upload'

/**
 * Mirrors backend/src/public/public.types.ts. Nothing generates it, so a field
 * renamed there has to be renamed here by hand -- the same contract as
 * RequestSummary in api/requests.ts. What it deliberately does NOT carry is the
 * lawyer, their other requests, or the link id: the client sees their own
 * dossier and nothing that describes the practice behind it.
 */
export type PublicItemView = { id: string; label: string; received: boolean }

export type PublicRequestView = {
  requestId: string
  title: string
  /** ISO string: JSON has no Date, and typing it as one would lie to callers. */
  expiresAt: string
  items: PublicItemView[]
}

/** The receipt for one deposited file, echoed with the piece it belongs to. */
export type DepositedFileView = {
  itemId: string
  originalName: string
  mimeType: string
  sizeBytes: number
  receivedAt: string
}

/** What the file picker offers. The server decides on the bytes, not on this. */
export const ACCEPTED_TYPES = 'application/pdf,image/jpeg,image/png'

export const unlockDeposit = (token: string, pin: string): Promise<PublicRequestView> =>
  apiRequest<PublicRequestView>(`/public/${encodeURIComponent(token)}/unlock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin }),
  })

/**
 * The one call that says whether the deposit is still open. The client session
 * cookie is httpOnly, so the page cannot look for itself -- and the guard
 * re-reads the link, so a revocation lands here as a 401.
 */
export const getDepositSession = (): Promise<PublicRequestView> =>
  apiRequest<PublicRequestView>('/public/session')

export const depositFile = (
  itemId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<DepositedFileView> => {
  const body = new FormData()
  // The text field before the file: multipart consumers read the parts in
  // order, and a field trailing the payload is the classic reason a server
  // sees an empty body next to a perfectly received file.
  body.append('itemId', itemId)
  body.append('file', file, file.name)
  return postWithProgress<DepositedFileView>('/public/files', body, onProgress)
}
