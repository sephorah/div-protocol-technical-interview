import { Lawyer } from '../generated/prisma/client';

/**
 * What a lawyer looks like once it has left the server. A distinct type rather
 * than a `delete lawyer.passwordHash`: the compiler guarantees a hash cannot
 * reach a response, the author's vigilance does not.
 */
export interface LawyerProfile {
  id: string;
  name: string;
  email: string;
}

// Field by field and not by spread: a spread carries every future column along.
export const toProfile = (lawyer: Lawyer): LawyerProfile => ({
  id: lawyer.id,
  name: lawyer.name,
  email: lawyer.email,
});

/**
 * Postgres compares strings byte by byte, so without this "Martin@x.fr" and
 * "martin@x.fr" are two accounts, and a lawyer who capitalises their address is
 * told their credentials are invalid. Case and spaces only: anything further
 * would have to be applied identically at every write site forever.
 */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();
