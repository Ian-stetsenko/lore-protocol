import { describe, it, expect } from 'vitest';
import { TrailerParser } from '../../../src/services/trailer-parser.js';

describe('TrailerParser', () => {
  const parser = new TrailerParser();

  describe('parse', () => {
    it('should parse a Lore-id trailer', () => {
      const raw = 'Lore-id: a1b2c3d4';
      const result = parser.parse(raw, []);
      expect(result['Lore-id']).toBe('a1b2c3d4');
    });

    it('should parse array trailers into arrays', () => {
      const raw = [
        'Lore-id: abcd1234',
        'Constraint: Must use UTF-8 encoding',
        'Constraint: Max 1000 records per batch',
      ].join('\n');
      const result = parser.parse(raw, []);
      expect(result.Constraint).toEqual([
        'Must use UTF-8 encoding',
        'Max 1000 records per batch',
      ]);
    });

    it('should parse all array trailer types', () => {
      const raw = [
        'Lore-id: abcd1234',
        'Constraint: constraint value',
        'Rejected: rejected value',
        'Directive: directive value',
        'Tested: tested value',
        'Not-tested: not-tested value',
        'Supersedes: 11112222',
        'Depends-on: 33334444',
        'Related: 55556666',
      ].join('\n');
      const result = parser.parse(raw, []);
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
        'Lore-id: abcd1234',
        'Confidence: high',
        'Scope-risk: narrow',
        'Reversibility: clean',
      ].join('\n');
      const result = parser.parse(raw, []);
      expect(result.Confidence).toBe('high');
      expect(result['Scope-risk']).toBe('narrow');
      expect(result.Reversibility).toBe('clean');
    });

    it('should accept all valid Confidence values', () => {
      for (const val of ['low', 'medium', 'high']) {
        const raw = `Lore-id: abcd1234\nConfidence: ${val}`;
        const result = parser.parse(raw, []);
        expect(result.Confidence).toBe(val);
      }
    });

    it('should accept all valid Scope-risk values', () => {
      for (const val of ['narrow', 'moderate', 'wide']) {
        const raw = `Lore-id: abcd1234\nScope-risk: ${val}`;
        const result = parser.parse(raw, []);
        expect(result['Scope-risk']).toBe(val);
      }
    });

    it('should accept all valid Reversibility values', () => {
      for (const val of ['clean', 'migration-needed', 'irreversible']) {
        const raw = `Lore-id: abcd1234\nReversibility: ${val}`;
        const result = parser.parse(raw, []);
        expect(result.Reversibility).toBe(val);
      }
    });

    it('should ignore invalid enum values', () => {
      const raw = [
        'Lore-id: abcd1234',
        'Confidence: INVALID',
        'Scope-risk: bogus',
        'Reversibility: nope',
      ].join('\n');
      const result = parser.parse(raw, []);
      expect(result.Confidence).toBeNull();
      expect(result['Scope-risk']).toBeNull();
      expect(result.Reversibility).toBeNull();
    });

    it('should return null for missing enum trailers', () => {
      const raw = 'Lore-id: abcd1234';
      const result = parser.parse(raw, []);
      expect(result.Confidence).toBeNull();
      expect(result['Scope-risk']).toBeNull();
      expect(result.Reversibility).toBeNull();
    });

    it('should return empty arrays for missing array trailers', () => {
      const raw = 'Lore-id: abcd1234';
      const result = parser.parse(raw, []);
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
        'Lore-id: abcd1234',
        'Constraint: This is a long constraint that',
        '  continues on the next line',
      ].join('\n');
      const result = parser.parse(raw, []);
      expect(result.Constraint).toEqual([
        'This is a long constraint that continues on the next line',
      ]);
    });

    it('should handle continuation lines with tabs', () => {
      const raw = [
        'Lore-id: abcd1234',
        'Constraint: First part',
        '\tsecond part',
      ].join('\n');
      const result = parser.parse(raw, []);
      expect(result.Constraint).toEqual(['First part second part']);
    });

    it('should handle multiple continuation lines', () => {
      const raw = [
        'Lore-id: abcd1234',
        'Constraint: Line 1',
        '  Line 2',
        '  Line 3',
      ].join('\n');
      const result = parser.parse(raw, []);
      expect(result.Constraint).toEqual(['Line 1 Line 2 Line 3']);
    });

    it('should parse custom trailers when customKeys is provided', () => {
      const raw = [
        'Lore-id: abcd1234',
        'My-custom: value1',
        'My-custom: value2',
      ].join('\n');
      const result = parser.parse(raw, ['My-custom']);
      expect(result.custom.get('My-custom')).toEqual(['value1', 'value2']);
    });

    it('should not parse custom trailers when they are not in customKeys', () => {
      const raw = [
        'Lore-id: abcd1234',
        'Unknown-key: value1',
      ].join('\n');
      const result = parser.parse(raw, ['Other-key']);
      expect(result.custom.has('Unknown-key')).toBe(false);
    });

    it('should accept any non-lore trailer when customKeys is empty', () => {
      const raw = [
        'Lore-id: abcd1234',
        'Whatever: value1',
      ].join('\n');
      const result = parser.parse(raw, []);
      expect(result.custom.get('Whatever')).toEqual(['value1']);
    });

    it('should handle empty input', () => {
      const result = parser.parse('', []);
      expect(result['Lore-id']).toBe('');
      expect(result.Constraint).toEqual([]);
      expect(result.custom.size).toBe(0);
    });

    it('should handle whitespace-only input', () => {
      const result = parser.parse('   \n  \n  ', []);
      expect(result['Lore-id']).toBe('');
    });

    it('should trim trailer values', () => {
      const raw = 'Lore-id:   abcd1234   ';
      const result = parser.parse(raw, []);
      expect(result['Lore-id']).toBe('abcd1234');
    });

    it('should handle unicode in trailer values', () => {
      const raw = [
        'Lore-id: abcd1234',
        'Constraint: Must support emoji \u{1F680} and CJK \u4E16\u754C',
      ].join('\n');
      const result = parser.parse(raw, []);
      expect(result.Constraint).toEqual(['Must support emoji \u{1F680} and CJK \u4E16\u754C']);
    });

    it('should handle trailers with colons in the value', () => {
      const raw = [
        'Lore-id: abcd1234',
        'Constraint: Time format: HH:MM:SS',
      ].join('\n');
      const result = parser.parse(raw, []);
      expect(result.Constraint).toEqual(['Time format: HH:MM:SS']);
    });

    it('should skip blank lines between trailers', () => {
      const raw = [
        'Lore-id: abcd1234',
        '',
        'Constraint: value',
      ].join('\n');
      const result = parser.parse(raw, []);
      expect(result['Lore-id']).toBe('abcd1234');
      expect(result.Constraint).toEqual(['value']);
    });

    it('should handle a full realistic trailer block', () => {
      const raw = [
        'Lore-id: a7f3b2c1',
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
      const result = parser.parse(raw, []);
      expect(result['Lore-id']).toBe('a7f3b2c1');
      expect(result.Constraint).toHaveLength(2);
      expect(result.Rejected).toHaveLength(1);
      expect(result.Confidence).toBe('high');
      expect(result['Scope-risk']).toBe('moderate');
      expect(result.Reversibility).toBe('migration-needed');
      expect(result.Directive).toHaveLength(1);
      expect(result.Tested).toHaveLength(1);
      expect(result.Supersedes).toEqual(['b3e4f5a6']);
      expect(result['Depends-on']).toEqual(['c1d2e3f4']);
      expect(result.Related).toEqual(['d4e5f6a7']);
    });
  });

  describe('serialize', () => {
    it('should serialize Lore-id', () => {
      const trailers = makeTrailers({ 'Lore-id': 'abcd1234' });
      const result = parser.serialize(trailers);
      expect(result).toContain('Lore-id: abcd1234');
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
        Confidence: 'high',
        'Scope-risk': 'wide',
        Reversibility: 'irreversible',
      });
      const result = parser.serialize(trailers);
      expect(result).toContain('Confidence: high');
      expect(result).toContain('Scope-risk: wide');
      expect(result).toContain('Reversibility: irreversible');
    });

    it('should not serialize null enum trailers', () => {
      const trailers = makeTrailers({ Confidence: null });
      const result = parser.serialize(trailers);
      expect(result).not.toContain('Confidence:');
    });

    it('should not serialize empty array trailers', () => {
      const trailers = makeTrailers({});
      const result = parser.serialize(trailers);
      expect(result).not.toContain('Constraint:');
      expect(result).not.toContain('Rejected:');
    });

    it('should serialize custom trailers', () => {
      const custom = new Map<string, readonly string[]>();
      custom.set('Team', ['platform']);
      custom.set('Ticket', ['PROJ-123', 'PROJ-456']);
      const trailers = makeTrailers({ custom });
      const result = parser.serialize(trailers);
      expect(result).toContain('Team: platform');
      expect(result).toContain('Ticket: PROJ-123');
      expect(result).toContain('Ticket: PROJ-456');
    });

    it('should not serialize empty Lore-id', () => {
      const trailers = makeTrailers({ 'Lore-id': '' });
      const result = parser.serialize(trailers);
      expect(result).not.toContain('Lore-id:');
    });

    it('should output Lore-id first', () => {
      const trailers = makeTrailers({
        'Lore-id': 'abcd1234',
        Constraint: ['a constraint'],
      });
      const result = parser.serialize(trailers);
      const lines = result.split('\n');
      expect(lines[0]).toBe('Lore-id: abcd1234');
    });

    it('should produce one line per array entry', () => {
      const trailers = makeTrailers({
        'Lore-id': 'abcd1234',
        Rejected: ['Option A', 'Option B', 'Option C'],
      });
      const result = parser.serialize(trailers);
      const rejectedLines = result.split('\n').filter(l => l.startsWith('Rejected:'));
      expect(rejectedLines).toHaveLength(3);
    });
  });

  describe('parse/serialize roundtrip', () => {
    it('should roundtrip a full trailer block', () => {
      const original = [
        'Lore-id: a7f3b2c1',
        'Constraint: PostgreSQL >= 14 required',
        'Constraint: All timestamps UTC',
        'Rejected: MongoDB -- no transactions',
        'Directive: Review in Q3',
        'Tested: integration test suite',
        'Not-tested: performance under load',
        'Supersedes: b3e4f5a6',
        'Depends-on: c1d2e3f4',
        'Related: d4e5f6a7',
        'Confidence: high',
        'Scope-risk: moderate',
        'Reversibility: clean',
      ].join('\n');

      const parsed = parser.parse(original, []);
      const serialized = parser.serialize(parsed);

      // Re-parse the serialized output
      const reparsed = parser.parse(serialized, []);

      expect(reparsed['Lore-id']).toBe(parsed['Lore-id']);
      expect(reparsed.Constraint).toEqual(parsed.Constraint);
      expect(reparsed.Rejected).toEqual(parsed.Rejected);
      expect(reparsed.Confidence).toBe(parsed.Confidence);
      expect(reparsed['Scope-risk']).toBe(parsed['Scope-risk']);
      expect(reparsed.Reversibility).toBe(parsed.Reversibility);
      expect(reparsed.Directive).toEqual(parsed.Directive);
      expect(reparsed.Tested).toEqual(parsed.Tested);
      expect(reparsed['Not-tested']).toEqual(parsed['Not-tested']);
      expect(reparsed.Supersedes).toEqual(parsed.Supersedes);
      expect(reparsed['Depends-on']).toEqual(parsed['Depends-on']);
      expect(reparsed.Related).toEqual(parsed.Related);
    });

    it('should roundtrip with custom trailers', () => {
      const original = [
        'Lore-id: abcd1234',
        'My-trailer: custom value',
      ].join('\n');

      const parsed = parser.parse(original, []);
      const serialized = parser.serialize(parsed);
      const reparsed = parser.parse(serialized, []);

      expect(reparsed.custom.get('My-trailer')).toEqual(['custom value']);
    });
  });

  describe('containsLoreTrailers', () => {
    it('should return true when text contains Lore-id', () => {
      expect(parser.containsLoreTrailers('Lore-id: abcd1234')).toBe(true);
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

    it('should return false for non-Lore trailers', () => {
      expect(parser.containsLoreTrailers('Signed-off-by: Someone')).toBe(false);
    });

    it('should return true when Lore trailers are mixed with non-Lore', () => {
      const text = [
        'Signed-off-by: Someone',
        'Lore-id: abcd1234',
      ].join('\n');
      expect(parser.containsLoreTrailers(text)).toBe(true);
    });

    it('should detect trailers in a full commit message', () => {
      const text = [
        'feat(db): add connection pooling',
        '',
        'Added PgBouncer-based connection pooling.',
        '',
        'Lore-id: a1b2c3d4',
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
        'Lore-id: a1b2c3d4',
        'Constraint: PostgreSQL >= 14',
      ].join('\n');
      const result = parser.extractTrailerBlock(message);
      expect(result).toBe('Lore-id: a1b2c3d4\nConstraint: PostgreSQL >= 14');
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
        'Lore-id: a1b2c3d4',
        'Confidence: high',
      ].join('\n');
      const result = parser.extractTrailerBlock(message);
      expect(result).toBe('Lore-id: a1b2c3d4\nConfidence: high');
    });

    it('should handle trailing whitespace', () => {
      const message = [
        'feat: something',
        '',
        'Lore-id: a1b2c3d4',
        '  ',
      ].join('\n');
      // After trimEnd, the trailing whitespace paragraph disappears
      const result = parser.extractTrailerBlock(message);
      expect(result).toContain('Lore-id: a1b2c3d4');
    });

    it('should handle multiple blank line separators', () => {
      const message = [
        'feat: something',
        '',
        '',
        'Body text here.',
        '',
        '',
        'Lore-id: a1b2c3d4',
      ].join('\n');
      const result = parser.extractTrailerBlock(message);
      expect(result).toBe('Lore-id: a1b2c3d4');
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
        'Lore-id: a1b2c3d4',
        'Constraint: A long constraint',
        '  that continues here',
      ].join('\n');
      const result = parser.extractTrailerBlock(message);
      expect(result).toContain('Lore-id: a1b2c3d4');
      expect(result).toContain('Constraint: A long constraint');
      expect(result).toContain('  that continues here');
    });
  });
});

/**
 * Helper to create a LoreTrailers object with defaults and overrides.
 */
function makeTrailers(overrides: Partial<{
  'Lore-id': string;
  Constraint: readonly string[];
  Rejected: readonly string[];
  Confidence: 'low' | 'medium' | 'high' | null;
  'Scope-risk': 'narrow' | 'moderate' | 'wide' | null;
  Reversibility: 'clean' | 'migration-needed' | 'irreversible' | null;
  Directive: readonly string[];
  Tested: readonly string[];
  'Not-tested': readonly string[];
  Supersedes: readonly string[];
  'Depends-on': readonly string[];
  Related: readonly string[];
  custom: ReadonlyMap<string, readonly string[]>;
}>) {
  return {
    'Lore-id': overrides['Lore-id'] ?? '',
    Constraint: overrides.Constraint ?? [],
    Rejected: overrides.Rejected ?? [],
    Confidence: overrides.Confidence ?? null,
    'Scope-risk': overrides['Scope-risk'] ?? null,
    Reversibility: overrides.Reversibility ?? null,
    Directive: overrides.Directive ?? [],
    Tested: overrides.Tested ?? [],
    'Not-tested': overrides['Not-tested'] ?? [],
    Supersedes: overrides.Supersedes ?? [],
    'Depends-on': overrides['Depends-on'] ?? [],
    Related: overrides.Related ?? [],
    custom: overrides.custom ?? new Map<string, readonly string[]>(),
  };
}
