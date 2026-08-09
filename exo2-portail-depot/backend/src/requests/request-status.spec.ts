import { deriveStatus, isExpired, RequestStatus } from './request-status';

/**
 * What this suite protects: the two rules the exercise statement names --
 * expiry and completeness -- and the order between them. `now` being an
 * argument of the function, none of this needs a frozen clock.
 */
const EXPIRY = new Date('2026-08-23T12:00:00.000Z');
const before = new Date(EXPIRY.getTime() - 1);
const after = new Date(EXPIRY.getTime() + 1);

describe('isExpired', () => {
  // Asserted on its own, and not only through deriveStatus: resolving a public
  // link now depends on the same rule, and a boundary shifted by one
  // millisecond would refuse a link the dashboard still shows as pending.
  it('is false at the exact expiry instant', () => {
    expect(isExpired(EXPIRY, new Date(EXPIRY))).toBe(false);
  });

  it('is true one millisecond later', () => {
    expect(isExpired(EXPIRY, after)).toBe(true);
  });
});

describe('deriveStatus', () => {
  it('is still pending one millisecond before the deadline', () => {
    expect(
      deriveStatus(
        { expiresAt: EXPIRY, expectedCount: 3, receivedCount: 0 },
        before,
      ),
    ).toBe(RequestStatus.Pending);
  });

  // The boundary is what a refactor flips silently: at the exact instant the
  // link must still work, the comparison being strict.
  it('is still pending at the exact expiry instant', () => {
    expect(
      deriveStatus(
        { expiresAt: EXPIRY, expectedCount: 3, receivedCount: 0 },
        EXPIRY,
      ),
    ).toBe(RequestStatus.Pending);
  });

  it('is expired one millisecond after the deadline', () => {
    expect(
      deriveStatus(
        { expiresAt: EXPIRY, expectedCount: 3, receivedCount: 0 },
        after,
      ),
    ).toBe(RequestStatus.Expired);
  });

  it('stays pending while one expected piece is missing', () => {
    expect(
      deriveStatus(
        { expiresAt: EXPIRY, expectedCount: 3, receivedCount: 2 },
        before,
      ),
    ).toBe(RequestStatus.Pending);
  });

  it('turns complete once every expected piece is in', () => {
    expect(
      deriveStatus(
        { expiresAt: EXPIRY, expectedCount: 3, receivedCount: 3 },
        before,
      ),
    ).toBe(RequestStatus.Complete);
  });

  // Expiry wins, as recorded in A2. Whoever inverts the two branches breaks
  // this test rather than the lawyer's dashboard.
  it('reports expired rather than complete once the deadline has passed', () => {
    expect(
      deriveStatus(
        { expiresAt: EXPIRY, expectedCount: 3, receivedCount: 3 },
        after,
      ),
    ).toBe(RequestStatus.Expired);
  });

  // A row written by hand, or a future feature allowing an empty request:
  // "nothing expected" must not read as "everything received".
  it('never reports complete when nothing is expected', () => {
    expect(
      deriveStatus(
        { expiresAt: EXPIRY, expectedCount: 0, receivedCount: 0 },
        before,
      ),
    ).toBe(RequestStatus.Pending);
  });
});
