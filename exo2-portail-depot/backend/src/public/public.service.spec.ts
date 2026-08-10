/**
 * What this suite protects: the unlock path is the portal's only anonymous
 * write-adjacent surface, and its whole security argument is that it answers
 * the same thing to everyone. Both properties below are invisible in a green
 * end-to-end run -- a route that leaks WHICH refusal happened still returns
 * 401, and a route that skips the hash still returns 401 faster.
 */

import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as secrets from '../crypto/secrets';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  LinkResolution,
  PublicLinksService,
} from '../requests/public-links.service';
import { PublicService } from './public.service';

const PIN = '1234';

const REQUEST_ID = 'request-1';

const EXPIRES_AT = new Date('2026-12-31T00:00:00.000Z');

describe('PublicService', () => {
  let service: PublicService;
  let links: { resolve: jest.Mock };
  let prisma: { depositRequest: { findUnique: jest.Mock } };
  let metrics: { recordUnlock: jest.Mock; recordExpiredLinkHit: jest.Mock };
  let okResolution: LinkResolution;

  beforeAll(async () => {
    okResolution = {
      outcome: 'ok',
      link: {
        id: 'link-1',
        // A real argon2id hash, not a fixture string: the point of the suite is
        // that the verification actually runs.
        pinHash: await secrets.hashSecret(PIN),
        expiresAt: EXPIRES_AT,
      },
      request: {
        id: REQUEST_ID,
        title: 'Dossier Martin, pieces 2026',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lawyerId: 'lawyer-1',
      },
    };
  });

  beforeEach(async () => {
    links = { resolve: jest.fn() };
    prisma = {
      depositRequest: {
        findUnique: jest.fn().mockResolvedValue({
          id: REQUEST_ID,
          title: 'Dossier Martin, pieces 2026',
          items: [{ id: 'item-1', label: "Piece d'identite", file: null }],
        }),
      },
    };

    metrics = { recordUnlock: jest.fn(), recordExpiredLinkHit: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        PublicService,
        { provide: PublicLinksService, useValue: links },
        { provide: PrismaService, useValue: prisma },
        { provide: MetricsService, useValue: metrics },
      ],
    }).compile();

    service = moduleRef.get(PublicService);
    await service.onModuleInit();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('unlock', () => {
    const refusals: LinkResolution[] = [
      { outcome: 'unknown' },
      { outcome: 'revoked' },
      { outcome: 'expired' },
    ];

    // The real failure scenario: an answer that differs from one case to the
    // next lets an anonymous caller tell a non-existent link from an expired
    // one, hence enumerate the practice's live links.
    it.each(refusals)(
      'answers the same 401 for %o as for a wrong pin',
      async (resolution) => {
        links.resolve.mockResolvedValue(resolution);
        const refused = await service
          .unlock('token', PIN, new Date())
          .catch((error: unknown) => error);

        links.resolve.mockResolvedValue(okResolution);
        const wrongPin = await service
          .unlock('token', '9999', new Date())
          .catch((error: unknown) => error);

        expect(refused).toBeInstanceOf(UnauthorizedException);
        expect((refused as UnauthorizedException).getResponse()).toEqual(
          (wrongPin as UnauthorizedException).getResponse(),
        );
      },
    );

    // The clock is an oracle too: skipping argon2id when the link cannot be
    // opened answers in ~1 ms where a wrong PIN costs ~67 ms, and the gap gives
    // back exactly the distinction the single message just removed.
    it('still verifies the pin against a decoy hash when the link is unknown', async () => {
      const verify = jest.spyOn(secrets, 'verifySecret');
      links.resolve.mockResolvedValue({ outcome: 'unknown' });

      await expect(service.unlock('token', PIN, new Date())).rejects.toThrow(
        UnauthorizedException,
      );

      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify).toHaveBeenCalledWith(
        PIN,
        expect.stringContaining('$argon2id$'),
      );
    });

    it('opens the link and returns the client view on the right pin', async () => {
      links.resolve.mockResolvedValue(okResolution);

      await expect(service.unlock('token', PIN, new Date())).resolves.toEqual({
        linkId: 'link-1',
        view: {
          requestId: REQUEST_ID,
          title: 'Dossier Martin, pieces 2026',
          expiresAt: EXPIRES_AT,
          items: [{ id: 'item-1', label: "Piece d'identite", received: false }],
        },
      });
    });

    // The lawyer's identity is the one field the anonymous client must never
    // receive: resolve() hands over the whole DepositRequest row, so passing it
    // through untouched would publish lawyerId to whoever knows a PIN.
    it('never carries the lawyer or the link identifier into the view', async () => {
      links.resolve.mockResolvedValue(okResolution);

      const unlocked = await service.unlock('token', PIN, new Date());

      expect(Object.keys(unlocked.view)).toEqual([
        'requestId',
        'title',
        'expiresAt',
        'items',
      ]);
    });
  });

  /**
   * What this block protects: the brute-force alert reads
   * portail_unlock_attempts_total{outcome="failure"}, and it is the ONLY thing
   * standing in for the rate limiting of G1. A refusal that forgets to count
   * itself makes an attacker walking the 10 000 PINs of a revoked link
   * invisible, while the dashboard stays green.
   */
  describe('the counters', () => {
    const refusals: LinkResolution[] = [
      { outcome: 'unknown' },
      { outcome: 'revoked' },
      { outcome: 'expired' },
    ];

    it.each(refusals)('counts %o as a failed unlock', async (resolution) => {
      links.resolve.mockResolvedValue(resolution);

      await expect(service.unlock('token', PIN, new Date())).rejects.toThrow(
        UnauthorizedException,
      );

      expect(metrics.recordUnlock.mock.calls).toEqual([['failure']]);
    });

    it('counts a wrong pin on a valid link as a failed unlock', async () => {
      links.resolve.mockResolvedValue(okResolution);

      await expect(service.unlock('token', '9999', new Date())).rejects.toThrow(
        UnauthorizedException,
      );

      expect(metrics.recordUnlock.mock.calls).toEqual([['failure']]);
    });

    it('counts a successful unlock once', async () => {
      links.resolve.mockResolvedValue(okResolution);

      await service.unlock('token', PIN, new Date());

      expect(metrics.recordUnlock.mock.calls).toEqual([['success']]);
    });

    it('counts an expired link separately from the other refusals', async () => {
      // The only place the four causes are allowed to differ. It must stay
      // behind the one indistinguishable answer -- the test above asserts the
      // same 401 for all three.
      links.resolve.mockResolvedValue({ outcome: 'expired' });

      await expect(service.unlock('token', PIN, new Date())).rejects.toThrow(
        UnauthorizedException,
      );

      expect(metrics.recordExpiredLinkHit).toHaveBeenCalledTimes(1);
    });

    it.each<LinkResolution>([{ outcome: 'unknown' }, { outcome: 'revoked' }])(
      'does not count %o as an expired-link hit',
      async (resolution) => {
        links.resolve.mockResolvedValue(resolution);

        await expect(service.unlock('token', PIN, new Date())).rejects.toThrow(
          UnauthorizedException,
        );

        expect(metrics.recordExpiredLinkHit).not.toHaveBeenCalled();
      },
    );
  });
});
