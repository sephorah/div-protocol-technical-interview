import { applyDecorators } from '@nestjs/common';
import { IsInt, Max, Min } from 'class-validator';

/** Bounds how long a forgotten link stays alive. */
export const MAX_EXPIRES_DAYS = 90;

/**
 * The validity of a deposit link, in days.
 *
 * Composed rather than copied, because two DTOs carry this exact field -- the
 * creation and the regeneration. The bounds already came from one constant; the
 * MESSAGES did not, and two French wordings for the same rule is what a reader
 * notices before a developer does.
 *
 * A number of days rather than an ISO date: the browser's clock may differ from
 * the server's, and a date would have to refuse the past *and* bound the future
 * for the same business value.
 *
 * No @Type(() => Number): a JSON body carries a real number, and coercing would
 * silently accept "14" from a caller who believes they sent a string.
 */
export const IsExpiresInDays = (): PropertyDecorator =>
  applyDecorators(
    IsInt({ message: 'La durée de validité est un nombre de jours entier.' }),
    Min(1, { message: "La durée de validité est d'au moins un jour." }),
    Max(MAX_EXPIRES_DAYS, {
      message: `La durée de validité ne peut pas dépasser ${MAX_EXPIRES_DAYS} jours.`,
    }),
  );
