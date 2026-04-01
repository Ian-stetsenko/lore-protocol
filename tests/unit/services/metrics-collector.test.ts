import { describe, it, expect } from 'vitest';
import { MetricsCollector } from '../../../src/services/metrics-collector.js';
import type { MetricsInput } from '../../../src/services/metrics-collector.js';
import type { LoreAtom, LoreTrailers, SupersessionStatus } from '../../../src/types/domain.js';

function makeAtom(options: {
  loreId: string;
  author?: string;
  filesChanged?: string[];
  constraints?: string[];
  rejected?: string[];
  confidence?: 'low' | 'medium' | 'high' | null;
  supersedes?: string[];
  dependsOn?: string[];
  directive?: string[];
  tested?: string[];
  notTested?: string[];
  related?: string[];
  scopeRisk?: 'narrow' | 'moderate' | 'wide' | null;
  reversibility?: 'clean' | 'migration-needed' | 'irreversible' | null;
}): LoreAtom {
  return {
    loreId: options.loreId,
    commitHash: `hash-${options.loreId}`,
    date: new Date('2025-06-15T10:00:00Z'),
    author: options.author ?? 'dev@example.com',
    intent: 'test commit',
    body: '',
    trailers: {
      'Lore-id': options.loreId,
      Constraint: options.constraints ?? [],
      Rejected: options.rejected ?? [],
      Confidence: options.confidence ?? null,
      'Scope-risk': options.scopeRisk ?? null,
      Reversibility: options.reversibility ?? null,
      Directive: options.directive ?? [],
      Tested: options.tested ?? [],
      'Not-tested': options.notTested ?? [],
      Supersedes: options.supersedes ?? [],
      'Depends-on': options.dependsOn ?? [],
      Related: options.related ?? [],
      custom: new Map(),
    } as LoreTrailers,
    filesChanged: options.filesChanged ?? [],
  };
}

function makeSupersessionMap(entries: Array<[string, boolean, string | null]>): Map<string, SupersessionStatus> {
  const map = new Map<string, SupersessionStatus>();
  for (const [id, superseded, supersededBy] of entries) {
    map.set(id, { superseded, supersededBy });
  }
  return map;
}

describe('MetricsCollector', () => {
  let collector: MetricsCollector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  describe('empty input', () => {
    it('should return zero values for all metrics with 0 commits and 0 atoms', () => {
      const input: MetricsInput = {
        atoms: [],
        supersessionMap: new Map(),
        staleAtomIds: new Set(),
        totalCommitCount: 0,
        allRepoFiles: [],
        since: null,
      };

      const result = collector.collectAll(input);

      expect(result.adoption.totalCommits).toBe(0);
      expect(result.adoption.loreCommits).toBe(0);
      expect(result.adoption.adoptionRate).toBe(0);
      expect(result.decisionDensity.uniqueFilesTouched).toBe(0);
      expect(result.decisionDensity.atomsPerFile).toBe(0);
      expect(result.decisionDensity.blindSpotCount).toBe(0);
      expect(result.trailerCoverage.totalAtoms).toBe(0);
      expect(result.staleness.totalActive).toBe(0);
      expect(result.staleness.staleCount).toBe(0);
      expect(result.staleness.stalenessRate).toBe(0);
      expect(result.supersessionDepth.totalChains).toBe(0);
      expect(result.supersessionDepth.averageDepth).toBe(0);
      expect(result.supersessionDepth.maxDepth).toBe(0);
      expect(result.constraintCoverage.totalRepoFiles).toBe(0);
      expect(result.constraintCoverage.filesWithConstraint).toBe(0);
      expect(result.constraintCoverage.coverageRate).toBe(0);
      expect(result.rejectionLibrary.uniqueRejections).toBe(0);
      expect(result.rejectionLibrary.totalRejectionEntries).toBe(0);
      expect(result.authorBreakdown.agentLoreCommits).toBe(0);
      expect(result.authorBreakdown.humanLoreCommits).toBe(0);
    });
  });

  describe('100% adoption', () => {
    it('should report 100% adoption when all commits are lore commits', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111' }),
        makeAtom({ loreId: 'bbbb2222' }),
        makeAtom({ loreId: 'cccc3333' }),
      ];

      const input: MetricsInput = {
        atoms,
        supersessionMap: makeSupersessionMap([
          ['aaaa1111', false, null],
          ['bbbb2222', false, null],
          ['cccc3333', false, null],
        ]),
        staleAtomIds: new Set(),
        totalCommitCount: 3,
        allRepoFiles: [],
        since: null,
      };

      const result = collector.collectAll(input);

      expect(result.adoption.adoptionRate).toBe(1);
      expect(result.adoption.loreCommits).toBe(3);
      expect(result.adoption.totalCommits).toBe(3);
    });
  });

  describe('partial adoption with mixed agent/human', () => {
    it('should correctly separate agent and human commits', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111', author: 'noreply@anthropic.com' }),
        makeAtom({ loreId: 'bbbb2222', author: 'claude@ai.com' }),
        makeAtom({ loreId: 'cccc3333', author: 'dev@example.com' }),
        makeAtom({ loreId: 'dddd4444', author: 'human@company.com' }),
      ];

      const input: MetricsInput = {
        atoms,
        supersessionMap: makeSupersessionMap([
          ['aaaa1111', false, null],
          ['bbbb2222', false, null],
          ['cccc3333', false, null],
          ['dddd4444', false, null],
        ]),
        staleAtomIds: new Set(),
        totalCommitCount: 10,
        allRepoFiles: [],
        since: null,
      };

      const result = collector.collectAll(input);

      expect(result.authorBreakdown.agentLoreCommits).toBe(2);
      expect(result.authorBreakdown.humanLoreCommits).toBe(2);
      expect(result.adoption.adoptionRate).toBe(0.4);
    });

    it('should detect copilot, devin, cursor, codeium, windsurf as agents', () => {
      const agents = [
        makeAtom({ loreId: 'aaaa1111', author: 'copilot[bot]@users.noreply@github.com' }),
        makeAtom({ loreId: 'bbbb2222', author: 'devin@cognition.ai' }),
        makeAtom({ loreId: 'cccc3333', author: 'cursor-ai@noreply.com' }),
        makeAtom({ loreId: 'dddd4444', author: 'codeium-bot@example.com' }),
        makeAtom({ loreId: 'eeee5555', author: 'windsurf-agent@corp.com' }),
      ];

      const input: MetricsInput = {
        atoms: agents,
        supersessionMap: makeSupersessionMap(
          agents.map(a => [a.loreId, false, null] as [string, boolean, string | null]),
        ),
        staleAtomIds: new Set(),
        totalCommitCount: 5,
        allRepoFiles: [],
        since: null,
      };

      const result = collector.collectAll(input);

      expect(result.authorBreakdown.agentLoreCommits).toBe(5);
      expect(result.authorBreakdown.humanLoreCommits).toBe(0);
    });
  });

  describe('trailer coverage', () => {
    it('should compute correct percentages for varied trailer usage', () => {
      const atoms = [
        makeAtom({
          loreId: 'aaaa1111',
          constraints: ['Must be fast'],
          rejected: ['Alternative A | too slow'],
          confidence: 'high',
        }),
        makeAtom({
          loreId: 'bbbb2222',
          constraints: ['Must be safe'],
          tested: ['Unit tests pass'],
        }),
        makeAtom({
          loreId: 'cccc3333',
          rejected: ['Alternative B | too complex'],
          directive: ['Use pattern X'],
        }),
        makeAtom({
          loreId: 'dddd4444',
        }),
      ];

      const input: MetricsInput = {
        atoms,
        supersessionMap: makeSupersessionMap(
          atoms.map(a => [a.loreId, false, null] as [string, boolean, string | null]),
        ),
        staleAtomIds: new Set(),
        totalCommitCount: 4,
        allRepoFiles: [],
        since: null,
      };

      const result = collector.collectAll(input);

      expect(result.trailerCoverage.totalAtoms).toBe(4);

      const constraintUsage = result.trailerCoverage.trailers.find(t => t.trailer === 'Constraint');
      expect(constraintUsage?.count).toBe(2);
      expect(constraintUsage?.percentage).toBe(50);

      const rejectedUsage = result.trailerCoverage.trailers.find(t => t.trailer === 'Rejected');
      expect(rejectedUsage?.count).toBe(2);
      expect(rejectedUsage?.percentage).toBe(50);

      const confidenceUsage = result.trailerCoverage.trailers.find(t => t.trailer === 'Confidence');
      expect(confidenceUsage?.count).toBe(1);
      expect(confidenceUsage?.percentage).toBe(25);

      const testedUsage = result.trailerCoverage.trailers.find(t => t.trailer === 'Tested');
      expect(testedUsage?.count).toBe(1);
      expect(testedUsage?.percentage).toBe(25);

      const directiveUsage = result.trailerCoverage.trailers.find(t => t.trailer === 'Directive');
      expect(directiveUsage?.count).toBe(1);
      expect(directiveUsage?.percentage).toBe(25);
    });
  });

  describe('supersession chains', () => {
    it('should report zero chains when no supersessions exist', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111' }),
        makeAtom({ loreId: 'bbbb2222' }),
      ];

      const input: MetricsInput = {
        atoms,
        supersessionMap: makeSupersessionMap([
          ['aaaa1111', false, null],
          ['bbbb2222', false, null],
        ]),
        staleAtomIds: new Set(),
        totalCommitCount: 2,
        allRepoFiles: [],
        since: null,
      };

      const result = collector.collectAll(input);

      expect(result.supersessionDepth.totalChains).toBe(0);
      expect(result.supersessionDepth.averageDepth).toBe(0);
      expect(result.supersessionDepth.maxDepth).toBe(0);
    });

    it('should report shallow chain: A supersedes B', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111', supersedes: ['bbbb2222'] }),
        makeAtom({ loreId: 'bbbb2222' }),
      ];

      const input: MetricsInput = {
        atoms,
        supersessionMap: makeSupersessionMap([
          ['aaaa1111', false, null],
          ['bbbb2222', true, 'aaaa1111'],
        ]),
        staleAtomIds: new Set(),
        totalCommitCount: 2,
        allRepoFiles: [],
        since: null,
      };

      const result = collector.collectAll(input);

      expect(result.supersessionDepth.totalChains).toBe(1);
      expect(result.supersessionDepth.maxDepth).toBe(1);
    });

    it('should report deep chain: A -> B -> C -> D', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111', supersedes: ['bbbb2222'] }),
        makeAtom({ loreId: 'bbbb2222', supersedes: ['cccc3333'] }),
        makeAtom({ loreId: 'cccc3333', supersedes: ['dddd4444'] }),
        makeAtom({ loreId: 'dddd4444' }),
      ];

      // The supersession map reflects the actual chain edges:
      // A supersedes B, B supersedes C, C supersedes D
      const input: MetricsInput = {
        atoms,
        supersessionMap: makeSupersessionMap([
          ['aaaa1111', false, null],
          ['bbbb2222', true, 'aaaa1111'],
          ['cccc3333', true, 'bbbb2222'],
          ['dddd4444', true, 'cccc3333'],
        ]),
        staleAtomIds: new Set(),
        totalCommitCount: 4,
        allRepoFiles: [],
        since: null,
      };

      const result = collector.collectAll(input);

      expect(result.supersessionDepth.totalChains).toBe(1);
      expect(result.supersessionDepth.maxDepth).toBe(3);
    });
  });

  describe('constraint coverage', () => {
    it('should compute coverage for repo files with constraints', () => {
      const atoms = [
        makeAtom({
          loreId: 'aaaa1111',
          constraints: ['Must be idempotent'],
          filesChanged: ['src/main.ts', 'src/util.ts'],
        }),
        makeAtom({
          loreId: 'bbbb2222',
          filesChanged: ['src/other.ts'],
        }),
      ];

      const input: MetricsInput = {
        atoms,
        supersessionMap: makeSupersessionMap([
          ['aaaa1111', false, null],
          ['bbbb2222', false, null],
        ]),
        staleAtomIds: new Set(),
        totalCommitCount: 2,
        allRepoFiles: ['src/main.ts', 'src/util.ts', 'src/other.ts', 'src/index.ts'],
        since: null,
      };

      const result = collector.collectAll(input);

      expect(result.constraintCoverage.totalRepoFiles).toBe(4);
      expect(result.constraintCoverage.filesWithConstraint).toBe(2);
      expect(result.constraintCoverage.coverageRate).toBe(0.5);
    });
  });

  describe('rejection deduplication', () => {
    it('should count unique rejections after normalization', () => {
      const atoms = [
        makeAtom({
          loreId: 'aaaa1111',
          rejected: ['Use MongoDB | too complex', 'Use Redis | overkill'],
        }),
        makeAtom({
          loreId: 'bbbb2222',
          rejected: ['use mongodb | too complex', 'Use GraphQL | over-engineered'],
        }),
      ];

      const input: MetricsInput = {
        atoms,
        supersessionMap: makeSupersessionMap([
          ['aaaa1111', false, null],
          ['bbbb2222', false, null],
        ]),
        staleAtomIds: new Set(),
        totalCommitCount: 2,
        allRepoFiles: [],
        since: null,
      };

      const result = collector.collectAll(input);

      expect(result.rejectionLibrary.totalRejectionEntries).toBe(4);
      expect(result.rejectionLibrary.uniqueRejections).toBe(3);
    });
  });

  describe('staleness', () => {
    it('should report correct staleness rate', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111' }),
        makeAtom({ loreId: 'bbbb2222' }),
        makeAtom({ loreId: 'cccc3333' }),
      ];

      const input: MetricsInput = {
        atoms,
        supersessionMap: makeSupersessionMap([
          ['aaaa1111', false, null],
          ['bbbb2222', false, null],
          ['cccc3333', false, null],
        ]),
        staleAtomIds: new Set(['aaaa1111']),
        totalCommitCount: 3,
        allRepoFiles: [],
        since: null,
      };

      const result = collector.collectAll(input);

      expect(result.staleness.totalActive).toBe(3);
      expect(result.staleness.staleCount).toBe(1);
      expect(result.staleness.stalenessRate).toBeCloseTo(1 / 3);
    });

    it('should not count superseded atoms as stale', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111' }),
        makeAtom({ loreId: 'bbbb2222' }),
      ];

      const input: MetricsInput = {
        atoms,
        supersessionMap: makeSupersessionMap([
          ['aaaa1111', false, null],
          ['bbbb2222', true, 'aaaa1111'],
        ]),
        staleAtomIds: new Set(['bbbb2222']),
        totalCommitCount: 2,
        allRepoFiles: [],
        since: null,
      };

      const result = collector.collectAll(input);

      // Only aaaa1111 is active, bbbb2222 is superseded
      expect(result.staleness.totalActive).toBe(1);
      expect(result.staleness.staleCount).toBe(0);
    });
  });

  describe('decision density', () => {
    it('should compute blind spots from repo files not touched by atoms', () => {
      const atoms = [
        makeAtom({
          loreId: 'aaaa1111',
          filesChanged: ['src/main.ts'],
        }),
      ];

      const input: MetricsInput = {
        atoms,
        supersessionMap: makeSupersessionMap([['aaaa1111', false, null]]),
        staleAtomIds: new Set(),
        totalCommitCount: 1,
        allRepoFiles: ['src/main.ts', 'src/a.ts', 'src/b.ts', 'src/c.ts'],
        since: null,
      };

      const result = collector.collectAll(input);

      expect(result.decisionDensity.uniqueFilesTouched).toBe(1);
      expect(result.decisionDensity.blindSpotCount).toBe(3);
      expect(result.decisionDensity.blindSpotFiles).toHaveLength(3);
      expect(result.decisionDensity.blindSpotFiles).toContain('src/a.ts');
    });

    it('should cap blind spot files at 10', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111', filesChanged: ['src/covered.ts'] }),
      ];

      const manyFiles = ['src/covered.ts'];
      for (let i = 0; i < 15; i++) {
        manyFiles.push(`src/uncovered-${i}.ts`);
      }

      const input: MetricsInput = {
        atoms,
        supersessionMap: makeSupersessionMap([['aaaa1111', false, null]]),
        staleAtomIds: new Set(),
        totalCommitCount: 1,
        allRepoFiles: manyFiles,
        since: null,
      };

      const result = collector.collectAll(input);

      expect(result.decisionDensity.blindSpotCount).toBe(15);
      expect(result.decisionDensity.blindSpotFiles).toHaveLength(10);
    });
  });

  describe('period', () => {
    it('should set since to null when no since is provided', () => {
      const input: MetricsInput = {
        atoms: [],
        supersessionMap: new Map(),
        staleAtomIds: new Set(),
        totalCommitCount: 0,
        allRepoFiles: [],
        since: null,
      };

      const result = collector.collectAll(input);

      expect(result.period.since).toBeNull();
      expect(result.period.analyzedAt).toBeTruthy();
    });

    it('should set since when provided', () => {
      const input: MetricsInput = {
        atoms: [],
        supersessionMap: new Map(),
        staleAtomIds: new Set(),
        totalCommitCount: 0,
        allRepoFiles: [],
        since: '2025-01-01',
      };

      const result = collector.collectAll(input);

      expect(result.period.since).toBe('2025-01-01');
    });
  });

  describe('edge cases', () => {
    it('should handle circular supersession (A supersedes B, B supersedes A) without infinite loop', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111', supersedes: ['bbbb2222'] }),
        makeAtom({ loreId: 'bbbb2222', supersedes: ['aaaa1111'] }),
      ];

      const input: MetricsInput = {
        atoms,
        supersessionMap: makeSupersessionMap([
          ['aaaa1111', true, 'bbbb2222'],
          ['bbbb2222', true, 'aaaa1111'],
        ]),
        staleAtomIds: new Set(),
        totalCommitCount: 2,
        allRepoFiles: [],
        since: null,
      };

      // Should complete without hanging or throwing
      const result = collector.collectAll(input);

      expect(result.supersessionDepth.totalChains).toBeGreaterThanOrEqual(0);
      expect(result.supersessionDepth.maxDepth).toBeGreaterThanOrEqual(0);
    });

    it('should handle adoption rate when atoms exceed totalCommitCount', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111' }),
        makeAtom({ loreId: 'bbbb2222' }),
        makeAtom({ loreId: 'cccc3333' }),
      ];

      const input: MetricsInput = {
        atoms,
        supersessionMap: makeSupersessionMap([
          ['aaaa1111', false, null],
          ['bbbb2222', false, null],
          ['cccc3333', false, null],
        ]),
        staleAtomIds: new Set(),
        totalCommitCount: 1,
        allRepoFiles: [],
        since: null,
      };

      const result = collector.collectAll(input);

      // Adoption rate exceeds 1.0 when atoms > totalCommitCount
      expect(result.adoption.adoptionRate).toBe(3);
      expect(result.adoption.loreCommits).toBe(3);
      expect(result.adoption.totalCommits).toBe(1);
    });

    it('should report agentLoreCommits = 0 when all authors are human', () => {
      const atoms = [
        makeAtom({ loreId: 'aaaa1111', author: 'alice@company.com' }),
        makeAtom({ loreId: 'bbbb2222', author: 'bob@company.com' }),
        makeAtom({ loreId: 'cccc3333', author: 'carol@company.com' }),
      ];

      const input: MetricsInput = {
        atoms,
        supersessionMap: makeSupersessionMap([
          ['aaaa1111', false, null],
          ['bbbb2222', false, null],
          ['cccc3333', false, null],
        ]),
        staleAtomIds: new Set(),
        totalCommitCount: 5,
        allRepoFiles: [],
        since: null,
      };

      const result = collector.collectAll(input);

      expect(result.authorBreakdown.agentLoreCommits).toBe(0);
      expect(result.authorBreakdown.humanLoreCommits).toBe(3);
      expect(result.authorBreakdown.agentAdoptionRate).toBe(0);
      expect(result.authorBreakdown.humanAdoptionRate).toBeGreaterThan(0);
    });

    it('should handle zero atoms with positive commits without division by zero', () => {
      const input: MetricsInput = {
        atoms: [],
        supersessionMap: new Map(),
        staleAtomIds: new Set(),
        totalCommitCount: 100,
        allRepoFiles: ['src/main.ts', 'src/util.ts'],
        since: null,
      };

      const result = collector.collectAll(input);

      expect(result.adoption.adoptionRate).toBe(0);
      expect(result.adoption.loreCommits).toBe(0);
      expect(result.adoption.totalCommits).toBe(100);
      expect(result.decisionDensity.atomsPerFile).toBe(0);
      expect(result.decisionDensity.blindSpotCount).toBe(2);
      expect(result.trailerCoverage.totalAtoms).toBe(0);
      expect(result.authorBreakdown.agentLoreCommits).toBe(0);
      expect(result.authorBreakdown.humanLoreCommits).toBe(0);
      expect(result.authorBreakdown.humanAdoptionRate).toBe(0);
    });
  });
});
