import { Transform, TransformFnParams } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 20;
/**
 * A dashboard needs no more, and the bound is what stops one authenticated call
 * from pulling the whole table and every piece hanging off it.
 */
export const MAX_PAGE_SIZE = 100;

/**
 * Turns the string a query string carries into the number the service needs.
 *
 * The DEFAULTS do not come from here: class-transformer skips @Transform
 * entirely for a key the plain object does not have, so an absent `page` would
 * stay undefined and fail @IsInt. They come from the property initializers
 * below, which run when the instance is constructed. This function only has to
 * cover `?page=` -- an empty string, which Number() would read as 0 and @Min(1)
 * would then refuse.
 */
const toPageNumber =
  (fallback: number) =>
  ({ value }: TransformFnParams): unknown =>
    value === undefined || value === null || value === ''
      ? fallback
      : Number(value);

/**
 * The query of GET /requests.
 *
 * The global ValidationPipe runs with forbidNonWhitelisted, which applies to
 * the query string too: an unknown parameter is a 400 rather than a filter
 * quietly ignored.
 *
 * The messages are in French, like every DTO here: they are read by the lawyer.
 */
export class ListRequestsDto {
  @Transform(toPageNumber(1))
  @IsInt({ message: 'Le numéro de page doit être un entier.' })
  @Min(1, { message: 'La première page porte le numéro 1.' })
  page: number = 1;

  @Transform(toPageNumber(DEFAULT_PAGE_SIZE))
  @IsInt({ message: 'La taille de page doit être un entier.' })
  @Min(1, { message: 'La taille de page vaut au moins 1.' })
  @Max(MAX_PAGE_SIZE, {
    message: `La taille de page ne peut pas dépasser ${MAX_PAGE_SIZE}.`,
  })
  pageSize: number = DEFAULT_PAGE_SIZE;
}
