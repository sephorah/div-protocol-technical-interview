import { IsUUID } from 'class-validator';

/**
 * The non-file part of the multipart body.
 *
 * `@IsUUID` and not a bare string: the column is a uuid, so a malformed value
 * reaches Postgres as an invalid input syntax (22P02) and surfaces as a 500
 * where the caller simply sent nonsense. Rejecting the shape here keeps that a
 * 400, and it leaks nothing -- the format of an identifier is not a secret.
 */
export class DepositFileDto {
  @IsUUID(undefined, { message: 'La pièce visée est invalide.' })
  itemId!: string;
}
