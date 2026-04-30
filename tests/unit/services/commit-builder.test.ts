import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommitBuilder } from '../../../src/services/commit-builder.js';
import type { CommitInput } from '../../../src/services/commit-builder.js';
import type { LoreConfig } from '../../../src/types/config.js';
import type { LoreTrailers } from '../../../src/types/domain.js';
import { DEFAULT_CONFIG } from '../../../src/types/config.js';
import { CustomTrailerCollection } from '../../../src/types/custom-trailer-collection.js';

// Mock TrailerParser
function createMockTrailerParser() {
  return {
    parse: vi.fn(),
    serialize: vi.fn((trailers: LoreTrailers) => {
      const lines: string[] = [];
      lines.push(`Lore-id: ${trailers['Lore-id']}`);
      for (const v of trailers.Constraint) lines.push(`Constraint: ${v}`);
      for (const v of trailers.Rejected) lines.push(`Rejected: ${v}`);
      if (trailers.Confidence) lines.push(`Confidence: ${trailers.Confidence}`);
      if (trailers['Scope-risk']) lines.push(`Scope-risk: ${trailers['Scope-risk']}`);
      if (trailers.Reversibility) lines.push(`Reversibility: ${trailers.Reversibility}`);
      for (const v of trailers.Directive) lines.push(`Directive: ${v}`);
      for (const v of trailers.Tested) lines.push(`Tested: ${v}`);
      for (const v of trailers['Not-tested']) lines.push(`Not-tested: ${v}`);
      for (const v of trailers.Supersedes) lines.push(`Supersedes: ${v}`);
      for (const v of trailers['Depends-on']) lines.push(`Depends-on: ${v}`);
      for (const v of trailers.Related) lines.push(`Related: ${v}`);
      return lines.join('\n');
    }),
    containsLoreTrailers: vi.fn(),
    extractTrailerBlock: vi.fn(),
  };
}

// Mock LoreIdGenerator
function createMockIdGenerator(id = 'a1b2c3d4') {
  return {
    generate: vi.fn(() => id),
  };
}

describe('CommitBuilder', () => {
  let builder: CommitBuilder;
  let mockParser: ReturnType<typeof createMockTrailerParser>;
  let mockIdGen: ReturnType<typeof createMockIdGenerator>;
  let config: LoreConfig;

  beforeEach(() => {
    mockParser = createMockTrailerParser();
    mockIdGen = createMockIdGenerator();
    config = { ...DEFAULT_CONFIG };
    builder = new CommitBuilder(
      mockParser as any,
      mockIdGen as any,
      config,
    );
  });

  describe('build', () => {
    it('should build a minimal commit with intent and Lore-id', () => {
      const input: CommitInput = {
        intent: 'feat(auth): add login flow',
      };

      const result = builder.build(input);

      expect(mockIdGen.generate).toHaveBeenCalledOnce();
      expect(mockParser.serialize).toHaveBeenCalledOnce();
      expect(result).toContain('feat(auth): add login flow');
      expect(result).toContain('Lore-id: a1b2c3d4');
    });

    it('should include body separated by blank lines', () => {
      const input: CommitInput = {
        intent: 'feat: add feature',
        body: 'This is a detailed explanation.',
      };

      const result = builder.build(input);

      expect(result).toContain('feat: add feature');
      expect(result).toContain('\n\nThis is a detailed explanation.\n\n');
    });

    it('should include all trailer types', () => {
      const input: CommitInput = {
        intent: 'feat: full commit',
        trailers: {
          Constraint: ['Must use HTTPS', 'No external deps'],
          Rejected: ['Polling approach'],
          Confidence: 'high',
          'Scope-risk': 'narrow',
          Reversibility: 'clean',
          Directive: ['Review in 3 months'],
          Tested: ['Unit tests for auth module'],
          'Not-tested': ['Edge case with expired tokens'],
          Supersedes: ['bbccddee'],
          'Depends-on': ['11223344'],
          Related: ['aabbccdd'],
        },
      };

      const result = builder.build(input);

      expect(result).toContain('Constraint: Must use HTTPS');
      expect(result).toContain('Constraint: No external deps');
      expect(result).toContain('Rejected: Polling approach');
      expect(result).toContain('Confidence: high');
      expect(result).toContain('Scope-risk: narrow');
      expect(result).toContain('Reversibility: clean');
      expect(result).toContain('Directive: Review in 3 months');
      expect(result).toContain('Tested: Unit tests for auth module');
      expect(result).toContain('Not-tested: Edge case with expired tokens');
      expect(result).toContain('Supersedes: bbccddee');
      expect(result).toContain('Depends-on: 11223344');
      expect(result).toContain('Related: aabbccdd');
    });

    it('should auto-generate Lore-id', () => {
      mockIdGen.generate.mockReturnValue('deadbeef');
      const input: CommitInput = { intent: 'test' };

      const result = builder.build(input);

      expect(result).toContain('Lore-id: deadbeef');
    });

    it('should use provided existingLoreId instead of generating one', () => {
      const input: CommitInput = { intent: 'amend: update commit' };

      const result = builder.build(input, 'cafebabe');

      expect(result).toContain('Lore-id: cafebabe');
      expect(mockIdGen.generate).not.toHaveBeenCalled();
    });

    it('should not call loreIdGenerator.generate() when existingLoreId is provided', () => {
      const input: CommitInput = { intent: 'amend: keep id' };

      builder.build(input, '11223344');

      expect(mockIdGen.generate).not.toHaveBeenCalled();
    });

    it('should fall back to generating when no existingLoreId is provided', () => {
      const input: CommitInput = { intent: 'new commit' };

      builder.build(input);

      expect(mockIdGen.generate).toHaveBeenCalledOnce();
    });

    it('should pass correct trailers to serialize', () => {
      const input: CommitInput = {
        intent: 'test',
        trailers: { Confidence: 'medium' },
      };

      builder.build(input);

      const passedTrailers = mockParser.serialize.mock.calls[0][0] as LoreTrailers;
      expect(passedTrailers['Lore-id']).toBe('a1b2c3d4');
      expect(passedTrailers.Confidence).toBe('medium');
      expect(passedTrailers.Constraint).toEqual([]);
    });

    it('should pass custom trailers through to LoreTrailers.custom map', () => {
      const customMap = new Map<string, readonly string[]>();
      customMap.set('Assisted-by', ['Gemini:CLI']);
      customMap.set('Ticket', ['PROJ-123']);
      const input: CommitInput = {
        intent: 'feat: with custom trailers',
        trailers: {
          Confidence: 'high' as const,
          custom: new CustomTrailerCollection(customMap),
        },
      };

      builder.build(input);

      const passedTrailers = vi.mocked(mockParser.serialize).mock.calls[0][0] as LoreTrailers;
      expect(passedTrailers.custom.get('Assisted-by')).toEqual(['Gemini:CLI']);
      expect(passedTrailers.custom.get('Ticket')).toEqual(['PROJ-123']);
    });

    it('should produce empty custom map when no custom trailers provided', () => {
      const input: CommitInput = {
        intent: 'feat: no custom',
        trailers: { Confidence: 'high' as const },
      };

      builder.build(input);

      const passedTrailers = vi.mocked(mockParser.serialize).mock.calls[0][0] as LoreTrailers;
      expect(passedTrailers.custom.size).toBe(0);
    });
  });

  describe('validate', () => {
    it('should return no issues for valid input', () => {
      const input: CommitInput = {
        intent: 'feat: valid commit message',
        trailers: {
          Confidence: 'medium',
        },
      };

      const issues = builder.validate(input);
      expect(issues).toEqual([]);
    });

    it('should warn when intent exceeds max length', () => {
      const input: CommitInput = {
        intent: 'a'.repeat(100),
      };

      const issues = builder.validate(input);
      const intentIssue = issues.find((i) => i.rule === 'intent-length');
      expect(intentIssue).toBeDefined();
      expect(intentIssue!.severity).toBe('warning');
      expect(intentIssue!.message).toContain('72');
    });

    it('should error when intent is empty', () => {
      const input: CommitInput = {
        intent: '   ',
      };

      const issues = builder.validate(input);
      const intentIssue = issues.find((i) => i.rule === 'intent-required');
      expect(intentIssue).toBeDefined();
      expect(intentIssue!.severity).toBe('error');
    });

    it('should error on invalid Confidence enum', () => {
      const input: CommitInput = {
        intent: 'test',
        trailers: { Confidence: 'super-high' as any },
      };

      const issues = builder.validate(input);
      const enumIssue = issues.find(
        (i) => i.rule === 'invalid-enum' && i.message.includes('Confidence'),
      );
      expect(enumIssue).toBeDefined();
      expect(enumIssue!.severity).toBe('error');
    });

    it('should error on invalid Scope-risk enum', () => {
      const input: CommitInput = {
        intent: 'test',
        trailers: { 'Scope-risk': 'huge' as any },
      };

      const issues = builder.validate(input);
      const enumIssue = issues.find(
        (i) => i.rule === 'invalid-enum' && i.message.includes('Scope-risk'),
      );
      expect(enumIssue).toBeDefined();
    });

    it('should error on invalid Reversibility enum', () => {
      const input: CommitInput = {
        intent: 'test',
        trailers: { Reversibility: 'maybe' as any },
      };

      const issues = builder.validate(input);
      const enumIssue = issues.find(
        (i) => i.rule === 'invalid-enum' && i.message.includes('Reversibility'),
      );
      expect(enumIssue).toBeDefined();
    });

    it('should error on invalid lore-id format in references', () => {
      const input: CommitInput = {
        intent: 'test',
        trailers: {
          Supersedes: ['not-hex!'],
          'Depends-on': ['aabbccdd'],
          Related: ['toolong12'],
        },
      };

      const issues = builder.validate(input);
      const refIssues = issues.filter((i) => i.rule === 'invalid-lore-id-ref');
      expect(refIssues).toHaveLength(2); // not-hex! and toolong12
    });

    it('should accept valid 8-char hex references', () => {
      const input: CommitInput = {
        intent: 'test',
        trailers: {
          Supersedes: ['aabbccdd'],
          'Depends-on': ['11223344'],
        },
      };

      const issues = builder.validate(input);
      const refIssues = issues.filter((i) => i.rule === 'invalid-lore-id-ref');
      expect(refIssues).toHaveLength(0);
    });

    it('should check required trailers from config', () => {
      const strictConfig: LoreConfig = {
        ...DEFAULT_CONFIG,
        trailers: { required: ['Confidence', 'Constraint'], custom: [] },
        validation: { ...DEFAULT_CONFIG.validation, strict: false },
      };
      const strictBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, strictConfig);

      const input: CommitInput = {
        intent: 'test',
      };

      const issues = strictBuilder.validate(input);
      const requiredIssues = issues.filter((i) => i.rule === 'required-trailer');
      expect(requiredIssues).toHaveLength(2);
      expect(requiredIssues[0].severity).toBe('warning');
    });

    it('should error on missing required trailers in strict mode', () => {
      const strictConfig: LoreConfig = {
        ...DEFAULT_CONFIG,
        trailers: { required: ['Confidence'], custom: [] },
        validation: { ...DEFAULT_CONFIG.validation, strict: true },
      };
      const strictBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, strictConfig);

      const input: CommitInput = {
        intent: 'test',
      };

      const issues = strictBuilder.validate(input);
      const requiredIssues = issues.filter((i) => i.rule === 'required-trailer');
      expect(requiredIssues[0].severity).toBe('error');
    });

    it('should warn when message exceeds max lines', () => {
      const longBody = Array.from({ length: 60 }, (_, i) => `Line ${i + 1}`).join('\n');
      const input: CommitInput = {
        intent: 'test',
        body: longBody,
      };

      const issues = builder.validate(input);
      const lineIssue = issues.find((i) => i.rule === 'message-length');
      expect(lineIssue).toBeDefined();
      expect(lineIssue!.severity).toBe('warning');
    });

    it('should not warn when message is within line limit', () => {
      const input: CommitInput = {
        intent: 'test',
        body: 'Short body.',
      };

      const issues = builder.validate(input);
      const lineIssue = issues.find((i) => i.rule === 'message-length');
      expect(lineIssue).toBeUndefined();
    });

    it('should pass with valid required trailer present', () => {
      const strictConfig: LoreConfig = {
        ...DEFAULT_CONFIG,
        trailers: { required: ['Confidence'], custom: [] },
      };
      const strictBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, strictConfig);

      const input: CommitInput = {
        intent: 'test',
        trailers: { Confidence: 'medium' },
      };

      const issues = strictBuilder.validate(input);
      const requiredIssues = issues.filter((i) => i.rule === 'required-trailer');
      expect(requiredIssues).toHaveLength(0);
    });

    it('should report missing required custom trailer', () => {
      const strictConfig: LoreConfig = {
        ...DEFAULT_CONFIG,
        trailers: { ...DEFAULT_CONFIG.trailers, required: ['Assisted-by'] },
        validation: { ...DEFAULT_CONFIG.validation, strict: true },
      };
      const strictBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, strictConfig);

      const input: CommitInput = {
        intent: 'test',
        trailers: { Confidence: 'high' as const },
      };

      const issues = strictBuilder.validate(input);
      const requiredIssues = issues.filter((i) => i.rule === 'required-trailer');
      expect(requiredIssues).toHaveLength(1);
      expect(requiredIssues[0].message).toContain('Assisted-by');
      expect(requiredIssues[0].severity).toBe('error');
    });

    it('should not report missing required trailer when custom trailer is present', () => {
      const strictConfig: LoreConfig = {
        ...DEFAULT_CONFIG,
        trailers: { ...DEFAULT_CONFIG.trailers, required: ['Assisted-by'] },
        validation: { ...DEFAULT_CONFIG.validation, strict: true },
      };
      const strictBuilder = new CommitBuilder(mockParser as any, mockIdGen as any, strictConfig);

      const input: CommitInput = {
        intent: 'test',
        trailers: {
          Confidence: 'high' as const,
          custom: new CustomTrailerCollection(new Map([['Assisted-by', ['Gemini:CLI']]])),
        },
      };

      const issues = strictBuilder.validate(input);
      const requiredIssues = issues.filter((i) => i.rule === 'required-trailer');
      expect(requiredIssues).toHaveLength(0);
    });
  });
});
