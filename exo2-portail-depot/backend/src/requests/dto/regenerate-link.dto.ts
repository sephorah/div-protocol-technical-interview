import { IsExpiresInDays } from './expires-in-days.decorator';

/**
 * The body of POST /requests/:id/link.
 *
 * The duration is mandatory rather than inherited from the previous link: a
 * lawyer regenerating a month later would otherwise get an expiry dated from
 * the original request, hence possibly already past -- a link born dead.
 *
 * The owner is deliberately absent, like in CreateRequestDto: it is read from
 * the session, and forbidNonWhitelisted turns a body naming one into a 400
 * rather than a field quietly dropped.
 */
export class RegenerateLinkDto {
  @IsExpiresInDays()
  expiresInDays!: number;
}
