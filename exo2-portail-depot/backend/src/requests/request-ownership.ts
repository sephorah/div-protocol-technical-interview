import { NotFoundException } from '@nestjs/common';

/**
 * The single refusal for "this request is not yours, or does not exist".
 *
 * 404 and never 403: a 403 confirms that an id exists in another practice,
 * which is enough to enumerate its caseload. The two cases must therefore be
 * indistinguishable, message included -- hence one definition rather than one
 * per call site.
 */
export const requestNotFound = (): NotFoundException =>
  new NotFoundException("Cette demande de dépôt n'existe pas.");
