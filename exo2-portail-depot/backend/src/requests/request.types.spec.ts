import { RequestStatus } from './request-status';
import { toRequestDetail, toRequestSummary } from './request.types';

const NOW = new Date('2026-08-09T12:00:00.000Z');
const LATER = new Date('2026-09-09T12:00:00.000Z');
const EARLIER = new Date('2026-07-09T12:00:00.000Z');

const summaryRow = {
  id: 'req-1',
  title: 'Dossier Martin',
  createdAt: EARLIER,
  items: [{ file: { id: 'file-1' } }, { file: null }],
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

  it('reports an expired request from the last link deadline', () => {
    const view = toRequestSummary(
      { ...summaryRow, links: [{ expiresAt: EARLIER, revokedAt: null }] },
      NOW,
    );

    expect(view.status).toBe(RequestStatus.Expired);
  });

  // Unreachable through the API. It must be loud rather than served as a
  // normal-looking request with no link: that would hide a corrupted database
  // behind a 200.
  it('refuses to describe a request whose links vanished', () => {
    expect(() => toRequestSummary({ ...summaryRow, links: [] }, NOW)).toThrow(
      /no public link/i,
    );
  });

  it('exposes those fields and no others', () => {
    expect(Object.keys(toRequestSummary(summaryRow, NOW))).toEqual([
      'id',
      'title',
      'createdAt',
      'status',
      'expectedCount',
      'receivedCount',
      'link',
    ]);
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
});
