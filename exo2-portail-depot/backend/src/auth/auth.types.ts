import { Request } from 'express';
import { LawyerProfile } from '../lawyers/lawyer.types';

/**
 * `sub` is the lawyer's identifier and the only business claim: the guard
 * re-reads the account anyway, so a name or an address copied here would just
 * be free to go stale. Nothing sensitive belongs in a payload in any case -- a
 * JWT is signed, not encrypted.
 */
export interface JwtPayload {
  sub: string;
  iat?: number;
  exp?: number;
}

/**
 * A request that has been through JwtAuthGuard, which is what sets `lawyer`.
 * Typing a @Public() route with it would promise a field that is absent at
 * runtime.
 */
export interface AuthenticatedRequest extends Request {
  lawyer: LawyerProfile;
}
