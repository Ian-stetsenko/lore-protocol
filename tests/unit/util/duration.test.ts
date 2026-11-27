import { describe, it, expect } from 'vitest';
import { parseDurationMs } from '../../../src/util/duration.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('parseDurationMs', () => {
  it.each([
    ['30d', 30],
    ['2w', 14],
    ['6m', 180],
    ['1y', 365],
    ['0d', 0],
  ])('should parse %j as %d days', (input, days) => {
    expect(parseDurationMs(input)).toBe(days * MS_PER_DAY);
  });

  it.each(['', '30', 'd', '30x', '-1d', '1.5m', ' 6m', '6m ', '6M', 'six months'])(
    'should return null for %j',
    (input) => {
      expect(parseDurationMs(input)).toBeNull();
    },
  );
});
