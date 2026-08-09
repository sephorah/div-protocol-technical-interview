/**
 * The three statuses of a deposit request, DERIVED and never stored: "expired"
 * depends on the wall clock, so a column would stay wrong from the expiry
 * instant until some job flips it, and the dashboard would lie. Same reasoning
 * for "how many pieces are expected", which is a count of RequestedItem.
 */
export enum RequestStatus {
  Pending = 'pending',
  Complete = 'complete',
  Expired = 'expired',
}

export interface StatusInput {
  expiresAt: Date;
  expectedCount: number;
  receivedCount: number;
}

/**
 * The single definition of "past its deadline", shared by the dashboard's
 * status and by the resolution of a public link.
 *
 * Strictly greater: at the exact expiry instant the link still works.
 * Duplicated, the two callers could drift by a millisecond -- a link refused
 * while the request still reads "pending" -- and nothing would report it.
 */
export const isExpired = (expiresAt: Date, now: Date): boolean =>
  now.getTime() > expiresAt.getTime();

/**
 * `now` is an argument, not a reading taken inside: the expiry tests then need
 * no frozen clock, and a dashboard listing twenty requests classifies them all
 * against a single instant instead of twenty slightly different ones.
 */
export const deriveStatus = (input: StatusInput, now: Date): RequestStatus => {
  if (isExpired(input.expiresAt, now)) {
    return RequestStatus.Expired;
  }

  // The count guard is not decoration: without it a request expecting nothing
  // would report "complete" the moment it is created.
  if (input.expectedCount > 0 && input.receivedCount >= input.expectedCount) {
    return RequestStatus.Complete;
  }

  return RequestStatus.Pending;
};
