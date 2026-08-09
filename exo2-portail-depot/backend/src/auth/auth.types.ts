import { Request } from 'express';
import { LawyerProfile } from '../lawyers/lawyer.types';

/**
 * What the signed token carries.
 *
 * `sub` (subject) is the standard claim for "who this token is about", and it
 * holds the lawyer's identifier -- the only immutable key. It is deliberately
 * the ONLY business claim: the guard re-reads the account on every request, so
 * anything else copied in here (name, e-mail) would be a second copy free to
 * go stale.
 *
 * Nothing sensitive goes in here in any case: a JWT is signed, NOT encrypted.
 * Anyone holding the token can read its payload without the secret.
 *
 * `iat` and `exp` are added by @nestjs/jwt at signing time and read back on
 * verification; they are typed here because the payload is re-read whole.
 */
export interface JwtPayload {
  sub: string;
  iat?: number;
  exp?: number;
}

/**
 * A request that has been through JwtAuthGuard.
 *
 * The guard is what puts `lawyer` there, so this type only describes routes it
 * protects. A @Public() route must not be typed with it: the field would be
 * missing at runtime while the compiler promised it.
 */
export interface AuthenticatedRequest extends Request {
  lawyer: LawyerProfile;
}
