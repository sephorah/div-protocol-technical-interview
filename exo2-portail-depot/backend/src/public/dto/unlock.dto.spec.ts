import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UnlockDto } from './unlock.dto';

const check = async (body: unknown): Promise<string[]> => {
  const dto = plainToInstance(UnlockDto, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
};

const messagesOf = async (body: unknown): Promise<string[]> => {
  const dto = plainToInstance(UnlockDto, body);
  const errors = await validate(dto);
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
};

describe('UnlockDto', () => {
  it('accepts four digits, leading zeros included', async () => {
    await expect(check({ pin: '0042' })).resolves.toEqual([]);
  });

  // The bound is not cosmetic: the route is anonymous and hashes with argon2id,
  // whose cost grows with the input. Unbounded, anyone could ask the server to
  // hash a megabyte per request.
  it.each(['abcd', '1'.repeat(100000)])(
    'rejects a pin that is not four digits (%s)',
    async (pin) => {
      await expect(check({ pin })).resolves.toEqual(['pin']);
    },
  );

  it('rejects a numeric pin, which would lose a leading zero', async () => {
    await expect(check({ pin: 42 })).resolves.toEqual(['pin']);
  });

  it('rejects a body carrying anything else', async () => {
    await expect(check({ pin: '1234', token: 'x' })).resolves.toEqual([
      'token',
    ]);
  });

  // class-validator serves its English default for any decorator given no
  // message, which would put "pin must match" in the middle of French ones.
  it('phrases every refusal in French', async () => {
    const messages = await messagesOf({ pin: 42 });

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.filter((message) => message.includes('must'))).toEqual([]);
  });
});
