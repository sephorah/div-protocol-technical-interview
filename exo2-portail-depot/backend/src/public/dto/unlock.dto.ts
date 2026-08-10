import { IsString, Matches } from 'class-validator';

/**
 * The unlock route's body.
 *
 * The shape rule is what bounds the cost of the route: argon2id's price grows
 * with its input, and this endpoint is anonymous, deliberately not rate-limited
 * (G1 does not exist yet). A `@Matches` on exactly four digits rejects a
 * megabyte before any hashing happens.
 *
 * A string, not a number: "0042" is a valid PIN and 42 is not the same thing.
 */
export class UnlockDto {
  @IsString({ message: 'Le code doit être une suite de 4 chiffres.' })
  @Matches(/^\d{4}$/, { message: 'Le code doit comporter 4 chiffres.' })
  pin!: string;
}
