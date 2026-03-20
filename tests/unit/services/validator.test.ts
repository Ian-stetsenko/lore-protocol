import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Validator } from '../../../src/services/validator.js';
import type { LoreConfig } from '../../../src/types/config.js';
import type { RawCommit } from '../../../src/interfaces/git-client.js';
import type { LoreTrailers } from '../../../src/types/domain.js';
import type { AtomRepository } from '../../../src/services/atom-repository.js';
import { DEFAULT_CONFIG } from '../../../src/types/config.js';

function makeTrailers(overrides: Partial<LoreTrailers> = {}): LoreTrailers {
  return {
    'Lore-id': overrides['Lore-id'] ?? 'a1b2c3d4',
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
    custom: overrides.custom ?? new Map(),
  };
}

function createMockTrailerParser(resultOverrides: Partial<LoreTrailers> = {}) {
  return {
    parse: vi.fn(() => makeTrailers(resultOverrides)),
    serialize: vi.fn(),
    containsLoreTrailers: vi.fn(),
    extractTrailerBlock: vi.fn(),
  };
}

function createMockAtomRepository(): Partial<AtomRepository> {
  return {
    findByLoreId: vi.fn(async () => null),
  };
}

function makeCommit(overrides: Partial<RawCommit> = {}): RawCommit {
  return {
    hash: overrides.hash ?? 'abc1234567890',
    date: overrides.date ?? '2025-01-15T10:00:00Z',
    author: overrides.author ?? 'alice@example.com',
    subject: overrides.subject ?? 'feat(auth): add login flow',
    body: overrides.body ?? '',
    trailers: overrides.trailers ?? 'Lore-id: a1b2c3d4',
  };
}

describe('Validator', () => {
  let validator: Validator;
  let mockParser: ReturnType<typeof createMockTrailerParser>;
  let mockAtomRepo: Partial<AtomRepository>;
  let config: LoreConfig;

  beforeEach(() => {
    mockParser = createMockTrailerParser();
    mockAtomRepo = createMockAtomRepository();
    config = { ...DEFAULT_CONFIG };
    validator = new Validator(mockParser as any, mockAtomRepo as any, config);
  });

  describe('basic validation', () => {
    it('should return valid for a correct commit', async () => {
      const commit = makeCommit();
      const results = await validator.validate([commit]);

      expect(results).toHaveLength(1);
      expect(results[0].valid).toBe(true);
      expect(results[0].issues).toEqual([]);
      expect(results[0].loreId).toBe('a1b2c3d4');
    });

    it('should validate multiple commits', async () => {
      const commit1 = makeCommit({ hash: 'aaa111' });
      const commit2 = makeCommit({ hash: 'bbb222' });
      const results = await validator.validate([commit1, commit2]);

      expect(results).toHaveLength(2);
    });
  });

  describe('Rule 1: trailer format', () => {
    it('should error when trailers cannot be parsed', async () => {
      mockParser.parse.mockImplementation(() => {
        throw new Error('Parse error');
      });

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      expect(results[0].valid).toBe(false);
      const formatIssue = results[0].issues.find((i) => i.rule === 'trailer-format');
      expect(formatIssue).toBeDefined();
      expect(formatIssue!.severity).toBe('error');
    });
  });

  describe('Rule 2: Lore-id present', () => {
    it('should error when Lore-id is missing', async () => {
      mockParser.parse.mockReturnValue(makeTrailers({ 'Lore-id': '' }));

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      const loreIdIssue = results[0].issues.find((i) => i.rule === 'lore-id-present');
      expect(loreIdIssue).toBeDefined();
      expect(loreIdIssue!.severity).toBe('error');
    });
  });

  describe('Rule 3: Lore-id format', () => {
    it('should error when Lore-id is not 8-char hex', async () => {
      mockParser.parse.mockReturnValue(makeTrailers({ 'Lore-id': 'not-hex!' }));

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      const formatIssue = results[0].issues.find((i) => i.rule === 'lore-id-format');
      expect(formatIssue).toBeDefined();
      expect(formatIssue!.severity).toBe('error');
    });

    it('should pass for valid 8-char hex Lore-id', async () => {
      mockParser.parse.mockReturnValue(makeTrailers({ 'Lore-id': 'abcd1234' }));

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      const formatIssue = results[0].issues.find((i) => i.rule === 'lore-id-format');
      expect(formatIssue).toBeUndefined();
    });

    it('should error for too-short Lore-id', async () => {
      mockParser.parse.mockReturnValue(makeTrailers({ 'Lore-id': 'abc123' }));

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      const formatIssue = results[0].issues.find((i) => i.rule === 'lore-id-format');
      expect(formatIssue).toBeDefined();
    });

    it('should error for uppercase hex Lore-id', async () => {
      mockParser.parse.mockReturnValue(makeTrailers({ 'Lore-id': 'ABCD1234' }));

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      const formatIssue = results[0].issues.find((i) => i.rule === 'lore-id-format');
      expect(formatIssue).toBeDefined();
    });
  });

  describe('Rule 4: valid enum values', () => {
    it('should error on invalid Confidence', async () => {
      mockParser.parse.mockReturnValue(
        makeTrailers({ Confidence: 'super-high' as any }),
      );

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      const enumIssue = results[0].issues.find(
        (i) => i.rule === 'invalid-enum' && i.message.includes('Confidence'),
      );
      expect(enumIssue).toBeDefined();
      expect(enumIssue!.severity).toBe('error');
    });

    it('should error on invalid Scope-risk', async () => {
      mockParser.parse.mockReturnValue(
        makeTrailers({ 'Scope-risk': 'huge' as any }),
      );

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      const enumIssue = results[0].issues.find(
        (i) => i.rule === 'invalid-enum' && i.message.includes('Scope-risk'),
      );
      expect(enumIssue).toBeDefined();
    });

    it('should error on invalid Reversibility', async () => {
      mockParser.parse.mockReturnValue(
        makeTrailers({ Reversibility: 'maybe' as any }),
      );

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      const enumIssue = results[0].issues.find(
        (i) => i.rule === 'invalid-enum' && i.message.includes('Reversibility'),
      );
      expect(enumIssue).toBeDefined();
    });

    it('should accept valid enum values', async () => {
      mockParser.parse.mockReturnValue(
        makeTrailers({
          Confidence: 'medium',
          'Scope-risk': 'narrow',
          Reversibility: 'clean',
        }),
      );

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      const enumIssues = results[0].issues.filter((i) => i.rule === 'invalid-enum');
      expect(enumIssues).toHaveLength(0);
    });

    it('should not error when enum trailers are null', async () => {
      mockParser.parse.mockReturnValue(
        makeTrailers({
          Confidence: null,
          'Scope-risk': null,
          Reversibility: null,
        }),
      );

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      const enumIssues = results[0].issues.filter((i) => i.rule === 'invalid-enum');
      expect(enumIssues).toHaveLength(0);
    });
  });

  describe('Rule 5: intent length', () => {
    it('should warn when intent exceeds max length', async () => {
      const commit = makeCommit({ subject: 'a'.repeat(100) });
      const results = await validator.validate([commit]);

      const intentIssue = results[0].issues.find((i) => i.rule === 'intent-length');
      expect(intentIssue).toBeDefined();
      expect(intentIssue!.severity).toBe('warning');
    });

    it('should not warn when intent is within limit', async () => {
      const commit = makeCommit({ subject: 'feat: short intent' });
      const results = await validator.validate([commit]);

      const intentIssue = results[0].issues.find((i) => i.rule === 'intent-length');
      expect(intentIssue).toBeUndefined();
    });

    it('should use config value for max length', async () => {
      const customConfig: LoreConfig = {
        ...DEFAULT_CONFIG,
        validation: { ...DEFAULT_CONFIG.validation, intentMaxLength: 50 },
      };
      const customValidator = new Validator(mockParser as any, mockAtomRepo as any, customConfig);

      const commit = makeCommit({ subject: 'a'.repeat(51) });
      const results = await customValidator.validate([commit]);

      const intentIssue = results[0].issues.find((i) => i.rule === 'intent-length');
      expect(intentIssue).toBeDefined();
      expect(intentIssue!.message).toContain('50');
    });
  });

  describe('Rule 6: required trailers', () => {
    it('should warn on missing required trailers (non-strict)', async () => {
      const requiredConfig: LoreConfig = {
        ...DEFAULT_CONFIG,
        trailers: { required: ['Confidence', 'Constraint'], custom: [] },
        validation: { ...DEFAULT_CONFIG.validation, strict: false },
      };
      const requiredValidator = new Validator(mockParser as any, mockAtomRepo as any, requiredConfig);
      mockParser.parse.mockReturnValue(makeTrailers({ Confidence: null }));

      const commit = makeCommit();
      const results = await requiredValidator.validate([commit]);

      const requiredIssues = results[0].issues.filter(
        (i) => i.rule === 'required-trailer',
      );
      expect(requiredIssues).toHaveLength(2);
      expect(requiredIssues[0].severity).toBe('warning');
    });

    it('should error on missing required trailers (strict)', async () => {
      const strictConfig: LoreConfig = {
        ...DEFAULT_CONFIG,
        trailers: { required: ['Confidence'], custom: [] },
        validation: { ...DEFAULT_CONFIG.validation, strict: true },
      };
      const strictValidator = new Validator(mockParser as any, mockAtomRepo as any, strictConfig);
      mockParser.parse.mockReturnValue(makeTrailers({ Confidence: null }));

      const commit = makeCommit();
      const results = await strictValidator.validate([commit]);

      const requiredIssues = results[0].issues.filter(
        (i) => i.rule === 'required-trailer',
      );
      expect(requiredIssues[0].severity).toBe('error');
    });

    it('should not warn when required trailers are present', async () => {
      const requiredConfig: LoreConfig = {
        ...DEFAULT_CONFIG,
        trailers: { required: ['Confidence'], custom: [] },
      };
      const requiredValidator = new Validator(mockParser as any, mockAtomRepo as any, requiredConfig);
      mockParser.parse.mockReturnValue(
        makeTrailers({ Confidence: 'medium' }),
      );

      const commit = makeCommit();
      const results = await requiredValidator.validate([commit]);

      const requiredIssues = results[0].issues.filter(
        (i) => i.rule === 'required-trailer',
      );
      expect(requiredIssues).toHaveLength(0);
    });
  });

  describe('Rule 7: message line count', () => {
    it('should warn when message exceeds max lines', async () => {
      const longBody = Array.from({ length: 55 }, (_, i) => `Line ${i}`).join('\n');
      const commit = makeCommit({ body: longBody });
      const results = await validator.validate([commit]);

      const lineIssue = results[0].issues.find((i) => i.rule === 'message-length');
      expect(lineIssue).toBeDefined();
      expect(lineIssue!.severity).toBe('warning');
    });

    it('should not warn when within line limit', async () => {
      const commit = makeCommit({ body: 'Short body' });
      const results = await validator.validate([commit]);

      const lineIssue = results[0].issues.find((i) => i.rule === 'message-length');
      expect(lineIssue).toBeUndefined();
    });
  });

  describe('Rule 8: reference format', () => {
    it('should warn on invalid reference format', async () => {
      mockParser.parse.mockReturnValue(
        makeTrailers({
          Supersedes: ['not-hex!'],
          Related: ['toolong12'],
        }),
      );

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      const refIssues = results[0].issues.filter(
        (i) => i.rule === 'reference-format',
      );
      expect(refIssues).toHaveLength(2);
      expect(refIssues[0].severity).toBe('warning');
    });

    it('should not warn on valid reference format', async () => {
      mockParser.parse.mockReturnValue(
        makeTrailers({
          Supersedes: ['aabbccdd'],
          'Depends-on': ['11223344'],
        }),
      );

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      const refIssues = results[0].issues.filter(
        (i) => i.rule === 'reference-format',
      );
      expect(refIssues).toHaveLength(0);
    });
  });

  describe('Rule 9: trailer count', () => {
    it('should warn when more than 5 of any trailer type', async () => {
      mockParser.parse.mockReturnValue(
        makeTrailers({
          Constraint: ['a', 'b', 'c', 'd', 'e', 'f'],
        }),
      );

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      const countIssue = results[0].issues.find(
        (i) => i.rule === 'trailer-count',
      );
      expect(countIssue).toBeDefined();
      expect(countIssue!.severity).toBe('warning');
      expect(countIssue!.message).toContain('Constraint');
      expect(countIssue!.message).toContain('6');
    });

    it('should not warn when 5 or fewer of each type', async () => {
      mockParser.parse.mockReturnValue(
        makeTrailers({
          Constraint: ['a', 'b', 'c', 'd', 'e'],
          Rejected: ['x', 'y'],
        }),
      );

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      const countIssues = results[0].issues.filter(
        (i) => i.rule === 'trailer-count',
      );
      expect(countIssues).toHaveLength(0);
    });
  });

  describe('overall validity', () => {
    it('should be invalid if any error exists', async () => {
      mockParser.parse.mockReturnValue(makeTrailers({ 'Lore-id': '' }));

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      expect(results[0].valid).toBe(false);
    });

    it('should be valid even with warnings', async () => {
      const commit = makeCommit({ subject: 'a'.repeat(100) });
      const results = await validator.validate([commit]);

      // Has a warning but no errors
      const warnings = results[0].issues.filter((i) => i.severity === 'warning');
      const errors = results[0].issues.filter((i) => i.severity === 'error');
      expect(warnings.length).toBeGreaterThan(0);
      expect(errors).toHaveLength(0);
      expect(results[0].valid).toBe(true);
    });
  });

  describe('commit hash and lore-id reporting', () => {
    it('should report commit hash', async () => {
      const commit = makeCommit({ hash: 'specific_hash_123' });
      const results = await validator.validate([commit]);

      expect(results[0].commit).toBe('specific_hash_123');
    });

    it('should report lore-id when present', async () => {
      mockParser.parse.mockReturnValue(makeTrailers({ 'Lore-id': 'deadbeef' }));
      const commit = makeCommit();
      const results = await validator.validate([commit]);

      expect(results[0].loreId).toBe('deadbeef');
    });

    it('should report null lore-id when parse fails', async () => {
      mockParser.parse.mockImplementation(() => {
        throw new Error('Parse error');
      });

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      expect(results[0].loreId).toBeNull();
    });
  });

  describe('Rule 10: reference existence', () => {
    it('should warn when referenced atom does not exist', async () => {
      mockParser.parse.mockReturnValue(
        makeTrailers({
          Supersedes: ['aabbccdd'],
        }),
      );

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      const refExistsIssues = results[0].issues.filter(
        (i) => i.rule === 'reference-exists',
      );
      expect(refExistsIssues).toHaveLength(1);
      expect(refExistsIssues[0].severity).toBe('warning');
      expect(refExistsIssues[0].message).toContain('aabbccdd');
    });

    it('should not warn when referenced atom exists', async () => {
      vi.mocked(mockAtomRepo.findByLoreId!).mockResolvedValue({
        loreId: 'aabbccdd',
        commitHash: 'abc',
        date: new Date(),
        author: 'dev@example.com',
        intent: 'test',
        body: '',
        trailers: makeTrailers({ 'Lore-id': 'aabbccdd' }),
        filesChanged: [],
      });
      mockParser.parse.mockReturnValue(
        makeTrailers({
          Related: ['aabbccdd'],
        }),
      );

      const commit = makeCommit();
      const results = await validator.validate([commit]);

      const refExistsIssues = results[0].issues.filter(
        (i) => i.rule === 'reference-exists',
      );
      expect(refExistsIssues).toHaveLength(0);
    });
  });
});
