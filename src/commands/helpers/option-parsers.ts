/**
 * Commander option coercers shared by commands.
 *
 * Each parser throws a plain Error on invalid input. Commander lets it propagate
 * out of parseAsync, so the top-level handler in main.ts formats it (text or
 * JSON) and sets exit code 1 -- the same path parsePositiveInt in path-query.ts
 * takes.
 */

const NON_NEGATIVE_INT_PATTERN = /^\d+$/;

/** Parse a CLI value as a strict non-negative integer (0 allowed); rejects signs and trailing chars. */
export function parseNonNegativeInt(value: string): number {
  if (!NON_NEGATIVE_INT_PATTERN.test(value)) {
    throw new Error(`Expected a non-negative integer, got "${value}"`);
  }
  return Number(value);
}
