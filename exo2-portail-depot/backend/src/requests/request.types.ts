import { DepositRequest, RequestedItem } from '../generated/prisma/client';
import { deriveStatus, RequestStatus } from './request-status';

/**
 * An expected piece as the outside sees it. `received` rather than a status
 * column: a piece is received when a file hangs off it, and that is a join, not
 * a state to keep in sync.
 */
export interface RequestedItemView {
  id: string;
  label: string;
  received: boolean;
}

/**
 * The link, IN CLEAR.
 *
 * This shape exists at exactly two moments -- the creation response and the
 * regeneration response -- because the database only ever holds an argon2id of
 * the PIN and a SHA-256 of the token. Whatever the lawyer does not copy here is
 * lost, and a PIN nobody knows any more is repaired by REGENERATING the link,
 * never by displaying it again.
 *
 * `url` and not `token`: the raw token has no consumer of its own, and the
 * address is what gets copied into an email. One fewer place where a bearer
 * credential travels on its own.
 */
export interface IssuedLink {
  url: string;
  pin: string;
  expiresAt: Date;
}

export interface CreatedRequestView {
  id: string;
  title: string;
  createdAt: Date;
  status: RequestStatus;
  items: RequestedItemView[];
  link: IssuedLink;
}

/**
 * `file` is optional rather than required: the creation does not join it, and
 * B4 will. Absent means "not received", which is exactly true at creation.
 */
type ItemRow = RequestedItem & { file?: { id: string } | null };

const toItemView = (item: ItemRow): RequestedItemView => ({
  id: item.id,
  label: item.label,
  received: item.file != null,
});

/**
 * Field by field, never a spread: it is then the compiler, and not the author's
 * vigilance, that keeps pinHash and tokenHash out of a response when a column
 * is added later.
 */
export const toCreatedRequest = (
  request: DepositRequest & { items: ItemRow[] },
  link: IssuedLink,
  now: Date,
): CreatedRequestView => ({
  id: request.id,
  title: request.title,
  createdAt: request.createdAt,
  status: deriveStatus(
    {
      expiresAt: link.expiresAt,
      expectedCount: request.items.length,
      receivedCount: request.items.filter((item) => item.file != null).length,
    },
    now,
  ),
  items: request.items.map(toItemView),
  link,
});
