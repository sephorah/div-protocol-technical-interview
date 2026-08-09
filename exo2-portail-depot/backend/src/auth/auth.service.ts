import { randomBytes } from 'node:crypto';
import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hashSecret, verifySecret } from '../crypto/secrets';
import { LawyerProfile, toProfile } from '../lawyers/lawyer.types';
import { LawyersService } from '../lawyers/lawyers.service';
import { durationToMilliseconds } from '../config/duration';
import { JwtPayload } from './auth.types';
import { RefreshRejection, RefreshTokenService } from './refresh-token.service';

/** One message for every failure: an unknown address must look like a wrong password. */
export const INVALID_CREDENTIALS = 'Identifiants invalides';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export type RenewOutcome =
  | {
      status: 'renewed';
      profile: LawyerProfile;
      accessToken: string;
      refreshToken: string;
    }
  | { status: 'rejected'; reason: RefreshRejection };

@Injectable()
export class AuthService implements OnModuleInit {
  /**
   * Verified against when the account does not exist, so that both failures
   * cost the same ~67 ms -- otherwise the response time tells an attacker which
   * addresses have an account. Computed once, not per request: hashing on every
   * failed attempt would be an amplification vector of its own.
   */
  private decoyHash = '';

  constructor(
    private readonly lawyers: LawyersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  // Nest awaits this before the first request, so no login sees an empty decoy.
  async onModuleInit(): Promise<void> {
    this.decoyHash = await hashSecret(randomBytes(32).toString('hex'));
  }

  /**
   * The verification always runs, missing account included. An early
   * `if (lawyer === null) throw` looks like a simplification and reinstates the
   * account enumerator.
   */
  async validateLawyer(
    email: string,
    password: string,
  ): Promise<LawyerProfile> {
    const lawyer = await this.lawyers.findByEmail(email);
    const passwordMatches = await verifySecret(
      password,
      lawyer?.passwordHash ?? this.decoyHash,
    );

    if (lawyer === null || !passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return toProfile(lawyer);
  }

  // The expiry comes from JwtModule's signOptions, so no call site can forget it.
  issueToken(lawyer: LawyerProfile): Promise<string> {
    const payload: JwtPayload = { sub: lawyer.id };
    return this.jwt.signAsync(payload);
  }

  /** Opens a session: an access token, and the chain that can renew it. */
  async openSession(lawyer: LawyerProfile): Promise<SessionTokens> {
    // Here rather than in a scheduled job: once per login is enough to keep the
    // table from growing one row per rotation forever.
    await this.refreshTokens.purgeExpired(lawyer.id);

    return {
      accessToken: await this.issueToken(lawyer),
      refreshToken: await this.refreshTokens.issue(lawyer.id),
    };
  }

  /**
   * The account is re-read, exactly as the guard does: a session must not
   * survive the deletion of the account it belongs to.
   */
  async renewSession(refreshToken: string): Promise<RenewOutcome> {
    const outcome = await this.refreshTokens.rotate(refreshToken);
    if (outcome.status === 'rejected') {
      return outcome;
    }

    const lawyer = await this.lawyers.findById(outcome.lawyerId);
    if (lawyer === null) {
      return { status: 'rejected', reason: 'unknown' };
    }

    const profile = toProfile(lawyer);
    return {
      status: 'renewed',
      profile,
      accessToken: await this.issueToken(profile),
      refreshToken: outcome.token,
    };
  }

  /** Logout: closes the chain server-side, so a copied cookie stops working. */
  revokeSession(refreshToken: string): Promise<void> {
    return this.refreshTokens.revokeFamilyOf(refreshToken);
  }

  accessMaxAgeMs(): number {
    return durationToMilliseconds(
      this.config.getOrThrow<string>('JWT_EXPIRES'),
    );
  }

  sessionMaxAgeMs(): number {
    return durationToMilliseconds(
      this.config.getOrThrow<string>('SESSION_EXPIRES'),
    );
  }
}
