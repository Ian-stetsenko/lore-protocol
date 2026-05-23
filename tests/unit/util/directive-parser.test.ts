import { describe, it, expect } from 'vitest';
import { DirectiveParser, parseDirectiveHints } from '../../../src/util/directive-parser.js';

describe('DirectiveParser', () => {
  describe('parse', () => {
    it('should parse a simple instruction without triggers', () => {
      const result = DirectiveParser.parse('Do something');
      expect(result.instruction).toBe('Do something');
      expect(result.triggers).toHaveLength(0);
    });

    it('should parse a single trigger', () => {
      const result = DirectiveParser.parse('[on:squash] Do something');
      expect(result.instruction).toBe('Do something');
      expect(result.triggers).toEqual([{ key: 'on', value: 'squash' }]);
    });

    it('should parse multiple triggers', () => {
      const result = DirectiveParser.parse('[on:squash][step:1] Do something');
      expect(result.instruction).toBe('Do something');
      expect(result.triggers).toEqual([
        { key: 'on', value: 'squash' },
        { key: 'step', value: '1' },
      ]);
    });

    it('should handle complex triggers with special characters', () => {
      const result = DirectiveParser.parse('[until:2026-05-21][scope:src/api] Caution');
      expect(result.instruction).toBe('Caution');
      expect(result.triggers).toEqual([
        { key: 'until', value: '2026-05-21' },
        { key: 'scope', value: 'src/api' },
      ]);
    });

    it('should trim whitespace from instruction', () => {
      const result = DirectiveParser.parse('[on:init]   Clean up  ');
      expect(result.instruction).toBe('Clean up');
    });
  });

  describe('matches', () => {
    const parsed = DirectiveParser.parse('[on:squash][step:1] Do something');

    it('should return true for matching key and value', () => {
      expect(DirectiveParser.matches(parsed, 'on', 'squash')).toBe(true);
    });

    it('should return true for matching key only', () => {
      expect(DirectiveParser.matches(parsed, 'step')).toBe(true);
    });

    it('should return false for non-matching value', () => {
      expect(DirectiveParser.matches(parsed, 'on', 'commit')).toBe(false);
    });

    it('should return false for non-matching key', () => {
      expect(DirectiveParser.matches(parsed, 'until')).toBe(false);
    });
  });

  describe('parseDirectiveHints', () => {
    it('should resolve YYYY-MM as the start of the next month (inclusive end of month)', () => {
      const hints = parseDirectiveHints('[until:2026-06] Remove this');
      expect(hints.until).toBeDefined();
      // 2026-06 -> Date(2026, 6, 1) in JS (which is July 1st)
      expect(hints.until?.getFullYear()).toBe(2026);
      expect(hints.until?.getMonth()).toBe(6); // July
      expect(hints.until?.getDate()).toBe(1);
    });

    it('should resolve YYYY-MM-DD as the very end of that day', () => {
      const hints = parseDirectiveHints('[until:2026-06-15] Remove this');
      expect(hints.until).toBeDefined();
      expect(hints.until?.getFullYear()).toBe(2026);
      expect(hints.until?.getMonth()).toBe(5); // June
      expect(hints.until?.getDate()).toBe(15);
      expect(hints.until?.getHours()).toBe(23);
      expect(hints.until?.getMinutes()).toBe(59);
      expect(hints.until?.getMilliseconds()).toBe(999);
    });

    it('should return empty hints for invalid dates', () => {
      const hints = parseDirectiveHints('[until:invalid-date] Remove this');
      expect(hints.until).toBeUndefined();
    });

    it('should return empty hints when no until trigger is present', () => {
      const hints = parseDirectiveHints('[on:squash] Remove this');
      expect(hints.until).toBeUndefined();
    });
  });
});
