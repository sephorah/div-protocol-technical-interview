import { Injectable } from '@nestjs/common';
import { Lawyer } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEmail } from './lawyer.types';

/**
 * Read access to the lawyer account.
 *
 * Thin on purpose: the portal has exactly one authenticated actor and no
 * sign-up, so there is nothing else to do with it yet. It exists as a service
 * rather than as a Prisma call inside AuthService so that the normalisation of
 * the address happens in one place -- the day B2 or a future admin route looks
 * an account up, it will normalise it the same way, or the unique index will
 * quietly stop being unique in practice.
 */
@Injectable()
export class LawyersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the FULL row, password hash included: its caller is the
   * authentication service, which needs the hash to verify it. Everything that
   * answers a client goes through toProfile() instead.
   */
  findByEmail(email: string): Promise<Lawyer | null> {
    return this.prisma.lawyer.findUnique({
      where: { email: normalizeEmail(email) },
    });
  }

  /**
   * Lookup by identifier, used by JwtAuthGuard on every authenticated request.
   *
   * The identifier is what the token carries, and it is the only immutable key:
   * looking an account up by the e-mail found in a token would break the day an
   * address changes, and would leave a stale token pointing at whoever inherits
   * that address.
   */
  findById(id: string): Promise<Lawyer | null> {
    return this.prisma.lawyer.findUnique({ where: { id } });
  }
}
