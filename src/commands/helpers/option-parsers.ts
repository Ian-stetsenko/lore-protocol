import { parseDurationMs } from '../../util/duration.js';

/**
 * Commander option coercers shared by commands.
 *
 * Each parser throws a plain Error on invalid input. Commander lets it propagate
 * out of parseAsync, so the top-level handler in main.ts formats it (text or
 * JSON) and sets exit code 1.
 */

/** Digits only: no sign, decimal point, whitespace or trailing characters. */
const NON_NEGATIVE_INT_PATTERN = /^\d+$/;

/** Parse a CLI value as a strict positive integer; rejects non-numeric trailing chars. */
export function parsePositiveInt(value: string): number {
  if (!NON_NEGATIVE_INT_PATTERN.test(value) || Number(value) < 1) {
    throw new Error(`Expected a positive integer, got "${value}"`);
  }
  return Number(value);
}

/** Parse a CLI value as a strict non-negative integer (0 allowed); rejects signs and trailing chars. */
export function parseNonNegativeInt(value: string): number {
  if (!NON_NEGATIVE_INT_PATTERN.test(value)) {
    throw new Error(`Expected a non-negative integer, got "${value}"`);
  }
  return Number(value);
}

/** Validate a CLI duration such as 30d, 2w, 6m or 1y; returns the value unchanged. */
export function parseDurationOption(value: string): string {
  if (parseDurationMs(value) === null) {
    throw new Error(`Expected a duration like 30d, 2w, 6m or 1y, got "${value}"`);
  }
  return value;
}
