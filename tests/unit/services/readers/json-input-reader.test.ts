import { describe, it, expect } from 'vitest';
import { JsonInputReader } from '../../../../src/services/readers/json-input-reader.js';

describe('JsonInputReader', () => {
  describe('valid JSON', () => {
    it('should parse a complete JSON input with all trailers', async () => {
      const input = {
        intent: 'fix bug in parser',
        body: 'Detailed explanation',
        trailers: {
          Constraint: ['must preserve backward compat'],
          Rejected: ['approach A | too complex'],
          Confidence: 'medium',
          'Scope-risk': 'narrow',
          Reversibility: 'clean',
          Directive: ['use new API'],
          Tested: ['unit tests pass'],
          'Not-tested': ['load testing'],
          Supersedes: ['abcd1234'],
          'Depends-on': ['dead0000'],
          Related: ['beef1234'],
        },
      };

      const reader = new JsonInputReader(JSON.stringify(input));
      const result = await reader.read();

      expect(result.intent).toBe('fix bug in parser');
      expect(result.body).toBe('Detailed explanation');
      expect(result.trailers?.Constraint).toEqual(['must preserve backward compat']);
      expect(result.trailers?.Rejected).toEqual(['approach A | too complex']);
      expect(result.trailers?.Confidence).toBe('medium');
      expect(result.trailers?.['Scope-risk']).toBe('narrow');
      expect(result.trailers?.Reversibility).toBe('clean');
      expect(result.trailers?.Directive).toEqual(['use new API']);
      expect(result.trailers?.Tested).toEqual(['unit tests pass']);
      expect(result.trailers?.['Not-tested']).toEqual(['load testing']);
      expect(result.trailers?.Supersedes).toEqual(['abcd1234']);
      expect(result.trailers?.['Depends-on']).toEqual(['dead0000']);
      expect(result.trailers?.Related).toEqual(['beef1234']);
    });

    it('should parse minimal JSON with only intent', async () => {
      const input = { intent: 'minimal commit' };

      const reader = new JsonInputReader(JSON.stringify(input));
      const result = await reader.read();

      expect(result.intent).toBe('minimal commit');
      expect(result.body).toBeUndefined();
      expect(result.trailers).toBeUndefined();
    });

    it('should parse JSON with intent and body but no trailers', async () => {
      const input = { intent: 'with body', body: 'Some body text' };

      const reader = new JsonInputReader(JSON.stringify(input));
      const result = await reader.read();

      expect(result.intent).toBe('with body');
      expect(result.body).toBe('Some body text');
      expect(result.trailers).toBeUndefined();
    });

    it('should parse JSON with empty trailers object', async () => {
      const input = { intent: 'with empty trailers', trailers: {} };

      const reader = new JsonInputReader(JSON.stringify(input));
      const result = await reader.read();

      expect(result.intent).toBe('with empty trailers');
      expect(result.trailers).toBeDefined();
      expect(result.trailers?.Constraint).toBeUndefined();
      expect(result.trailers?.Confidence).toBeUndefined();
    });

    it('should default intent to empty string when not a string', async () => {
      const input = { intent: 123 };

      const reader = new JsonInputReader(JSON.stringify(input));
      const result = await reader.read();

      expect(result.intent).toBe('');
    });

    it('should ignore body when not a string', async () => {
      const input = { intent: 'test', body: 42 };

      const reader = new JsonInputReader(JSON.stringify(input));
      const result = await reader.read();

      expect(result.body).toBeUndefined();
    });
  });

  describe('array parsing', () => {
    it('should filter non-string values from arrays', async () => {
      const input = {
        intent: 'test',
        trailers: {
          Constraint: ['valid', 123, 'also valid', null, true],
        },
      };

      const reader = new JsonInputReader(JSON.stringify(input));
      const result = await reader.read();

      expect(result.trailers?.Constraint).toEqual(['valid', 'also valid']);
    });

    it('should coerce a single string trailer value to an array', async () => {
      const input = {
        intent: 'test',
        trailers: {
          Constraint: 'single constraint',
          Directive: '[until:2026-06] Remove before release',
        },
      };

      const reader = new JsonInputReader(JSON.stringify(input));
      const result = await reader.read();

      expect(result.trailers?.Constraint).toEqual(['single constraint']);
      expect(result.trailers?.Directive).toEqual(['[until:2026-06] Remove before release']);
    });

    it('should return undefined for non-string non-array trailer values', async () => {
      const input = {
        intent: 'test',
        trailers: {
          Constraint: 42,
        },
      };

      const reader = new JsonInputReader(JSON.stringify(input));
      const result = await reader.read();

      expect(result.trailers?.Constraint).toBeUndefined();
    });
  });

  describe('custom trailers', () => {
    it('should collect unknown trailer keys as custom trailers', async () => {
      const input = {
        intent: 'test',
        trailers: {
          'Assisted-by': 'Gemini:CLI',
          Confidence: 'high',
        },
      };

      const reader = new JsonInputReader(JSON.stringify(input));
      const result = await reader.read();

      expect(result.trailers?.custom).toEqual({ 'Assisted-by': ['Gemini:CLI'] });
      expect(result.trailers?.Confidence).toBe('high');
    });

    it('should collect multiple custom trailers', async () => {
      const input = {
        intent: 'test',
        trailers: {
          'Assisted-by': 'Gemini:CLI',
          'Ticket': ['PROJ-123', 'PROJ-456'],
          Constraint: ['some constraint'],
        },
      };

      const reader = new JsonInputReader(JSON.stringify(input));
      const result = await reader.read();

      expect(result.trailers?.custom?.['Assisted-by']).toEqual(['Gemini:CLI']);
      expect(result.trailers?.custom?.['Ticket']).toEqual(['PROJ-123', 'PROJ-456']);
      expect(result.trailers?.Constraint).toEqual(['some constraint']);
    });

    it('should not include custom field when no unknown trailers exist', async () => {
      const input = {
        intent: 'test',
        trailers: {
          Confidence: 'high',
        },
      };

      const reader = new JsonInputReader(JSON.stringify(input));
      const result = await reader.read();

      expect(result.trailers?.custom).toBeUndefined();
    });

    it('should skip custom trailers with non-string values', async () => {
      const input = {
        intent: 'test',
        trailers: {
          'Valid-custom': 'value',
          'Invalid-custom': 42,
        },
      };

      const reader = new JsonInputReader(JSON.stringify(input));
      const result = await reader.read();

      expect(result.trailers?.custom?.['Valid-custom']).toEqual(['value']);
      expect(result.trailers?.custom?.['Invalid-custom']).toBeUndefined();
    });
  });

  describe('enum parsing', () => {
    it('should return string values for enum trailers', async () => {
      const input = {
        intent: 'test',
        trailers: {
          Confidence: 'high',
          'Scope-risk': 'wide',
          Reversibility: 'irreversible',
        },
      };

      const reader = new JsonInputReader(JSON.stringify(input));
      const result = await reader.read();

      expect(result.trailers?.Confidence).toBe('high');
      expect(result.trailers?.['Scope-risk']).toBe('wide');
      expect(result.trailers?.Reversibility).toBe('irreversible');
    });

    it('should return undefined for non-string enum values', async () => {
      const input = {
        intent: 'test',
        trailers: {
          Confidence: 42,
          'Scope-risk': true,
          Reversibility: null,
        },
      };

      const reader = new JsonInputReader(JSON.stringify(input));
      const result = await reader.read();

      expect(result.trailers?.Confidence).toBeUndefined();
      expect(result.trailers?.['Scope-risk']).toBeUndefined();
      expect(result.trailers?.Reversibility).toBeUndefined();
    });
  });

  describe('invalid JSON', () => {
    it('should throw on malformed JSON', async () => {
      const reader = new JsonInputReader('not valid json {{{');

      await expect(reader.read()).rejects.toThrow();
    });

    it('should throw on empty string', async () => {
      const reader = new JsonInputReader('');

      await expect(reader.read()).rejects.toThrow();
    });
  });
});
