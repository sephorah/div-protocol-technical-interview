/** Prisma's code for a unique constraint violation. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * Recognises the ONE database error a caller can act on by retrying.
 *
 * Duck-typed on `code` rather than `instanceof PrismaClientKnownRequestError`:
 * the error class comes from the generated client, and an error raised inside a
 * `$transaction` callback does not always arrive as that instance.
 *
 * One definition for both call sites (a regenerated link, a raced deposit):
 * written twice, the two copies could drift and one of them would start
 * swallowing errors that can never succeed on a retry.
 */
export const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === UNIQUE_VIOLATION;
