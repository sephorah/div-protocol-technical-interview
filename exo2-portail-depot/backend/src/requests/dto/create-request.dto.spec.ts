import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRequestDto } from './create-request.dto';

/**
 * What this suite protects: the input rules, exercised against the transformer
 * and the validator directly rather than through HTTP. Trimming happens in
 * class-transformer, BEFORE validation -- a rule tested only end to end would
 * not say which of the two layers broke.
 */
const check = async (body: unknown): Promise<string[]> => {
  const dto = plainToInstance(CreateRequestDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
};

const VALID = {
  title: 'Dossier Martin, pieces 2026',
  items: ["Piece d'identite", 'Contrat de bail signe'],
  expiresInDays: 14,
};

describe('CreateRequestDto', () => {
  it('accepts a well-formed request', async () => {
    await expect(check(VALID)).resolves.toEqual([]);
  });

  it('trims the title and each label before anything else looks at them', () => {
    const dto = plainToInstance(CreateRequestDto, {
      ...VALID,
      title: '  Dossier Martin  ',
      items: ['  Bail  '],
    });

    expect(dto.title).toBe('Dossier Martin');
    expect(dto.items).toEqual(['Bail']);
  });

  // A title of spaces is empty for the lawyer reading the dashboard, so it must
  // be empty for the validator too.
  it('rejects a title made of spaces', async () => {
    await expect(check({ ...VALID, title: '   ' })).resolves.toEqual(['title']);
  });

  it('rejects an empty list of expected pieces', async () => {
    await expect(check({ ...VALID, items: [] })).resolves.toEqual(['items']);
  });

  it('rejects more than twenty expected pieces', async () => {
    const items = Array.from({ length: 21 }, (_, index) => `Piece ${index}`);
    await expect(check({ ...VALID, items })).resolves.toEqual(['items']);
  });

  // Case and surrounding spaces must not be enough to smuggle a duplicate in:
  // the client cannot tell two identical labels apart, and C2 attaches a file
  // to ONE of them.
  it('rejects two labels differing only in case or spacing', async () => {
    await expect(
      check({ ...VALID, items: ['Contrat de bail', '  contrat de bail '] }),
    ).resolves.toEqual(['items']);
  });

  it('rejects a label made of spaces', async () => {
    await expect(check({ ...VALID, items: ['Bail', '  '] })).resolves.toEqual([
      'items',
    ]);
  });

  it.each([0, -1, 91, 1.5, '14'])(
    'rejects %p as a number of days',
    async (expiresInDays) => {
      await expect(check({ ...VALID, expiresInDays })).resolves.toEqual([
        'expiresInDays',
      ]);
    },
  );

  it('accepts the bounds, one day and ninety', async () => {
    await expect(check({ ...VALID, expiresInDays: 1 })).resolves.toEqual([]);
    await expect(check({ ...VALID, expiresInDays: 90 })).resolves.toEqual([]);
  });

  /**
   * Every message reaches the lawyer's screen, so every message is in French.
   * A decorator left without one falls back to class-validator's English --
   * "title must be shorter than or equal to 200 characters" -- in the middle of
   * French ones. Matching on "must be" catches exactly that fallback.
   */
  it('never falls back to an English message', async () => {
    const dto = plainToInstance(CreateRequestDto, {
      title: 'x'.repeat(201),
      items: ['y'.repeat(201), 42],
      expiresInDays: 'quatorze',
    });
    const errors = await validate(dto);
    const messages = errors.flatMap((error) =>
      Object.values(error.constraints ?? {}),
    );

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.filter((message) => message.includes('must be'))).toEqual(
      [],
    );
  });

  // The route reads the owner from the session. A body naming one must be a
  // 400, not a field silently dropped.
  it('rejects an unknown field', async () => {
    await expect(
      check({ ...VALID, lawyerId: 'someone-else' }),
    ).resolves.toEqual(['lawyerId']);
  });
});
