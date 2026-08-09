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
import { durationToMilliseconds } from './auth-cookie';
import { JwtPayload } from './auth.types';

/**
 * One message for every failure of the login route.
 *
 * "Unknown e-mail" and "wrong password" must be indistinguishable, otherwise
 * the API answers a question nobody is entitled to ask: which addresses have an
 * account here.
 */
export const INVALID_CREDENTIALS = 'Identifiants invalides';

@Injectable()
export class AuthService implements OnModuleInit {
  /**
   * A real argon2id hash of a value nobody knows, verified against whenever the
   * account does not exist.
   *
   * Without it, an unknown address answers in about a millisecond while a wrong
   * password costs the ~67 ms of an argon2id verification. That difference is
   * measurable over the network and turns the login route into an account
   * enumerator -- same status, same message, but not the same duration.
   *
   * Computed once at startup rather than per request: argon2id is deliberately
   * expensive, and hashing on every failed attempt would hand an attacker a way
   * to load the API by sending addresses that do not exist.
   */
  private decoyHash = '';

  constructor(
    private readonly lawyers: LawyersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Nest awaits this hook before the application accepts a single request, so
   * no login can observe an empty decoy.
   */
  async onModuleInit(): Promise<void> {
    this.decoyHash = await hashSecret(randomBytes(32).toString('hex'));
  }

  /**
   * Verifies credentials and returns the profile, or raises 401.
   *
   * The verification ALWAYS runs, including when the account is missing: that
   * is the whole point of the decoy. Beware when refactoring -- an early
   * `if (lawyer === null) throw` reintroduces the timing difference while
   * looking like a simplification.
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

  /**
   * Signs the session token. The expiry comes from JwtModule's signOptions
   * (JWT_EXPIRES), so it is configured in exactly one place.
   *
   * The payload carries no secret: a JWT is signed, not encrypted, and its
   * content is readable by whoever holds it.
   */
  issueToken(lawyer: LawyerProfile): Promise<string> {
    const payload: JwtPayload = { sub: lawyer.id };
    return this.jwt.signAsync(payload);
  }

  /**
   * The cookie's lifetime, aligned with the token's by construction.
   */
  sessionMaxAgeMs(): number {
    return durationToMilliseconds(
      this.config.getOrThrow<string>('JWT_EXPIRES'),
    );
  }
}
