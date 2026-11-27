/**
 * Duration strings used by staleness thresholds: an integer followed by a
 * unit -- d (days), w (weeks), m (30-day months) or y (365-day years).
 * Examples: "30d", "2w", "6m", "1y".
 *
 * Pure module: no I/O, safe to use from commands and services alike.
 */

type DurationUnit = 'd' | 'w' | 'm' | 'y';

const DURATION_PATTERN = /^(\d+)(d|w|m|y)$/;

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

const DAYS_PER_UNIT: Readonly<Record<DurationUnit, number>> = {
  d: 1,
  w: 7,
  m: 30,
  y: 365,
};

/**
 * Parse a duration string into milliseconds.
 * Returns null when the string is not a valid duration, so each caller
 * chooses its own policy (reject a CLI flag, fall back for config).
 */
export function parseDurationMs(duration: string): number | null {
  const match = DURATION_PATTERN.exec(duration);
  if (!match) {
    return null;
  }
  const [, amount, unit] = match;
  if (!isDurationUnit(unit)) {
    return null;
  }
  return Number(amount) * DAYS_PER_UNIT[unit] * MS_PER_DAY;
}

function isDurationUnit(value: string): value is DurationUnit {
  return Object.hasOwn(DAYS_PER_UNIT, value);
}
