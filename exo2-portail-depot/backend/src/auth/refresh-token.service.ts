import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { durationToMilliseconds } from '../config/duration';
import { generatePublicToken, hashPublicToken } from '../crypto/secrets';
import { PrismaService } from '../prisma/prisma.service';

/** Why a rotation was refused. Every value answers 401; only 'reused' kills the family. */
export type RefreshRejection = 'unknown' | 'expired' | 'reused' | 'raced';

export type RefreshOutcome =
  | { status: 'rotated'; token: string; lawyerId: string; expiresAt: Date }
  | { status: 'rejected'; reason: RefreshRejection };

/** A token and the session end it belongs to, so the cookie can outlive neither. */
export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

/**
 * A token rotated less than this long ago is a race between two tabs, not an
 * attack: cookies are shared per browser, so a request already in flight still
 * carries the previous value. Answering 401 without killing the family lets the
 * client retry with the cookie it now holds.
 */
const RACE_WINDOW_MS = 30_000;

/**
 * What `append` needs, so that it works both on the client and inside a
 * transaction -- the transactional client is a PrismaService minus the methods
 * that manage transactions, which no structural type here can express.
 */
type RefreshTokenWriter = {
  refreshToken: { create: PrismaService['refreshToken']['create'] };
};

/** Rotation of refresh tokens, per RFC 9700 § 4.14.2. A *family* is the chain issued by one login. */
@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Opens a chain: a new family, both deadlines dated from now. */
  async issue(lawyerId: string): Promise<IssuedToken> {
    const expiresAt = this.deadline('SESSION_EXPIRES');
    return {
      token: await this.append(lawyerId, randomUUID(), expiresAt),
      expiresAt,
    };
  }

  /**
   * Rotates the presented token, or says why it refuses.
   *
   * The claim is an atomic compare-and-set (`updateMany ... revokedAt: null`),
   * not a read-then-write: two concurrent requests would otherwise both believe
   * they won and issue two successors in one family.
   */
  async rotate(token: string): Promise<RefreshOutcome> {
    const tokenHash = hashPublicToken(token);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (stored === null) {
      return { status: 'rejected', reason: 'unknown' };
    }

    if (stored.revokedAt !== null) {
      if (Date.now() - stored.revokedAt.getTime() < RACE_WINDOW_MS) {
        return { status: 'rejected', reason: 'raced' };
      }
      // Presented long after being rotated: a copy is circulating. The server
      // cannot tell the thief from the victim, so the chain goes.
      await this.revokeFamily(stored.familyId);
      return { status: 'rejected', reason: 'reused' };
    }

    // Both deadlines apply, the nearer one wins: the ceiling caps the session,
    // the idle deadline closes one nobody uses.
    const now = Date.now();
    if (
      stored.expiresAt.getTime() <= now ||
      stored.idleExpiresAt.getTime() <= now
    ) {
      return { status: 'rejected', reason: 'expired' };
    }

    // Claim and successor in ONE transaction: separately, a failed INSERT would
    // revoke the presented token with no replacement, and a single database
    // hiccup would end a seven-day session. It does not close the millisecond a
    // concurrent revokeFamily could slip into -- a window nobody can aim at.
    const successor = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.refreshToken.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (claimed.count === 0) {
        return null;
      }

      return this.append(
        stored.lawyerId,
        stored.familyId,
        stored.expiresAt,
        tx,
      );
    });

    if (successor === null) {
      return { status: 'rejected', reason: 'raced' };
    }

    return {
      status: 'rotated',
      token: successor,
      lawyerId: stored.lawyerId,
      expiresAt: stored.expiresAt,
    };
  }

  /** Logout. An unknown token is a no-op: there is nothing to say about it. */
  async revokeFamilyOf(token: string): Promise<void> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashPublicToken(token) },
    });
    if (stored !== null) {
      await this.revokeFamily(stored.familyId);
    }
  }

  /**
   * Rows survive rotation -- that is what makes a reuse recognisable -- so a
   * chain leaves one behind per renewal. Purged on the CEILING only, never on
   * idleExpiresAt: that would delete the older links of a LIVE chain, and
   * replaying one would read as 'unknown' rather than 'reused'.
   */
  async purgeExpired(lawyerId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({
      where: { lawyerId, expiresAt: { lt: new Date() } },
    });
  }

  private deadline(key: 'SESSION_EXPIRES' | 'SESSION_IDLE_EXPIRES'): Date {
    return new Date(
      Date.now() + durationToMilliseconds(this.config.getOrThrow<string>(key)),
    );
  }

  /**
   * `expiresAt` is passed in and copied; `idleExpiresAt` is recomputed here.
   * That asymmetry IS the design -- the ceiling must not move, the idle
   * deadline must. Computing both, or passing both, silently removes one of the
   * two protections.
   */
  private async append(
    lawyerId: string,
    familyId: string,
    expiresAt: Date,
    client: RefreshTokenWriter = this.prisma,
  ): Promise<string> {
    const token = generatePublicToken();
    await client.refreshToken.create({
      data: {
        tokenHash: hashPublicToken(token),
        familyId,
        expiresAt,
        idleExpiresAt: this.deadline('SESSION_IDLE_EXPIRES'),
        lawyerId,
      },
    });
    return token;
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
