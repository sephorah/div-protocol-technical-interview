import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { durationToMilliseconds } from '../config/duration';
import { generatePublicToken, hashPublicToken } from '../crypto/secrets';
import { PrismaService } from '../prisma/prisma.service';

/** Why a rotation was refused. Every value answers 401; only 'reused' kills the family. */
export type RefreshRejection = 'unknown' | 'expired' | 'reused' | 'raced';

export type RefreshOutcome =
  | { status: 'rotated'; token: string; lawyerId: string }
  | { status: 'rejected'; reason: RefreshRejection };

/**
 * A token rotated less than this long ago is a race between two tabs, not an
 * attack: cookies are shared per browser, so a request already in flight still
 * carries the previous value. Answering 401 without killing the family lets the
 * client retry with the cookie it now holds.
 */
const RACE_WINDOW_MS = 30_000;

/**
 * Rotation of refresh tokens, per RFC 9700 § 4.14.2.
 *
 * A *family* is the chain issued by one login. Rotation replaces a link and
 * keeps the old row: its presence is the only thing that makes a reuse
 * recognisable -- deleted, a stolen token would look like an unknown one.
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Opens a chain: a new family, both deadlines dated from now. */
  issue(lawyerId: string): Promise<string> {
    return this.append(
      lawyerId,
      randomUUID(),
      this.deadline('SESSION_EXPIRES'),
    );
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

    const claimed = await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      return { status: 'rejected', reason: 'raced' };
    }

    const successor = await this.append(
      stored.lawyerId,
      stored.familyId,
      stored.expiresAt,
    );
    return { status: 'rotated', token: successor, lawyerId: stored.lawyerId };
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
   * chain leaves one behind per renewal. Cleared at login, where the cost is
   * paid once per session rather than by a scheduled job nobody runs.
   */
  async purgeExpired(lawyerId: string): Promise<void> {
    const now = new Date();
    await this.prisma.refreshToken.deleteMany({
      where: {
        lawyerId,
        // Either deadline being past makes the row useless. Keeping only the
        // ceiling would leave dormant chains around for up to seven days.
        OR: [{ expiresAt: { lt: now } }, { idleExpiresAt: { lt: now } }],
      },
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
  ): Promise<string> {
    const token = generatePublicToken();
    await this.prisma.refreshToken.create({
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
