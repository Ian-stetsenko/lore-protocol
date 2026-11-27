import { describe, it, expect } from 'vitest';
import {
  parseNonNegativeInt,
  parsePositiveInt,
} from '../../../../src/commands/helpers/option-parsers.js';

describe('parsePositiveInt', () => {
  it.each([
    ['1', 1],
    ['25', 25],
    ['007', 7],
  ])('should parse %j as %d', (input, expected) => {
    expect(parsePositiveInt(input)).toBe(expected);
  });

  it.each(['0', '00', 'x', '-1', '1.5', '3abc', ''])('should reject %j', (input) => {
    expect(() => parsePositiveInt(input)).toThrow(`Expected a positive integer, got "${input}"`);
  });
});

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
