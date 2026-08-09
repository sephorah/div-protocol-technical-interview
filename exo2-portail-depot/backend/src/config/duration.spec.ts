import { durationToMilliseconds } from './duration';

describe('durationToMilliseconds', () => {
  it.each([
    ['60s', 60_000],
    ['15m', 900_000],
    ['2h', 7_200_000],
    ['3d', 259_200_000],
    ['7d', 604_800_000],
  ])('converts %s', (duration, expected) => {
    expect(durationToMilliseconds(duration)).toBe(expected);
  });

  // A bare number is what validateEnv rejects for JWT_EXPIRES: jsonwebtoken
  // reads it as seconds, and as milliseconds when quoted. '0s' and '0h' are the
  // dangerous ones -- they parse, and would produce a token expired at signing
  // time behind a cookie the browser discards on arrival.
  it.each(['900', '2 h', 'two hours', '', '2y', '0s', '0h'])(
    'rejects %p',
    (invalid) => {
      expect(() => durationToMilliseconds(invalid)).toThrow(/usable unit/);
    },
  );
});
