import { randomBytes } from 'node:crypto';
import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { hashSecret, verifySecret } from '../crypto/secrets';
import { PrismaService } from '../prisma/prisma.service';
import { PublicLinksService } from '../requests/public-links.service';
import { PublicRequestView } from './public.types';

/**
 * The ONE refusal. A constant rather than three literals: three copies could
 * drift by a word, and a word is enough to rebuild the oracle -- an anonymous
 * caller telling an unknown token from a revoked link enumerates the live
 * links of the practice.
 */
const REFUSED = 'Lien ou code invalide.';

export const refuseAccess = (): UnauthorizedException =>
  new UnauthorizedException(REFUSED);

export interface UnlockResult {
  linkId: string;
  view: PublicRequestView;
}

@Injectable()
export class PublicService implements OnModuleInit {
  /**
   * Verified against when the link cannot be opened, so that all four failures
   * cost the same ~67 ms. Same device as AuthService for an unknown e-mail, and
   * for the same reason: without it an unknown token answers in about a
   * millisecond where a wrong PIN costs argon2id, and the stopwatch gives back
   * the distinction the single message just removed.
   */
  private decoyHash = '';

  constructor(
    private readonly links: PublicLinksService,
    private readonly prisma: PrismaService,
  ) {}

  // Nest awaits this before the first request, so no unlock sees an empty decoy.
  async onModuleInit(): Promise<void> {
    this.decoyHash = await hashSecret(randomBytes(32).toString('hex'));
  }

  /**
   * Opens a deposit link. The four refusals -- unknown token, revoked link,
   * expired link, wrong PIN -- are one and the same answer here; resolve()'s
   * discriminated union exists for the tests and for G2's audit trail, and must
   * never reach an anonymous caller.
   */
  async unlock(token: string, pin: string, now: Date): Promise<UnlockResult> {
    const resolution = await this.links.resolve(token, now);

    const hash =
      resolution.outcome === 'ok' ? resolution.link.pinHash : this.decoyHash;
    const pinMatches = await verifySecret(pin, hash);

    if (resolution.outcome !== 'ok' || !pinMatches) {
      throw refuseAccess();
    }

    return {
      linkId: resolution.link.id,
      view: await this.viewOf(resolution.request.id, resolution.link.expiresAt),
    };
  }

  /**
   * The client's checklist.
   *
   * `expiresAt` is passed in rather than read here: it belongs to the LINK, not
   * to the request, and the request can have several links in its history. The
   * caller -- the unlock route or the session guard -- is the one that knows
   * which link the client is holding.
   */
  async viewOf(requestId: string, expiresAt: Date): Promise<PublicRequestView> {
    const request = await this.prisma.depositRequest.findUnique({
      where: { id: requestId },
      // Explicit down to the file, which is selected only to answer "is it
      // there": selecting the row would put the storage key one spread away
      // from an anonymous response.
      select: {
        id: true,
        title: true,
        items: {
          select: { id: true, label: true, file: { select: { id: true } } },
          // B2: the items of one request share a creation timestamp to the
          // millisecond, so only `position` keeps the checklist stable between
          // two page loads.
          orderBy: { position: 'asc' },
        },
      },
    });

    // Unreachable through either caller -- deleting a request cascades to its
    // links, so the token could no longer resolve. Refused rather than 500 for
    // the same reason as everything else on this route: one answer.
    if (request === null) {
      throw refuseAccess();
    }

    return {
      requestId: request.id,
      title: request.title,
      expiresAt,
      items: request.items.map((item) => ({
        id: item.id,
        label: item.label,
        received: item.file !== null,
      })),
    };
  }
}
