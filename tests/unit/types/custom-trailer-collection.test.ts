import { describe, it, expect } from 'vitest';
import { CustomTrailerCollection } from '../../../src/types/custom-trailer-collection.js';

describe('CustomTrailerCollection', () => {
  describe('constructor and iteration', () => {
    it('should store entries and iterate over them', () => {
      const entries = new Map<string, readonly string[]>([
        ['Team', ['platform']],
        ['Ticket', ['PROJ-123', 'PROJ-456']],
      ]);
      const collection = new CustomTrailerCollection(entries);

      const result: [string, readonly string[]][] = [];
      for (const entry of collection) {
        result.push(entry);
      }

      expect(result).toEqual([
        ['Team', ['platform']],
        ['Ticket', ['PROJ-123', 'PROJ-456']],
      ]);
    });

    it('should not be affected by mutations to the original map', () => {
      const entries = new Map<string, readonly string[]>([
        ['Team', ['platform']],
      ]);
      const collection = new CustomTrailerCollection(entries);

      entries.set('Team', ['changed']);
      entries.set('New', ['value']);

      expect(collection.get('Team')).toEqual(['platform']);
      expect(collection.has('New')).toBe(false);
    });
  });

  describe('empty', () => {
    it('should return an empty collection', () => {
      const collection = CustomTrailerCollection.empty();

      expect(collection.isEmpty).toBe(true);
      expect(collection.size).toBe(0);
      expect(collection.lineCount).toBe(0);
    });

    it('should return the same instance on repeated calls', () => {
      const a = CustomTrailerCollection.empty();
      const b = CustomTrailerCollection.empty();

      expect(a).toBe(b);
    });
  });

  describe('fromRaw', () => {
    it('should extract unknown keys as custom trailers', () => {
      const raw = {
        Confidence: 'high',
        'Scope-risk': 'narrow',
        'Assisted-by': ['Gemini:CLI'],
        Ticket: ['PROJ-123'],
      };

      const collection = CustomTrailerCollection.fromRaw(raw);

      expect(collection.get('Assisted-by')).toEqual(['Gemini:CLI']);
      expect(collection.get('Ticket')).toEqual(['PROJ-123']);
      expect(collection.has('Confidence')).toBe(false);
      expect(collection.has('Scope-risk')).toBe(false);
    });

    it('should filter out all known Lore trailer keys', () => {
      const raw = {
        'Lore-id': 'abcd1234',
        Constraint: ['a constraint'],
        Rejected: ['alt A'],
        Confidence: 'high',
        'Scope-risk': 'narrow',
        Reversibility: 'clean',
        Directive: ['directive'],
        Tested: ['tested'],
        'Not-tested': ['not tested'],
        Supersedes: ['11223344'],
        'Depends-on': ['55667788'],
        Related: ['aabbccdd'],
        'My-custom': ['custom value'],
      };

      const collection = CustomTrailerCollection.fromRaw(raw);

      expect(collection.size).toBe(1);
      expect(collection.get('My-custom')).toEqual(['custom value']);
    });

    it('should coerce a single string to a [string] array', () => {
      const raw = {
        'Assisted-by': 'Claude:CLI',
      };

      const collection = CustomTrailerCollection.fromRaw(raw);

      expect(collection.get('Assisted-by')).toEqual(['Claude:CLI']);
    });

    it('should skip non-string and non-array values', () => {
      const raw = {
        'Valid-custom': 'value',
        'Number-custom': 42,
        'Bool-custom': true,
        'Null-custom': null,
        'Object-custom': { nested: 'value' },
      };

      const collection = CustomTrailerCollection.fromRaw(raw);

      expect(collection.size).toBe(1);
      expect(collection.get('Valid-custom')).toEqual(['value']);
    });

    it('should filter non-string values from arrays', () => {
      const raw = {
        'Mixed-array': ['valid', 42, 'also valid', null, true],
      };

      const collection = CustomTrailerCollection.fromRaw(raw);

      expect(collection.get('Mixed-array')).toEqual(['valid', 'also valid']);
    });

    it('should skip empty arrays', () => {
      const raw = {
        'Empty-array': [],
      };

      const collection = CustomTrailerCollection.fromRaw(raw);

      expect(collection.isEmpty).toBe(true);
    });

    it('should return empty() singleton when no custom keys exist', () => {
      const raw = {
        Confidence: 'high',
      };

      const collection = CustomTrailerCollection.fromRaw(raw);

      expect(collection).toBe(CustomTrailerCollection.empty());
    });

    it('should return empty() singleton for empty input', () => {
      const collection = CustomTrailerCollection.fromRaw({});

      expect(collection).toBe(CustomTrailerCollection.empty());
    });
  });

  describe('has', () => {
    it('should return true for an existing key with values', () => {
      const collection = new CustomTrailerCollection(
        new Map([['Team', ['platform']]]),
      );

      expect(collection.has('Team')).toBe(true);
    });

    it('should return false for a non-existent key', () => {
      const collection = new CustomTrailerCollection(
        new Map([['Team', ['platform']]]),
      );

      expect(collection.has('Missing')).toBe(false);
    });

    it('should return false for a key with an empty array', () => {
      const collection = new CustomTrailerCollection(
        new Map([['Team', []]]),
      );

      expect(collection.has('Team')).toBe(false);
    });
  });

  describe('get', () => {
    it('should return the values for an existing key', () => {
      const collection = new CustomTrailerCollection(
        new Map([['Team', ['platform', 'infra']]]),
      );

      expect(collection.get('Team')).toEqual(['platform', 'infra']);
    });

    it('should return undefined for a non-existent key', () => {
      const collection = CustomTrailerCollection.empty();

      expect(collection.get('Missing')).toBeUndefined();
    });
  });

  describe('lineCount', () => {
    it('should return 0 for empty collection', () => {
      expect(CustomTrailerCollection.empty().lineCount).toBe(0);
    });

    it('should count total values across all keys', () => {
      const collection = new CustomTrailerCollection(
        new Map([
          ['Team', ['platform']],
          ['Ticket', ['PROJ-123', 'PROJ-456']],
          ['Reviewer', ['alice', 'bob', 'carol']],
        ]),
      );

      expect(collection.lineCount).toBe(6);
    });

    it('should count single values correctly', () => {
      const collection = new CustomTrailerCollection(
        new Map([['Team', ['platform']]]),
      );

      expect(collection.lineCount).toBe(1);
    });
  });

  describe('size', () => {
    it('should return 0 for empty collection', () => {
      expect(CustomTrailerCollection.empty().size).toBe(0);
    });

    it('should return the number of distinct keys', () => {
      const collection = new CustomTrailerCollection(
        new Map([
          ['Team', ['platform']],
          ['Ticket', ['PROJ-123', 'PROJ-456']],
        ]),
      );

      expect(collection.size).toBe(2);
    });
  });

  describe('isEmpty', () => {
    it('should return true for empty collection', () => {
      expect(CustomTrailerCollection.empty().isEmpty).toBe(true);
    });

    it('should return false for non-empty collection', () => {
      const collection = new CustomTrailerCollection(
        new Map([['Team', ['platform']]]),
      );

      expect(collection.isEmpty).toBe(false);
    });
  });

  describe('toRecord', () => {
    it('should convert to a plain object', () => {
      const collection = new CustomTrailerCollection(
        new Map([
          ['Team', ['platform']],
          ['Ticket', ['PROJ-123', 'PROJ-456']],
        ]),
      );

      expect(collection.toRecord()).toEqual({
        Team: ['platform'],
        Ticket: ['PROJ-123', 'PROJ-456'],
      });
    });

    it('should return empty object for empty collection', () => {
      expect(CustomTrailerCollection.empty().toRecord()).toEqual({});
    });

    it('should round-trip through fromRaw and toRecord', () => {
      const raw = {
        'Assisted-by': ['Claude:CLI'],
        Ticket: ['PROJ-123', 'PROJ-456'],
      };

      const collection = CustomTrailerCollection.fromRaw(raw);
      const record = collection.toRecord();

      expect(record).toEqual({
        'Assisted-by': ['Claude:CLI'],
        Ticket: ['PROJ-123', 'PROJ-456'],
      });
    });
  });

  describe('Symbol.iterator', () => {
    it('should support spread into array', () => {
      const collection = new CustomTrailerCollection(
        new Map([
          ['Team', ['platform']],
          ['Ticket', ['PROJ-123']],
        ]),
      );

      const entries = [...collection];

      expect(entries).toEqual([
        ['Team', ['platform']],
        ['Ticket', ['PROJ-123']],
      ]);
    });

    it('should produce no entries for empty collection', () => {
      const entries = [...CustomTrailerCollection.empty()];

      expect(entries).toEqual([]);
    });

    it('should work with for...of loops', () => {
      const collection = new CustomTrailerCollection(
        new Map([['Key', ['value']]]),
      );

      const keys: string[] = [];
      for (const [key] of collection) {
        keys.push(key);
      }

      expect(keys).toEqual(['Key']);
    });
  });
});
