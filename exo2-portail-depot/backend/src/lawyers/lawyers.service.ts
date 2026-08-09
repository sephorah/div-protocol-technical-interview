import { Injectable } from '@nestjs/common';
import { Lawyer } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEmail } from './lawyer.types';

/**
 * Read access to the lawyer account. A service rather than a Prisma call inside
 * AuthService so that address normalisation happens in one place: applied
 * inconsistently, the unique index quietly stops being unique in practice.
 */
@Injectable()
export class LawyersService {
  constructor(private readonly prisma: PrismaService) {}

  // Returns the FULL row, hash included: its caller verifies the password.
  // Anything answering a client goes through toProfile() instead.
  findByEmail(email: string): Promise<Lawyer | null> {
    return this.prisma.lawyer.findUnique({
      where: { email: normalizeEmail(email) },
    });
  }

  // What JwtAuthGuard calls. The identifier is the only immutable key: keyed on
  // the address, a stale token would follow whoever inherits it.
  findById(id: string): Promise<Lawyer | null> {
    return this.prisma.lawyer.findUnique({ where: { id } });
  }
}
