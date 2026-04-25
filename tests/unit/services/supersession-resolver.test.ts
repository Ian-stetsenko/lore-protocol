import { describe, it, expect } from 'vitest';
import { SupersessionResolver } from '../../../src/services/supersession-resolver.js';
import type { LoreAtom, LoreTrailers } from '../../../src/types/domain.js';
import { CustomTrailerCollection } from '../../../src/types/custom-trailer-collection.js';

function makeAtom(options: {
  loreId: string;
  supersedes?: string[];
  dependsOn?: string[];
  related?: string[];
}): LoreAtom {
  return {
    loreId: options.loreId,
    commitHash: `hash-${options.loreId}`,
    date: new Date('2025-01-15T10:00:00Z'),
    author: 'dev@example.com',
    intent: 'test commit',
    body: '',
    trailers: {
      'Lore-id': options.loreId,
      Constraint: [],
      Rejected: [],
      Confidence: null,
      'Scope-risk': null,
      Reversibility: null,
      Directive: [],
      Tested: [],
      'Not-tested': [],
      Supersedes: options.supersedes ?? [],
      'Depends-on': options.dependsOn ?? [],
      Related: options.related ?? [],
      custom: CustomTrailerCollection.empty(),
    } as LoreTrailers,
    filesChanged: [],
  };
}

describe('SupersessionResolver', () => {
  let resolver: SupersessionResolver;

  beforeEach(() => {
    resolver = new SupersessionResolver();
  });

  describe('resolve', () => {
    it('should return all atoms as active when no supersession exists', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111' }),
        makeAtom({ loreId: 'bbbb2222' }),
        makeAtom({ loreId: 'cccc3333' }),
      ];

      const result = resolver.resolve(atoms);

      expect(result.size).toBe(3);
      for (const [, status] of result) {
        expect(status.superseded).toBe(false);
        expect(status.supersededBy).toBeNull();
      }
    });

    it('should mark a directly superseded atom', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111', supersedes: ['bbbb2222'] }),
        makeAtom({ loreId: 'bbbb2222' }),
      ];

      const result = resolver.resolve(atoms);

      expect(result.get('aaaa1111')!.superseded).toBe(false);
      expect(result.get('bbbb2222')!.superseded).toBe(true);
      expect(result.get('bbbb2222')!.supersededBy).toBe('aaaa1111');
    });

    it('should handle multiple atoms superseded by one', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111', supersedes: ['bbbb2222', 'cccc3333'] }),
        makeAtom({ loreId: 'bbbb2222' }),
        makeAtom({ loreId: 'cccc3333' }),
      ];

      const result = resolver.resolve(atoms);

      expect(result.get('aaaa1111')!.superseded).toBe(false);
      expect(result.get('bbbb2222')!.superseded).toBe(true);
      expect(result.get('bbbb2222')!.supersededBy).toBe('aaaa1111');
      expect(result.get('cccc3333')!.superseded).toBe(true);
      expect(result.get('cccc3333')!.supersededBy).toBe('aaaa1111');
    });

    it('should handle transitive chains: A supersedes B, B supersedes C', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111', supersedes: ['bbbb2222'] }),
        makeAtom({ loreId: 'bbbb2222', supersedes: ['cccc3333'] }),
        makeAtom({ loreId: 'cccc3333' }),
      ];

      const result = resolver.resolve(atoms);

      expect(result.get('aaaa1111')!.superseded).toBe(false);
      expect(result.get('bbbb2222')!.superseded).toBe(true);
      expect(result.get('cccc3333')!.superseded).toBe(true);
    });

    it('should handle circular references without infinite loop', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111', supersedes: ['bbbb2222'] }),
        makeAtom({ loreId: 'bbbb2222', supersedes: ['aaaa1111'] }),
      ];

      const result = resolver.resolve(atoms);

      // Both should be marked as superseded since each supersedes the other
      expect(result.get('aaaa1111')!.superseded).toBe(true);
      expect(result.get('bbbb2222')!.superseded).toBe(true);
    });

    it('should handle supersession of atoms not in the set', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111', supersedes: ['zzzz9999'] }),
      ];

      const result = resolver.resolve(atoms);

      // aaaa1111 should be active
      expect(result.get('aaaa1111')!.superseded).toBe(false);
      // zzzz9999 should not be in the map since it's not in the atom set
      expect(result.has('zzzz9999')).toBe(false);
    });

    it('should handle empty atom list', () => {
      const result = resolver.resolve([]);

      expect(result.size).toBe(0);
    });

    it('should handle single atom with no supersession', () => {
      const atoms = [makeAtom({ loreId: 'aaaa1111' })];

      const result = resolver.resolve(atoms);

      expect(result.size).toBe(1);
      expect(result.get('aaaa1111')!.superseded).toBe(false);
    });

    it('should handle deep transitive chain: A -> B -> C -> D', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111', supersedes: ['bbbb2222'] }),
        makeAtom({ loreId: 'bbbb2222', supersedes: ['cccc3333'] }),
        makeAtom({ loreId: 'cccc3333', supersedes: ['dddd4444'] }),
        makeAtom({ loreId: 'dddd4444' }),
      ];

      const result = resolver.resolve(atoms);

      expect(result.get('aaaa1111')!.superseded).toBe(false);
      expect(result.get('bbbb2222')!.superseded).toBe(true);
      expect(result.get('cccc3333')!.superseded).toBe(true);
      expect(result.get('dddd4444')!.superseded).toBe(true);
    });

    it('should skip invalid Lore-id references', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111', supersedes: ['not-valid', 'bbbb2222'] }),
        makeAtom({ loreId: 'bbbb2222' }),
      ];

      const result = resolver.resolve(atoms);

      expect(result.get('bbbb2222')!.superseded).toBe(true);
      expect(result.get('aaaa1111')!.superseded).toBe(false);
    });

    it('should handle diamond supersession pattern', () => {
      // A supersedes B, A supersedes C, both B and C supersede D
      const atoms = [
        makeAtom({ loreId: 'aaaa1111', supersedes: ['bbbb2222', 'cccc3333'] }),
        makeAtom({ loreId: 'bbbb2222', supersedes: ['dddd4444'] }),
        makeAtom({ loreId: 'cccc3333', supersedes: ['dddd4444'] }),
        makeAtom({ loreId: 'dddd4444' }),
      ];

      const result = resolver.resolve(atoms);

      expect(result.get('aaaa1111')!.superseded).toBe(false);
      expect(result.get('bbbb2222')!.superseded).toBe(true);
      expect(result.get('cccc3333')!.superseded).toBe(true);
      expect(result.get('dddd4444')!.superseded).toBe(true);
    });
  });

  describe('filterActive', () => {
    it('should return only active (non-superseded) atoms', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111', supersedes: ['bbbb2222'] }),
        makeAtom({ loreId: 'bbbb2222' }),
        makeAtom({ loreId: 'cccc3333' }),
      ];

      const supersessionMap = resolver.resolve(atoms);
      const active = resolver.filterActive(atoms, supersessionMap);

      expect(active).toHaveLength(2);
      const activeIds = active.map((a) => a.loreId);
      expect(activeIds).toContain('aaaa1111');
      expect(activeIds).toContain('cccc3333');
      expect(activeIds).not.toContain('bbbb2222');
    });

    it('should return all atoms when none are superseded', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111' }),
        makeAtom({ loreId: 'bbbb2222' }),
      ];

      const supersessionMap = resolver.resolve(atoms);
      const active = resolver.filterActive(atoms, supersessionMap);

      expect(active).toHaveLength(2);
    });

    it('should return empty array when all atoms are superseded', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111', supersedes: ['bbbb2222'] }),
        makeAtom({ loreId: 'bbbb2222', supersedes: ['aaaa1111'] }),
      ];

      const supersessionMap = resolver.resolve(atoms);
      const active = resolver.filterActive(atoms, supersessionMap);

      expect(active).toHaveLength(0);
    });

    it('should handle atoms not in the supersession map', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111' }),
      ];

      // Empty map -- atom not found means active by default
      const supersessionMap = new Map<string, { superseded: boolean; supersededBy: string | null }>();
      const active = resolver.filterActive(atoms, supersessionMap);

      expect(active).toHaveLength(1);
    });

    it('should handle empty atom list', () => {
      const supersessionMap = new Map<string, { superseded: boolean; supersededBy: string | null }>();
      const active = resolver.filterActive([], supersessionMap);

      expect(active).toHaveLength(0);
    });
  });
});
