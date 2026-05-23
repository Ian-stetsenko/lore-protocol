import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SquashMerger } from '../../../src/services/squash-merger.js';
import { Protocol } from '../../../src/services/protocol.js';
import { DEFAULT_CONFIG } from '../../../src/util/constants.js';
import { LORE_ID_KEY } from '../../../src/util/constants.js';
import type { LoreAtom, LoreTrailers } from '../../../src/types/domain.js';

function createMockIdGenerator(id = 'deadbeef') {
  return {
    generate: vi.fn(() => id),
  };
}

function makeTrailers(overrides: Partial<LoreTrailers> = {}): LoreTrailers {
  return {
    [LORE_ID_KEY]: overrides[LORE_ID_KEY] ?? ['a1b2c3d4'],
    Constraint: overrides.Constraint ?? [],
    Rejected: overrides.Rejected ?? [],
    Confidence: overrides.Confidence ?? [],
    'Scope-risk': overrides['Scope-risk'] ?? [],
    Reversibility: overrides.Reversibility ?? [],
    Directive: overrides.Directive ?? [],
    Tested: overrides.Tested ?? [],
    'Not-tested': overrides['Not-tested'] ?? [],
    Supersedes: overrides.Supersedes ?? [],
    'Depends-on': overrides['Depends-on'] ?? [],
    Related: overrides.Related ?? [],
    ...overrides,
  } as any;
}

function makeAtom(overrides: Partial<LoreAtom> = {}): LoreAtom {
  return {
    loreId: overrides.loreId ?? 'a1b2c3d4',
    commitHash: overrides.commitHash ?? 'abc1234567890',
    date: overrides.date ?? new Date('2025-01-15T10:00:00Z'),
    author: overrides.author ?? 'alice@example.com',
    intent: overrides.intent ?? 'feat(auth): add login flow',
    body: overrides.body ?? '',
    trailers: overrides.trailers ?? makeTrailers(),
    filesChanged: overrides.filesChanged ?? ['src/auth.ts'],
  };
}

describe('SquashMerger', () => {
  let merger: SquashMerger;
  let mockIdGen: ReturnType<typeof createMockIdGenerator>;
  let protocol: Protocol;

  beforeEach(() => {
    mockIdGen = createMockIdGenerator();
    protocol = new Protocol(DEFAULT_CONFIG);
    merger = new SquashMerger(mockIdGen as any, protocol);
  });

  it('should throw for empty atoms', () => {
    expect(() => merger.merge([], {})).toThrow('Cannot merge zero atoms');
  });

  it(`should generate a new ${LORE_ID_KEY}`, () => {
    const atom = makeAtom();
    const result = merger.merge([atom], {});

    expect(mockIdGen.generate).toHaveBeenCalledOnce();
    expect(result).toContain(`${LORE_ID_KEY}: deadbeef`);
  });

  describe('intent merging', () => {
    it('should use options.intent when provided', () => {
      const atom = makeAtom({ intent: 'old intent' });
      const result = merger.merge([atom], { intent: 'new intent' });

      expect(result.startsWith('new intent')).toBe(true);
    });

    it('should use newest atom intent when no option provided', () => {
      const older = makeAtom({
        loreId: 'aaaa0001',
        date: new Date('2025-01-01'),
        intent: 'older intent',
      });
      const newer = makeAtom({
        loreId: 'aaaa0002',
        date: new Date('2025-06-01'),
        intent: 'newer intent',
      });

      const result = merger.merge([older, newer], {});

      expect(result.startsWith('newer intent')).toBe(true);
    });
  });

  describe('body merging', () => {
    it('should use options.body when provided', () => {
      const atom = makeAtom({ body: 'original body' });
      const result = merger.merge([atom], { body: 'override body' });

      expect(result).toContain('override body');
      expect(result).not.toContain('original body');
    });

    it('should concatenate body summaries from all atoms', () => {
      const a1 = makeAtom({ loreId: 'aaaa0001', body: 'First body', date: new Date('2025-01-01') });
      const a2 = makeAtom({ loreId: 'aaaa0002', body: 'Second body', date: new Date('2025-02-01') });

      const result = merger.merge([a1, a2], {});

      expect(result).toContain('First body');
      expect(result).toContain('Second body');
    });

    it('should skip empty bodies', () => {
      const a1 = makeAtom({ loreId: 'aaaa0001', body: '', date: new Date('2025-01-01') });
      const a2 = makeAtom({ loreId: 'aaaa0002', body: 'Has body', date: new Date('2025-02-01') });

      const result = merger.merge([a1, a2], {});

      expect(result).toContain('Has body');
    });
  });

  describe('array trailer merging', () => {
    it('should union and deduplicate array trailers', () => {
      const a1 = makeAtom({
        loreId: 'aaaa0001',
        trailers: makeTrailers({
          [LORE_ID_KEY]: ['aaaa0001'],
          Constraint: ['Must use HTTPS', 'No external deps'],
          Tested: ['Unit tests'],
        }),
      });
      const a2 = makeAtom({
        loreId: 'aaaa0002',
        trailers: makeTrailers({
          [LORE_ID_KEY]: ['aaaa0002'],
          Constraint: ['Must use HTTPS', 'Max 100ms latency'],
          Tested: ['Integration tests'],
        }),
      });

      const result = merger.merge([a1, a2], {});

      expect(result).toContain('Constraint: Must use HTTPS');
      expect(result).toContain('Constraint: No external deps');
      expect(result).toContain('Constraint: Max 100ms latency');
      const matches = result.match(/Constraint: Must use HTTPS/g);
      expect(matches).toHaveLength(1);
    });
  });

  describe('enum trailer merging', () => {
    it('should pick lowest confidence (most conservative)', () => {
      const a1 = makeAtom({
        loreId: 'aaaa0001',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0001'], Confidence: ['high'] }),
      });
      const a2 = makeAtom({
        loreId: 'aaaa0002',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0002'], Confidence: ['low'] }),
      });

      const result = merger.merge([a1, a2], {});
      expect(result).toContain('Confidence: low');
    });

    it('should pick widest scope-risk', () => {
      const a1 = makeAtom({
        loreId: 'aaaa0001',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0001'], 'Scope-risk': ['narrow'] }),
      });
      const a2 = makeAtom({
        loreId: 'aaaa0002',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0002'], 'Scope-risk': ['wide'] }),
      });

      const result = merger.merge([a1, a2], {});
      expect(result).toContain('Scope-risk: wide');
    });

    it('should pick least reversible', () => {
      const a1 = makeAtom({
        loreId: 'aaaa0001',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0001'], Reversibility: ['clean'] }),
      });
      const a2 = makeAtom({
        loreId: 'aaaa0002',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0002'], Reversibility: ['irreversible'] }),
      });

      const result = merger.merge([a1, a2], {});
      expect(result).toContain('Reversibility: irreversible');
    });

    it('should handle null enum values gracefully', () => {
      const a1 = makeAtom({
        loreId: 'aaaa0001',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0001'], Confidence: ['medium'] }),
      });
      const a2 = makeAtom({
        loreId: 'aaaa0002',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0002'], Confidence: [] }),
      });

      const result = merger.merge([a1, a2], {});
      expect(result).toContain('Confidence: medium');
    });

    it('should pick medium over high for confidence', () => {
      const a1 = makeAtom({
        loreId: 'aaaa0001',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0001'], Confidence: ['high'] }),
      });
      const a2 = makeAtom({
        loreId: 'aaaa0002',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0002'], Confidence: ['medium'] }),
      });

      const result = merger.merge([a1, a2], {});
      expect(result).toContain('Confidence: medium');
    });

    it('should pick moderate over narrow for scope-risk', () => {
      const a1 = makeAtom({
        loreId: 'aaaa0001',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0001'], 'Scope-risk': ['narrow'] }),
      });
      const a2 = makeAtom({
        loreId: 'aaaa0002',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0002'], 'Scope-risk': ['moderate'] }),
      });

      const result = merger.merge([a1, a2], {});
      expect(result).toContain('Scope-risk: moderate');
    });

    it('should pick migration-needed over clean for reversibility', () => {
      const a1 = makeAtom({
        loreId: 'aaaa0001',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0001'], Reversibility: ['clean'] }),
      });
      const a2 = makeAtom({
        loreId: 'aaaa0002',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0002'], Reversibility: ['migration-needed'] }),
      });

      const result = merger.merge([a1, a2], {});
      expect(result).toContain('Reversibility: migration-needed');
    });
  });

  describe('reference trailer merging', () => {
    it('should drop internal references (lore-ids within merged set)', () => {
      const a1 = makeAtom({
        loreId: 'aaaa0001',
        trailers: makeTrailers({
          [LORE_ID_KEY]: ['aaaa0001'],
          Related: ['aaaa0002'],
        }),
      });
      const a2 = makeAtom({
        loreId: 'aaaa0002',
        trailers: makeTrailers({
          [LORE_ID_KEY]: ['aaaa0002'],
          'Depends-on': ['aaaa0001'],
        }),
      });

      const result = merger.merge([a1, a2], {});
      expect(result).not.toContain('Related: aaaa0002');
      expect(result).not.toContain('Depends-on: aaaa0001');
    });

    it('should merge and preserve custom trailers', () => {
      const a1 = makeAtom({
        loreId: 'aaaa0001',
        trailers: makeTrailers({
          [LORE_ID_KEY]: ['aaaa0001'],
          Team: ['platform'],
        } as any),
      });
      const a2 = makeAtom({
        loreId: 'aaaa0002',
        trailers: makeTrailers({
          [LORE_ID_KEY]: ['aaaa0002'],
          Team: ['core'],
          Ticket: ['PROJ-123'],
        } as any),
      });

      const result = merger.merge([a1, a2], {});
      expect(result).toContain('Team: platform');
      expect(result).toContain('Team: core');
      expect(result).toContain('Ticket: PROJ-123');
    });

    describe('squash strategies', () => {
      it('should respect rank-min (Confidence: low < high)', () => {
        const a1 = makeAtom({ trailers: makeTrailers({ Confidence: ['high'] }) });
        const a2 = makeAtom({ trailers: makeTrailers({ Confidence: ['low'] }) });
        const result = merger.merge([a1, a2], {});
        expect(result).toContain('Confidence: low');
      });

      it('should respect rank-max (Scope-risk: wide > narrow)', () => {
        const a1 = makeAtom({ trailers: makeTrailers({ 'Scope-risk': ['narrow'] }) });
        const a2 = makeAtom({ trailers: makeTrailers({ 'Scope-risk': ['wide'] }) });
        const result = merger.merge([a1, a2], {});
        expect(result).toContain('Scope-risk: wide');
      });

      it('should support rank-max for custom enums', () => {
        const configWithCustom = {
          ...DEFAULT_CONFIG,
          trailers: {
            ...DEFAULT_CONFIG.trailers,
            definitions: {
              Priority: {
                description: 'Prio',
                multivalue: false,
                validation: 'options' as const,
                options: { low: {}, high: {}, urgent: {} },
                squash: 'rank-max' as const,
              }
            },
            custom: [],
            permissive: false,
          }
        };
        const customProtocol = new Protocol(configWithCustom);
        const customMerger = new SquashMerger(mockIdGen as any, customProtocol);

        const a1 = makeAtom({ trailers: makeTrailers({ Priority: ['low'] } as any) });
        const a2 = makeAtom({ trailers: makeTrailers({ Priority: ['urgent'] } as any) });
        
        const result = customMerger.merge([a1, a2], {});
        expect(result).toContain('Priority: urgent');
      });
    });
  });

  describe('single atom merge', () => {
    it('should work with a single atom', () => {
      const atom = makeAtom({
        intent: 'single atom intent',
        trailers: makeTrailers({
          [LORE_ID_KEY]: ['a1b2c3d4'],
          Constraint: ['Some constraint'],
          Confidence: ['high'],
        }),
      });

      const result = merger.merge([atom], {});

      expect(result).toContain('single atom intent');
      expect(result).toContain(`${LORE_ID_KEY}: deadbeef`);
      expect(result).toContain('Constraint: Some constraint');
      expect(result).toContain('Confidence: high');
    });
  });

  describe('message structure', () => {
    it('should have proper structure: intent, blank line, body, blank line, trailers', () => {
      const atom = makeAtom({
        loreId: 'aaaa0001',
        body: 'Atom body text',
        trailers: makeTrailers({ [LORE_ID_KEY]: ['aaaa0001'], Confidence: ['high'] }),
      });

      const result = merger.merge([atom], { intent: 'Merged intent' });
      const lines = result.split('\n');

      expect(lines[0]).toBe('Merged intent');
      expect(lines[1]).toBe('');
      expect(lines[2]).toBe('Atom body text');
      expect(lines[3]).toBe('');
      expect(lines[4]).toContain(`${LORE_ID_KEY}: deadbeef`);
    });
  });
});
