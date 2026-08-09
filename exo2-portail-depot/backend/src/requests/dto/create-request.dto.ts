import { Transform, TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsExpiresInDays } from './expires-in-days.decorator';

/** Bounds the number of inserts, and the size of the response, in one write. */
export const MAX_ITEMS = 20;

const TITLE_MAX_LENGTH = 200;
const LABEL_MAX_LENGTH = 200;

// The type guards are not defensive noise: a non-string reaches here on its way
// to @IsString, and an unguarded .trim() would answer 500 where the caller
// deserves a 400.
const trim = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimEach = ({ value }: TransformFnParams): unknown =>
  Array.isArray(value)
    ? (value as unknown[]).map((entry) =>
        typeof entry === 'string' ? entry.trim() : entry,
      )
    : value;

// What makes two labels "the same" for the client reading their checklist. Case
// only, the spaces having been trimmed above -- going further (accents,
// punctuation) would start refusing labels a lawyer legitimately wants.
const foldCase = (label: unknown): unknown =>
  typeof label === 'string' ? label.toLocaleLowerCase('fr') : label;

/**
 * The body of POST /requests.
 *
 * The owner is deliberately absent: it is read from the session. The global
 * ValidationPipe runs with forbidNonWhitelisted, so a body naming a lawyerId is
 * a 400 rather than a field quietly dropped.
 *
 * Every field is bounded. On an authenticated route the concern is not an
 * anonymous flood but the cost of one write: twenty inserts at most, and no
 * label long enough to turn the dashboard into a wall of text.
 *
 * The messages are in French, unlike the rest of the code: they are read by the
 * lawyer, and that is already the convention of auth/dto/login.dto.ts.
 */
export class CreateRequestDto {
  @Transform(trim)
  @IsString({ message: "L'intitulé de la demande doit être du texte." })
  @MinLength(1, { message: "L'intitulé de la demande est obligatoire." })
  @MaxLength(TITLE_MAX_LENGTH, {
    message: `L'intitulé ne peut pas dépasser ${TITLE_MAX_LENGTH} caractères.`,
  })
  title!: string;

  // Trimming FIRST, hence @Transform: class-transformer runs before
  // class-validator, so "  " is seen as empty and "Bail " as a duplicate of
  // "Bail". Done in the service instead, both checks would arrive too late.
  @Transform(trimEach)
  @IsArray({ message: 'La liste des pièces attendues doit être une liste.' })
  @ArrayMinSize(1, { message: 'Une demande doit attendre au moins une pièce.' })
  @ArrayMaxSize(MAX_ITEMS, {
    message: `Une demande ne peut pas attendre plus de ${MAX_ITEMS} pièces.`,
  })
  @ArrayUnique(foldCase, {
    message: 'Deux pièces attendues portent le même libellé.',
  })
  @IsString({
    each: true,
    message: "Le libellé d'une pièce attendue doit être du texte.",
  })
  @MinLength(1, {
    each: true,
    message: "Le libellé d'une pièce attendue ne peut pas être vide.",
  })
  @MaxLength(LABEL_MAX_LENGTH, {
    each: true,
    message: `Un libellé ne peut pas dépasser ${LABEL_MAX_LENGTH} caractères.`,
  })
  items!: string[];

  @IsExpiresInDays()
  expiresInDays!: number;
}
