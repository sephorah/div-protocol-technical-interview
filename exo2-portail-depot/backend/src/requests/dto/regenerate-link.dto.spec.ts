import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegenerateLinkDto } from './regenerate-link.dto';

/**
 * What this suite protects: that regenerating a link is bounded by the same
 * rules as creating one, and refuses the same values. The two DTOs share their
 * decorator, so this suite is also what proves the sharing did not lose a rule.
 */
const messages = async (body: unknown): Promise<string[]> => {
  const errors = await validate(plainToInstance(RegenerateLinkDto, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
};

describe('RegenerateLinkDto', () => {
  it('accepts a duration within bounds', async () => {
    await expect(messages({ expiresInDays: 14 })).resolves.toEqual([]);
  });

  it.each([0, -1, 91, 1.5, '14', null])('rejects %p', async (value) => {
    await expect(messages({ expiresInDays: value })).resolves.not.toEqual([]);
  });

  it('rejects a missing duration', async () => {
    await expect(messages({})).resolves.not.toEqual([]);
  });

  it('rejects a body naming the owner', async () => {
    // The lawyer comes from the session. Silently dropping the field would be
    // worse than a 400: the caller would believe it was honoured.
    await expect(
      messages({ expiresInDays: 14, lawyerId: 'lawyer-2' }),
    ).resolves.not.toEqual([]);
  });

  // class-validator serves its English defaults for any decorator without a
  // message, in the middle of the French ones.
  it('never falls back to a library message', async () => {
    const all = await messages({ expiresInDays: 999 });
    expect(all.join(' ')).not.toMatch(/must be/);
  });
});
