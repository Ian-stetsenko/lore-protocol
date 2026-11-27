import { describe, it, expect } from 'vitest';
import { parseNonNegativeInt } from '../../../../src/commands/helpers/option-parsers.js';

describe('parseNonNegativeInt', () => {
  it.each([
    ['0', 0],
    ['1', 1],
    ['10', 10],
    ['007', 7],
  ])('should parse %j as %d', (input, expected) => {
    expect(parseNonNegativeInt(input)).toBe(expected);
  });

  it.each(['x', '-1', '1.5', '3abc', ' 3', '+3', ''])('should reject %j', (input) => {
    expect(() => parseNonNegativeInt(input)).toThrow(
      `Expected a non-negative integer, got "${input}"`,
    );
  });
});
