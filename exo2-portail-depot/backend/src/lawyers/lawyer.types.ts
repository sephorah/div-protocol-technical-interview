import { Lawyer } from '../generated/prisma/client';

/**
 * What a lawyer looks like once it has left the server.
 *
 * A distinct type rather than a `delete lawyer.passwordHash` on the Prisma
 * model: the compiler is what guarantees a hash cannot reach a response body,
 * not the author's vigilance. Adding a secret column to the schema later
 * therefore cannot leak it by accident -- it simply will not be in this type.
 */
export interface LawyerProfile {
  id: string;
  name: string;
  email: string;
}

/**
 * The only path from the stored row to the client.
 *
 * Written field by field, deliberately, rather than by destructuring the rest
 * of the object: a spread would carry every future column along with it.
 */
export const toProfile = (lawyer: Lawyer): LawyerProfile => ({
  id: lawyer.id,
  name: lawyer.name,
  email: lawyer.email,
});

/**
 * Normalises an address before it is written or looked up.
 *
 * The schema declares `email` unique, and Postgres compares strings byte by
 * byte: without this, "Martin@x.fr" and "martin@x.fr" are two different
 * accounts, and a lawyer who capitalises their address at login is simply told
 * their credentials are invalid.
 *
 * Only the case and the surrounding spaces are touched. Nothing else is
 * "cleaned up" -- the local part of an address is case-sensitive per RFC 5321
 * and, more to the point, any further normalisation would have to be applied
 * identically at every write site forever.
 */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase();
