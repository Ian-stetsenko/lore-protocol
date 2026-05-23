import { describe, it, expect, beforeEach } from 'vitest';
import { TrailerParser } from '../../../src/services/trailer-parser.js';
import { LORE_ID_KEY } from '../../../src/util/constants.js';
import { Protocol } from '../../../src/services/protocol.js';
import { DEFAULT_CONFIG } from '../../../src/util/constants.js';
import type { LoreTrailers } from '../../../src/types/domain.js';

describe('TrailerParser', () => {
  let parser: TrailerParser;
  let protocol: Protocol;

  beforeEach(() => {
    protocol = new Protocol(DEFAULT_CONFIG);
    parser = new TrailerParser(protocol);
  });

  describe('parse', () => {
    it('should parse a ${LORE_ID_KEY} trailer', () => {
      const raw = `${LORE_ID_KEY}: a1b2c3d4`;
      const result = parser.parse(raw);
      expect(result[LORE_ID_KEY]).toEqual(['a1b2c3d4']);
    });

    it('should parse array trailers into arrays', () => {
      const raw = [
        `${LORE_ID_KEY}: abcd1234`,
        'Constraint: Must use UTF-8 encoding',
        'Constraint: Max 1000 records per batch',
      ].join('\n');
      const result = parser.parse(raw);
      expect(result.Constraint).toEqual([
        'Must use UTF-8 encoding',
        'Max 1000 records per batch',
      ]);
    });

    it('should parse all array trailer types', () => {
      const raw = [
        `${LORE_ID_KEY}: abcd1234`,
        'Constraint: constraint value',
        'Rejected: rejected value',
        'Directive: directive value',
        'Tested: tested value',
        'Not-tested: not-tested value',
        'Supersedes: 11112222',
        'Depends-on: 33334444',
        'Related: 55556666',
      ].join('\n');
      const result = parser.parse(raw);
      expect(result.Constraint).toEqual(['constraint value']);
      expect(result.Rejected).toEqual(['rejected value']);
      expect(result.Directive).toEqual(['directive value']);
      expect(result.Tested).toEqual(['tested value']);
      expect(result['Not-tested']).toEqual(['not-tested value']);
      expect(result.Supersedes).toEqual(['11112222']);
      expect(result['Depends-on']).toEqual(['33334444']);
      expect(result.Related).toEqual(['55556666']);
    });

    it('should parse enum trailers', () => {
      const raw = [
        `${LORE_ID_KEY}: abcd1234`,
        'Confidence: high',
        'Scope-risk: narrow',
        'Reversibility: clean',
      ].join('\n');
      const result = parser.parse(raw);
      expect(result.Confidence).toEqual(['high']);
      expect(result['Scope-risk']).toEqual(['narrow']);
      expect(result.Reversibility).toEqual(['clean']);
    });

    it('should accept all valid Confidence values', () => {
      for (const val of ['low', 'medium', 'high']) {
        const raw = `${LORE_ID_KEY}: abcd1234\nConfidence: ${val}`;
        const result = parser.parse(raw);
        expect(result.Confidence).toEqual([val]);
      }
    });

    it('should accept all valid Scope-risk values', () => {
      for (const val of ['narrow', 'moderate', 'wide']) {
        const raw = `${LORE_ID_KEY}: abcd1234\nScope-risk: ${val}`;
        const result = parser.parse(raw);
        expect(result['Scope-risk']).toEqual([val]);
      }
    });

    it('should accept all valid Reversibility values', () => {
      for (const val of ['clean', 'migration-needed', 'irreversible']) {
        const raw = `${LORE_ID_KEY}: abcd1234\nReversibility: ${val}`;
        const result = parser.parse(raw);
        expect(result.Reversibility).toEqual([val]);
      }
    });

    it('should ignore invalid enum values', () => {
      const raw = [
        `${LORE_ID_KEY}: abcd1234`,
        'Confidence: INVALID',
        'Scope-risk: bogus',
        'Reversibility: nope',
      ].join('\n');
      const result = parser.parse(raw);
      expect(result.Confidence).toEqual([]);
      expect(result['Scope-risk']).toEqual([]);
      expect(result.Reversibility).toEqual([]);
    });

    it('should return empty arrays for missing enum trailers', () => {
      const raw = `${LORE_ID_KEY}: abcd1234`;
      const result = parser.parse(raw);
      expect(result.Confidence).toEqual([]);
      expect(result['Scope-risk']).toEqual([]);
      expect(result.Reversibility).toEqual([]);
    });

    it('should return empty arrays for missing array trailers', () => {
      const raw = `${LORE_ID_KEY}: abcd1234`;
      const result = parser.parse(raw);
      expect(result.Constraint).toEqual([]);
      expect(result.Rejected).toEqual([]);
      expect(result.Directive).toEqual([]);
      expect(result.Tested).toEqual([]);
      expect(result['Not-tested']).toEqual([]);
      expect(result.Supersedes).toEqual([]);
      expect(result['Depends-on']).toEqual([]);
      expect(result.Related).toEqual([]);
    });

    it('should handle continuation lines', () => {
      const raw = [
        `${LORE_ID_KEY}: abcd1234`,
        'Constraint: This is a long constraint that',
        '  continues on the next line',
      ].join('\n');
      const result = parser.parse(raw);
      expect(result.Constraint).toEqual([
        'This is a long constraint that continues on the next line',
      ]);
    });

    it('should handle continuation lines with tabs', () => {
      const raw = [
        `${LORE_ID_KEY}: abcd1234`,
        'Constraint: First part',
        '\tsecond part',
      ].join('\n');
      const result = parser.parse(raw);
      expect(result.Constraint).toEqual(['First part second part']);
    });

    it('should handle multiple continuation lines', () => {
      const raw = [
        `${LORE_ID_KEY}: abcd1234`,
        'Constraint: Line 1',
        '  Line 2',
        '  Line 3',
      ].join('\n');
      const result = parser.parse(raw);
      expect(result.Constraint).toEqual(['Line 1 Line 2 Line 3']);
    });

    it('should parse custom trailers in permissive mode (default)', () => {
      const raw = [
        `${LORE_ID_KEY}: abcd1234`,
        'My-custom: value1',
        'My-custom: value2',
      ].join('\n');
      const result = parser.parse(raw);
      expect(result['My-custom']).toEqual(['value1', 'value2']);
    });

    it('should handle empty input', () => {
      const result = parser.parse('');
      expect(result[LORE_ID_KEY]).toEqual([]);
      expect(result.Constraint).toEqual([]);
    });

    it('should handle whitespace-only input', () => {
      const result = parser.parse('   \n  \n  ');
      expect(result[LORE_ID_KEY]).toEqual([]);
    });

    it('should trim trailer values', () => {
      const raw = `${LORE_ID_KEY}:   abcd1234   `;
      const result = parser.parse(raw);
      expect(result[LORE_ID_KEY]).toEqual(['abcd1234']);
    });

    it('should handle unicode in trailer values', () => {
      const raw = [
        `${LORE_ID_KEY}: abcd1234`,
        'Constraint: Must support emoji \u{1F680} and CJK \u4E16\u754C',
      ].join('\n');
      const result = parser.parse(raw);
      expect(result.Constraint).toEqual(['Must support emoji \u{1F680} and CJK \u4E16\u754C']);
    });

    it('should handle trailers with colons in the value', () => {
      const raw = [
        `${LORE_ID_KEY}: abcd1234`,
        'Constraint: Time format: HH:MM:SS',
      ].join('\n');
      const result = parser.parse(raw);
      expect(result.Constraint).toEqual(['Time format: HH:MM:SS']);
    });

    it('should skip blank lines between trailers', () => {
      const raw = [
        `${LORE_ID_KEY}: abcd1234`,
        '',
        'Constraint: value',
      ].join('\n');
      const result = parser.parse(raw);
      expect(result[LORE_ID_KEY]).toEqual(['abcd1234']);
      expect(result.Constraint).toEqual(['value']);
    });

    it('should handle a full realistic trailer block', () => {
      const raw = [
        `${LORE_ID_KEY}: a7f3b2c1`,
        'Constraint: PostgreSQL >= 14 required for JSONB subscript syntax',
        'Constraint: All timestamps must be stored as UTC',
        'Rejected: MongoDB -- lacks transactional guarantees across collections',
        'Confidence: high',
        'Scope-risk: moderate',
        'Reversibility: migration-needed',
        'Directive: [until:2025-06] Review when PostgreSQL 17 releases',
        'Tested: Integration test: test_db_connection_pool',
        'Supersedes: b3e4f5a6',
        'Depends-on: c1d2e3f4',
        'Related: d4e5f6a7',
      ].join('\n');
      const result = parser.parse(raw);
      expect(result[LORE_ID_KEY]).toEqual(['a7f3b2c1']);
      expect(result.Constraint).toHaveLength(2);
      expect(result.Rejected).toHaveLength(1);
      expect(result.Confidence).toEqual(['high']);
      expect(result['Scope-risk']).toEqual(['moderate']);
      expect(result.Reversibility).toEqual(['migration-needed']);
      expect(result.Directive).toHaveLength(1);
      expect(result.Tested).toHaveLength(1);
      expect(result.Supersedes).toEqual(['b3e4f5a6']);
      expect(result['Depends-on']).toEqual(['c1d2e3f4']);
      expect(result.Related).toEqual(['d4e5f6a7']);
    });
  });

  describe('serialize', () => {
    it('should serialize ${LORE_ID_KEY}', () => {
      const trailers = makeTrailers({ [LORE_ID_KEY]: ['abcd1234'] });
      const result = parser.serialize(trailers);
      expect(result).toContain(`${LORE_ID_KEY}: abcd1234`);
    });

    it('should serialize array trailers', () => {
      const trailers = makeTrailers({
        Constraint: ['First constraint', 'Second constraint'],
      });
      const result = parser.serialize(trailers);
      expect(result).toContain('Constraint: First constraint');
      expect(result).toContain('Constraint: Second constraint');
    });

    it('should serialize enum trailers', () => {
      const trailers = makeTrailers({
        Confidence: ['high'],
        'Scope-risk': ['wide'],
        Reversibility: ['irreversible'],
      });
      const result = parser.serialize(trailers);
      expect(result).toContain('Confidence: high');
      expect(result).toContain('Scope-risk: wide');
      expect(result).toContain('Reversibility: irreversible');
    });

    it('should not serialize empty trailers', () => {
      const trailers = makeTrailers({ Confidence: [] });
      const result = parser.serialize(trailers);
      expect(result).not.toContain('Confidence:');
    });

    it('should serialize custom trailers', () => {
      const trailers = makeTrailers({
        'Team': ['platform'],
        'Ticket': ['PROJ-123', 'PROJ-456'],
      });
      const result = parser.serialize(trailers);
      expect(result).toContain('Team: platform');
      expect(result).toContain('Ticket: PROJ-123');
      expect(result).toContain('Ticket: PROJ-456');
    });

    it('should not serialize empty ${LORE_ID_KEY}', () => {
      const trailers = makeTrailers({ [LORE_ID_KEY]: [] });
      const result = parser.serialize(trailers);
      expect(result).not.toContain(`${LORE_ID_KEY}:`);
    });

    it('should output ${LORE_ID_KEY} first', () => {
      const trailers = makeTrailers({
        [LORE_ID_KEY]: ['abcd1234'],
        Constraint: ['a constraint'],
      });
      const result = parser.serialize(trailers);
      const lines = result.split('\n');
      expect(lines[0]).toBe(`${LORE_ID_KEY}: abcd1234`);
    });

    it('should produce one line per array entry', () => {
      const trailers = makeTrailers({
        [LORE_ID_KEY]: ['abcd1234'],
        Rejected: ['Option A', 'Option B', 'Option C'],
      });
      const result = parser.serialize(trailers);
      const rejectedLines = result.split('\n').filter(l => l.startsWith('Rejected:'));
      expect(rejectedLines).toHaveLength(3);
    });
  });

  describe('parse/serialize roundtrip', () => {
    it('should roundtrip a full trailer block in canonical order', () => {
      const original = [
        `${LORE_ID_KEY}: a7f3b2c1`,
        'Constraint: PostgreSQL >= 14 required',
        'Constraint: All timestamps UTC',
        'Rejected: MongoDB -- no transactions',
        'Confidence: high',
        'Scope-risk: moderate',
        'Reversibility: clean',
        'Directive: Review in Q3',
        'Tested: integration test suite',
        'Not-tested: performance under load',
        'Supersedes: b3e4f5a6',
        'Depends-on: c1d2e3f4',
        'Related: d4e5f6a7',
      ].join('\n');

      const parsed = parser.parse(original);
      const serialized = parser.serialize(parsed);

      // Re-parse the serialized output
      const reparsed = parser.parse(serialized);

      expect(reparsed[LORE_ID_KEY]).toEqual(parsed[LORE_ID_KEY]);
      expect(reparsed.Constraint).toEqual(parsed.Constraint);
      expect(reparsed.Rejected).toEqual(parsed.Rejected);
      expect(reparsed.Confidence).toEqual(parsed.Confidence);
      expect(reparsed['Scope-risk']).toEqual(parsed['Scope-risk']);
      expect(reparsed.Reversibility).toEqual(parsed.Reversibility);
      expect(reparsed.Directive).toEqual(parsed.Directive);
      expect(reparsed.Tested).toEqual(parsed.Tested);
      expect(reparsed['Not-tested']).toEqual(parsed['Not-tested']);
      expect(reparsed.Supersedes).toEqual(parsed.Supersedes);
      expect(reparsed['Depends-on']).toEqual(parsed['Depends-on']);
      expect(reparsed.Related).toEqual(parsed.Related);
    });

    it('should roundtrip with custom trailers', () => {
      const original = [
        `${LORE_ID_KEY}: abcd1234`,
        'My-trailer: custom value',
      ].join('\n');

      const parsed = parser.parse(original);
      const serialized = parser.serialize(parsed);
      const reparsed = parser.parse(serialized);

      expect(reparsed['My-trailer']).toEqual(['custom value']);
    });
  });

  describe('containsLoreTrailers', () => {
    it('should return true when text contains ${LORE_ID_KEY}', () => {
      expect(parser.containsLoreTrailers(`${LORE_ID_KEY}: abcd1234`)).toBe(true);
    });

    it('should return true when text contains a Constraint trailer', () => {
      expect(parser.containsLoreTrailers('Constraint: Must be fast')).toBe(true);
    });

    it('should return true when text contains a Confidence trailer', () => {
      expect(parser.containsLoreTrailers('Confidence: high')).toBe(true);
    });

    it('should return false for plain text', () => {
      expect(parser.containsLoreTrailers('This is just regular text')).toBe(false);
    });

    it('should return false for empty text', () => {
      expect(parser.containsLoreTrailers('')).toBe(false);
    });

    it('should return false for non-Lore trailers in strict mode', () => {
       const strictConfig = {
        ...DEFAULT_CONFIG,
        trailers: { ...DEFAULT_CONFIG.trailers, permissive: false, definitions: {}, custom: [] }
      };
      const strictProtocol = new Protocol(strictConfig);
      const strictParser = new TrailerParser(strictProtocol);
      expect(strictParser.containsLoreTrailers('Signed-off-by: Someone')).toBe(false);
    });

    it('should return true when Lore trailers are mixed with non-Lore', () => {
      const text = [
        'Signed-off-by: Someone',
        `${LORE_ID_KEY}: abcd1234`,
      ].join('\n');
      expect(parser.containsLoreTrailers(text)).toBe(true);
    });

    it('should detect trailers in a full commit message', () => {
      const text = [
        'feat(db): add connection pooling',
        '',
        'Added PgBouncer-based connection pooling.',
        '',
        `${LORE_ID_KEY}: a1b2c3d4`,
        'Confidence: high',
      ].join('\n');
      expect(parser.containsLoreTrailers(text)).toBe(true);
    });
  });

  describe('extractTrailerBlock', () => {
    it('should extract the trailer block from a full commit message', () => {
      const message = [
        'feat(db): add connection pooling',
        '',
        'Added PgBouncer-based connection pooling.',
        '',
        `${LORE_ID_KEY}: a1b2c3d4`,
        'Constraint: PostgreSQL >= 14',
      ].join('\n');
      const result = parser.extractTrailerBlock(message);
      expect(result).toBe(`${LORE_ID_KEY}: a1b2c3d4\nConstraint: PostgreSQL >= 14`);
    });

    it('should return empty string when there are no trailers', () => {
      const message = [
        'feat(db): add connection pooling',
        '',
        'Added PgBouncer-based connection pooling.',
      ].join('\n');
      expect(parser.extractTrailerBlock(message)).toBe('');
    });

    it('should return empty string for empty input', () => {
      expect(parser.extractTrailerBlock('')).toBe('');
    });

    it('should handle message with only trailers (no body)', () => {
      const message = [
        'feat(db): add connection pooling',
        '',
        `${LORE_ID_KEY}: a1b2c3d4`,
        'Confidence: high',
      ].join('\n');
      const result = parser.extractTrailerBlock(message);
      expect(result).toBe(`${LORE_ID_KEY}: a1b2c3d4\nConfidence: high`);
    });

    it('should handle trailing whitespace', () => {
      const message = [
        'feat: something',
        '',
        `${LORE_ID_KEY}: a1b2c3d4`,
        '  ',
      ].join('\n');
      const result = parser.extractTrailerBlock(message);
      expect(result).toContain(`${LORE_ID_KEY}: a1b2c3d4`);
    });

    it('should handle multiple blank line separators', () => {
      const message = [
        'feat: something',
        '',
        '',
        'Body text here.',
        '',
        '',
        `${LORE_ID_KEY}: a1b2c3d4`,
      ].join('\n');
      const result = parser.extractTrailerBlock(message);
      expect(result).toBe(`${LORE_ID_KEY}: a1b2c3d4`);
    });

    it('should return empty if last paragraph is not all trailers', () => {
      const message = [
        'feat: something',
        '',
        'This is a regular paragraph, not trailers.',
        'Just some body text.',
      ].join('\n');
      expect(parser.extractTrailerBlock(message)).toBe('');
    });

    it('should handle trailer block with continuation lines', () => {
      const message = [
        'feat: something',
        '',
        `${LORE_ID_KEY}: a1b2c3d4`,
        'Constraint: A long constraint',
        '  that continues here',
      ].join('\n');
      const result = parser.extractTrailerBlock(message);
      expect(result).toContain(`${LORE_ID_KEY}: a1b2c3d4`);
      expect(result).toContain('Constraint: A long constraint');
      expect(result).toContain('  that continues here');
    });
  });
});

/**
 * Helper to create a LoreTrailers object with defaults and overrides.
 */
function makeTrailers(overrides: Partial<LoreTrailers>): LoreTrailers {
  return {
    [LORE_ID_KEY]: [],
    Constraint: [],
    Rejected: [],
    Confidence: [],
    'Scope-risk': [],
    Reversibility: [],
    Directive: [],
    Tested: [],
    'Not-tested': [],
    Supersedes: [],
    'Depends-on': [],
    Related: [],
    ...overrides,
  } as any;
}
