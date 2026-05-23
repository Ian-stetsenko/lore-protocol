import { describe, it, expect, beforeEach } from 'vitest';
import { Protocol } from '../../../src/services/protocol.js';
import { TrailerParser } from '../../../src/services/trailer-parser.js';
import { JsonFormatter } from '../../../src/formatters/json-formatter.js';
import { DEFAULT_CONFIG } from '../../../src/util/constants.js';
import { LORE_ID_KEY } from '../../../src/util/constants.js';
import type { FormattableQueryResult } from '../../../src/types/output.js';

/**
 * Targeted tests for the boundaries and edge cases of the Flat & Uniform Protocol.
 */
describe('Flat Protocol Boundaries', () => {
  describe('Canonical Ordering', () => {
    it('should always serialize in protocol-defined order regardless of insertion order', () => {
      const protocol = new Protocol(DEFAULT_CONFIG);
      const parser = new TrailerParser(protocol);

      // Input in "wrong" order
      const trailers = {
        'Tested': ['T1'],
        'Confidence': ['high'],
        [LORE_ID_KEY]: ['id123'],
        'Constraint': ['C1'],
        'My-Custom': ['Val']
      } as any;

      const output = parser.serialize(trailers);
      const lines = output.split('\n');

      // Canonical order from core-definitions.ts: 
      // Lore-id (always first) -> Constraint -> Confidence -> Tested -> Custom
      expect(lines[0]).toBe(`${LORE_ID_KEY}: id123`);
      expect(lines[1]).toBe('Constraint: C1');
      expect(lines[2]).toBe('Confidence: high');
      expect(lines[3]).toBe('Tested: T1');
      expect(lines[4]).toBe('My-Custom: Val');
    });
  });

  describe('JSON Normalization Matrix', () => {
    it('should correctly coerce core scalars and preserve all other arrays', () => {
      const protocol = new Protocol(DEFAULT_CONFIG);
      const formatter = new JsonFormatter();
      const atom = {
        loreId: 'id',
        commitHash: 'h',
        date: new Date(),
        author: 'a',
        intent: 'i',
        body: '',
        trailers: {
          [LORE_ID_KEY]: ['id'],
          'Confidence': ['high'],      // Scalar core
          'Constraint': ['C1', 'C2'],  // Array core
          'Tested': ['T1'],            // Array core (single value)
          'Custom': ['V1'],            // Custom (defaults to array)
        } as any,
        filesChanged: []
      };

      const data: FormattableQueryResult = {
        result: { atoms: [atom], meta: { totalAtoms: 1, filteredAtoms: 1, oldest: null, newest: null }, command: 'c', target: 't', targetType: 'file' },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
        trailerDefinitions: protocol.getFormattableDefinitions(),
      };

      const output = JSON.parse(formatter.formatQueryResult(data));
      const trailers = output.results[0].trailers;

      expect(trailers.confidence).toBe('high');        // Coerced to scalar
      expect(trailers.constraint).toEqual(['C1', 'C2']); // Remained array
      expect(trailers.tested).toEqual(['T1']);           // Remained array (it is an ARRAY core type)
      expect(trailers.custom).toEqual(['V1']);           // Remained array
    });
  });

  describe('Strict Mode Boundaries', () => {
    it('should strictly prune unauthorized custom trailers in non-permissive mode', () => {
      const config = {
        ...DEFAULT_CONFIG,
        trailers: { ...DEFAULT_CONFIG.trailers, permissive: false, custom: ['Authorized'] }
      };
      const protocol = new Protocol(config);
      const parser = new TrailerParser(protocol);

      const raw = `${LORE_ID_KEY}: abc\nAuthorized: yes\nUnauthorized: no`;
      const parsed = parser.parse(raw);

      expect(parsed['Authorized']).toEqual(['yes']);
      expect(parsed['Unauthorized']).toBeUndefined();
      
      const serialized = parser.serialize(parsed);
      expect(serialized).not.toContain('Unauthorized');
    });
  });

  describe('Key Case Resilience', () => {
    it('should treat trailers as case-insensitive for core mapping', () => {
      const protocol = new Protocol(DEFAULT_CONFIG);
      const parser = new TrailerParser(protocol);

      // User provides lowercase 'confidence'
      const raw = `${LORE_ID_KEY}: abc\nconfidence: low`;
      const parsed = parser.parse(raw);

      // Should be mapped to the canonical PascalCase key
      expect(parsed['Confidence']).toEqual(['low']);
      
      const serialized = parser.serialize(parsed);
      expect(serialized).toContain('Confidence: low');
      expect(serialized).not.toContain('confidence:');
    });
  });
});
