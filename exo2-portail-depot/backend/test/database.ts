/**
 * The two primitives the e2e suites need from the real database: emptying it
 * between tests, and putting the one account they all log in with.
 */

import { PrismaService } from './../src/prisma/prisma.service';

/**
 * Empties every table.
 *
 * TRUNCATE on Lawyer alone with CASCADE: every other table hangs off it through
 * onDelete: Cascade, so naming them would be a list to keep in sync with the
 * schema -- and a table added later and forgotten here would leak rows from one
 * test into the next.
 */
export const resetDatabase = async (prisma: PrismaService): Promise<void> => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Lawyer" CASCADE');
};

export const insertLawyer = (
  prisma: PrismaService,
  lawyer: { email: string; name: string; passwordHash: string },
) => prisma.lawyer.create({ data: lawyer });
