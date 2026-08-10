import { UploadStatus } from '../generated/prisma/client';
import { RequestStatus } from './request-status';
import { toRequestDetail, toRequestSummary } from './request.types';

const NOW = new Date('2026-08-09T12:00:00.000Z');
const LATER = new Date('2026-09-09T12:00:00.000Z');
const EARLIER = new Date('2026-07-09T12:00:00.000Z');

const summaryRow = {
  id: 'req-1',
  title: 'Dossier Martin',
  createdAt: EARLIER,
  items: [{ file: { status: UploadStatus.complete } }, { file: null }],
  links: [{ expiresAt: LATER, revokedAt: null }],
};

describe('toRequestSummary', () => {
  it('counts the expected pieces and the ones actually received', () => {
    const view = toRequestSummary(summaryRow, NOW);

    expect(view.expectedCount).toBe(2);
    expect(view.receivedCount).toBe(1);
    expect(view.status).toBe(RequestStatus.Pending);
  });

  // The lawyer cut the link himself. That is a decision, not a deadline, so the
  // status must keep describing the FILE (still incomplete) while `link` says
  // nobody can deposit any more. Collapsing the two loses one of them.
  it('keeps a three-valued status when the link was revoked', () => {
    const view = toRequestSummary(
      { ...summaryRow, links: [{ expiresAt: LATER, revokedAt: NOW }] },
      NOW,
    );

    expect(view.status).toBe(RequestStatus.Pending);
    expect(view.link).toEqual({ state: 'revoked', expiresAt: LATER });
  });

  // Unreachable through the API. It must be loud rather than served as a
  // normal-looking request with no link: that would hide a corrupted database
  // behind a 200.
  it('refuses to describe a request whose links vanished', () => {
    expect(() => toRequestSummary({ ...summaryRow, links: [] }, NOW)).toThrow(
      /no public link/i,
    );
  });

  // C2's decision, and the reason `received` stopped meaning "a file hangs off
  // the piece": counted as received, a rejected file shows the request as
  // COMPLETE while the lawyer is still missing that piece.
  it('leaves a request pending when its only file failed', () => {
    const view = toRequestSummary(
      {
        ...summaryRow,
        items: [{ file: { status: UploadStatus.failed } }],
      },
      NOW,
    );

    expect(view.receivedCount).toBe(0);
    expect(view.status).toBe(RequestStatus.Pending);
  });

  it('does not count a file still pending either', () => {
    const view = toRequestSummary(
      {
        ...summaryRow,
        items: [{ file: { status: UploadStatus.pending } }],
      },
      NOW,
    );

    expect(view.receivedCount).toBe(0);
  });
});

describe('toRequestDetail', () => {
  it('describes each piece, received or not', () => {
    const view = toRequestDetail(
      {
        ...summaryRow,
        items: [
          {
            id: 'item-1',
            label: 'Bail',
            file: {
              originalName: 'bail.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 184320,
              status: UploadStatus.complete,
              createdAt: NOW,
            },
          },
          { id: 'item-2', label: "Piece d'identite", file: null },
        ],
      },
      NOW,
    );

    expect(view.items).toEqual([
      {
        id: 'item-1',
        label: 'Bail',
        received: true,
        file: {
          originalName: 'bail.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 184320,
          receivedAt: NOW,
        },
      },
      { id: 'item-2', label: "Piece d'identite", received: false, file: null },
    ]);
    expect(view.receivedCount).toBe(1);
  });

  // The file stays described so the lawyer can see WHAT was refused, but the
  // piece is not ticked. Dropping the description would leave an empty line
  // with no explanation.
  it('still describes a failed file, without calling the piece received', () => {
    const view = toRequestDetail(
      {
        ...summaryRow,
        items: [
          {
            id: 'item-1',
            label: 'Bail',
            file: {
              originalName: 'bail.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 184320,
              status: UploadStatus.failed,
              createdAt: NOW,
            },
          },
        ],
      },
      NOW,
    );

    expect(view.items[0].received).toBe(false);
    expect(view.items[0].file?.originalName).toBe('bail.pdf');
    expect(view.receivedCount).toBe(0);
  });
});
