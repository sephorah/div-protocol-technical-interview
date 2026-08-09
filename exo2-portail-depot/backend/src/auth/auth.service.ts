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

/** One message for every failure: an unknown address must look like a wrong password. */
export const INVALID_CREDENTIALS = 'Identifiants invalides';

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

  sessionMaxAgeMs(): number {
    return durationToMilliseconds(
      this.config.getOrThrow<string>('JWT_EXPIRES'),
    );
  }
}
