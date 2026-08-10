/**
 * What an ANONYMOUS caller receives once the PIN is right.
 *
 * Deliberately not a Pick<> of the Prisma rows: the shape is written out so
 * that a column added to DepositRequest later cannot join the response by
 * accident. What it must never carry is the lawyer's identity, their other
 * requests, the request's creation date, and the linkId -- the client sees
 * their own file, and nothing that describes the practice behind it.
 */
export interface PublicItemView {
  id: string;
  label: string;
  received: boolean;
}

export interface PublicRequestView {
  requestId: string;
  title: string;
  expiresAt: Date;
  items: PublicItemView[];
}
