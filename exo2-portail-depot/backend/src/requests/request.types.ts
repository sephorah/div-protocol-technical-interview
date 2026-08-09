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

/**
 * The state of the LAST link issued, which survives its own revocation --
 * revoking dates revokedAt, it deletes nothing. Kept apart from the status
 * because the two are independent: a request can be complete AND cut off.
 */
export type LinkState = 'active' | 'revoked';

export interface LinkView {
  state: LinkState;
  expiresAt: Date;
}

export interface ReceivedFileView {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  /** The file's createdAt, renamed: what the lawyer reads is a receipt time. */
  receivedAt: Date;
}

export interface DetailedItemView {
  id: string;
  label: string;
  received: boolean;
  file: ReceivedFileView | null;
}

export interface RequestSummaryView {
  id: string;
  title: string;
  createdAt: Date;
  status: RequestStatus;
  expectedCount: number;
  receivedCount: number;
  link: LinkView;
}

export interface RequestDetailView extends RequestSummaryView {
  items: DetailedItemView[];
}

export interface RequestPageView {
  items: RequestSummaryView[];
  page: number;
  pageSize: number;
  total: number;
  /** 0 when the lawyer has no request yet, not 1: there is no page to show. */
  totalPages: number;
}

/** The columns of the last link the dashboard queries select, and no others. */
type LinkRow = { expiresAt: Date; revokedAt: Date | null };

/** Only the presence of a file matters to a count. */
type CountedItemRow = { file: unknown };

type SummaryRow = {
  id: string;
  title: string;
  createdAt: Date;
  items: CountedItemRow[];
  links: LinkRow[];
};

type DetailRow = Omit<SummaryRow, 'items'> & {
  items: {
    id: string;
    label: string;
    file: {
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      createdAt: Date;
    } | null;
  }[];
};

/**
 * A request ALWAYS has at least one link: creation writes both in one
 * transaction, revocation only dates revokedAt, and regeneration revokes then
 * inserts. An empty list is therefore a broken invariant -- rows deleted by
 * hand, or a future feature that deletes links -- and it belongs in the logs,
 * not in a 200 whose `link` is quietly null.
 */
const toLinkView = (links: LinkRow[], requestId: string): LinkView => {
  const [latest] = links;
  if (latest === undefined) {
    throw new Error(`La demande ${requestId} n'a aucun lien public.`);
  }
  return {
    state: latest.revokedAt === null ? 'active' : 'revoked',
    expiresAt: latest.expiresAt,
  };
};

const countReceived = (items: CountedItemRow[]): number =>
  items.filter((item) => item.file != null).length;

/** Field by field, for the same reason as toCreatedRequest above. */
export const toRequestSummary = (
  row: SummaryRow,
  now: Date,
): RequestSummaryView => {
  const link = toLinkView(row.links, row.id);
  const expectedCount = row.items.length;
  const receivedCount = countReceived(row.items);

  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    status: deriveStatus(
      {
        // The deadline of the LAST link, revoked or not: the status describes
        // the file, and `link` describes access to it.
        expiresAt: link.expiresAt,
        expectedCount,
        receivedCount,
      },
      now,
    ),
    expectedCount,
    receivedCount,
    link,
  };
};

/**
 * The one place a spread is allowed here: it extends an already-filtered view,
 * not a database row.
 */
export const toRequestDetail = (
  row: DetailRow,
  now: Date,
): RequestDetailView => ({
  ...toRequestSummary(row, now),
  items: row.items.map((item) => ({
    id: item.id,
    label: item.label,
    received: item.file !== null,
    file:
      item.file === null
        ? null
        : {
            originalName: item.file.originalName,
            mimeType: item.file.mimeType,
            sizeBytes: item.file.sizeBytes,
            receivedAt: item.file.createdAt,
          },
  })),
});
