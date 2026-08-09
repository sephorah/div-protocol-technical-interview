import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hashPublicToken } from '../crypto/secrets';
import { DepositRequest, PublicLink } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isExpired } from './request-status';

/**
 * The outcome of presenting a token.
 *
 * A discriminated union rather than a boolean or an exception, because C1 will
 * collapse the three refusals into ONE indistinguishable answer: an anonymous
 * caller must not be able to tell a wrong token from an expired one, or they
 * could enumerate live links. The distinction is kept here because the tests
 * need it, and because G2 (audit log) will record which of the three happened.
 *
 * It must therefore never be serialised as-is by a public route.
 */
export type LinkResolution =
  | { outcome: 'ok'; link: PublicLink; request: DepositRequest }
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
      include: { request: true },
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

    return { outcome: 'ok', link, request: link.request };
  }
}
