const MILLISECONDS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/**
 * Reads a duration written with its unit ("15m", "7d") into milliseconds.
 *
 * Lives in config/ rather than next to its first caller: env.validation.ts
 * compares two durations against each other, and configuration must not depend
 * on a business module to do so.
 *
 * No leading zero: "0h" parses, and would sign already-expired tokens behind a
 * cookie the browser drops on arrival -- every login answering 200 with no
 * session behind it.
 */
export const durationToMilliseconds = (duration: string): number => {
  const match = /^([1-9]\d*)([smhd])$/.exec(duration.trim());
  if (match === null) {
    throw new Error(
      'Duration has no usable unit (expected: 60s, 15m, 2h, 7d).',
    );
  }

  return Number(match[1]) * MILLISECONDS[match[2]];
};
