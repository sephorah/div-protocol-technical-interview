import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generatePin,
  generatePublicToken,
  hashPublicToken,
  hashSecret,
} from '../crypto/secrets';
import { DepositRequest, PublicLink } from '../generated/prisma/client';
import { isUniqueViolation } from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { buildDepositUrl } from './public-url';
import { requestNotFound } from './request-ownership';
import { isExpired } from './request-status';
import { IssuedLink } from './request.types';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A discriminated union, and it must NEVER be serialised as-is by a public
 * route: the public surface collapses the three refusals into one
 * indistinguishable answer, or an anonymous caller could enumerate live links.
 */
/**
 * Narrowed rather than the whole row: handed a full PublicLink, a caller could
 * serialise `pinHash` to an anonymous client -- the material for an offline
 * attack on a 4-digit PIN.
 */
export type ResolvedLink = Pick<PublicLink, 'id' | 'pinHash' | 'expiresAt'>;

export type LinkResolution =
  | { outcome: 'ok'; link: ResolvedLink; request: DepositRequest }
  | { outcome: 'unknown' }
  | { outcome: 'revoked' }
  | { outcome: 'expired' };

@Injectable()
export class PublicLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Applies expiry and revocation to a presented token.
   *
   * `now` is an argument for the same reason as in deriveStatus: the boundary
   * is testable without freezing the clock, and a caller handling several links
   * classifies them all against a single instant.
   */
  async resolve(token: string, now: Date): Promise<LinkResolution> {
    // The lookup goes through the SHA-256, which is what the unique index
    // covers: one indexed read, and the clear token never reaches a query.
    const link = await this.prisma.publicLink.findUnique({
      where: { tokenHash: hashPublicToken(token) },
      // Explicit, so the columns a caller can reach are decided here and not by
      // whatever the table happens to hold. revokedAt is read below but does
      // not leave: it becomes the `outcome`.
      select: {
        id: true,
        pinHash: true,
        expiresAt: true,
        revokedAt: true,
        request: true,
      },
    });

    if (link === null) {
      return { outcome: 'unknown' };
    }
    // Revocation before expiry: it is a decision rather than the clock running
    // out, and a link that is both should report the decision.
    if (link.revokedAt !== null) {
      return { outcome: 'revoked' };
    }
    if (isExpired(link.expiresAt, now)) {
      return { outcome: 'expired' };
    }

    // Field by field, not a spread: a spread would also carry revokedAt, and
    // TypeScript does not flag surplus properties coming from a variable. The
    // same reasoning as toCreatedRequest -- it is the compiler, not the
    // author's vigilance, that keeps a column out of a caller's reach.
    return {
      outcome: 'ok',
      link: { id: link.id, pinHash: link.pinHash, expiresAt: link.expiresAt },
      request: link.request,
    };
  }

  /**
   * Loads a request only if it belongs to the caller.
   *
   * findFirst with both criteria rather than findUnique then a comparison: one
   * query, and no branch in which the check can be forgotten.
   */
  private async ownedRequestId(
    requestId: string,
    lawyerId: string,
  ): Promise<string> {
    const found = await this.prisma.depositRequest.findFirst({
      where: { id: requestId, lawyerId },
      select: { id: true },
    });

    if (found === null) {
      throw requestNotFound();
    }
    return found.id;
  }

  /**
   * New token, NEW PIN, new deadline. The PIN is redrawn rather than preserved
   * BECAUSE it is hashed: a kept link could not have its code reprinted, and a
   * link whose PIN nobody knows is worth nothing. This is the only way back
   * when the lawyer never saw it.
   *
   * Extending an existing link is deliberately not offered: it would lengthen
   * the life of a token already sent by email.
   */
  async regenerate(
    requestId: string,
    lawyerId: string,
    expiresInDays: number,
  ): Promise<IssuedLink> {
    const ownedId = await this.ownedRequestId(requestId, lawyerId);

    const token = generatePublicToken();
    const pin = generatePin();
    // Hashed BEFORE the transaction: argon2id takes tens of milliseconds, and
    // holding a transaction open across it would serve no purpose. Same
    // reasoning as RequestsService.create.
    const pinHash = await hashSecret(pin);

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + expiresInDays * MILLISECONDS_PER_DAY,
    );

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.publicLink.updateMany({
          where: { requestId: ownedId, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.publicLink.create({
          data: {
            requestId: ownedId,
            tokenHash: hashPublicToken(token),
            pinHash,
            expiresAt,
          },
        });
      });
    } catch (error) {
      // The partial unique index (WHERE "revokedAt" IS NULL) is what forbids
      // two active links. Two concurrent regenerations therefore land here, and
      // the loser deserves a retryable answer rather than an opaque 500.
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          "Un autre lien vient d'être généré pour cette demande. Réessayez.",
        );
      }
      throw error;
    }

    return {
      url: buildDepositUrl(
        this.config.getOrThrow<string>('PUBLIC_BASE_URL'),
        token,
      ),
      pin,
      expiresAt,
    };
  }

  /**
   * Cuts access without reissuing anything.
   *
   * Idempotent: called on a request with no active link it still succeeds,
   * because the requested outcome -- nobody gets in -- holds either way.
   * Reporting "there was nothing to revoke" would only invite the caller to
   * treat a double click as a failure.
   */
  async revoke(requestId: string, lawyerId: string): Promise<void> {
    const ownedId = await this.ownedRequestId(requestId, lawyerId);

    await this.prisma.publicLink.updateMany({
      where: { requestId: ownedId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
