import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StalenessDetector } from '../../../src/services/staleness-detector.js';
import type { IGitClient } from '../../../src/interfaces/git-client.js';
import type { LoreConfig } from '../../../src/types/config.js';
import type { LoreAtom, LoreTrailers, SupersessionStatus } from '../../../src/types/domain.js';

function createMockGitClient(overrides: Partial<IGitClient> = {}): IGitClient {
  return {
    log: vi.fn(async () => []),
    blame: vi.fn(async () => []),
    commit: vi.fn(async () => ({ hash: 'abc123', success: true })),
    hasStagedChanges: vi.fn(async () => false),
    getRepoRoot: vi.fn(async () => '/repo'),
    isInsideRepo: vi.fn(async () => true),
    getFilesChanged: vi.fn(async () => []),
    countCommitsSince: vi.fn(async () => 0),
    resolveRef: vi.fn(async () => 'abc123'),
    ...overrides,
  };
}

function createDefaultConfig(overrides: Partial<LoreConfig['stale']> = {}): LoreConfig {
  return {
    protocol: { version: '1.0' },
    trailers: { required: [], custom: [] },
    validation: { strict: false, maxMessageLines: 50, intentMaxLength: 72 },
    stale: {
      olderThan: '6m',
      driftThreshold: 20,
      ...overrides,
    },
    output: { defaultFormat: 'text' },
    follow: { maxDepth: 3 },
  };
}

function makeAtom(options: {
  loreId?: string;
  commitHash?: string;
  date?: Date;
  author?: string;
  intent?: string;
  body?: string;
  confidence?: LoreTrailers['Confidence'];
  directives?: string[];
  dependsOn?: string[];
  supersedes?: string[];
  filesChanged?: string[];
}): LoreAtom {
  return {
    loreId: options.loreId ?? 'a1b2c3d4',
    commitHash: options.commitHash ?? 'abc12345',
    date: options.date ?? new Date('2025-01-15T10:00:00Z'),
    author: options.author ?? 'dev@example.com',
    intent: options.intent ?? 'feat: test commit',
    body: options.body ?? '',
    trailers: {
      'Lore-id': options.loreId ?? 'a1b2c3d4',
      Constraint: [],
      Rejected: [],
      Confidence: options.confidence ?? null,
      'Scope-risk': null,
      Reversibility: null,
      Directive: options.directives ?? [],
      Tested: [],
      'Not-tested': [],
      Supersedes: options.supersedes ?? [],
      'Depends-on': options.dependsOn ?? [],
      Related: [],
      custom: new Map(),
    } as LoreTrailers,
    filesChanged: options.filesChanged ?? [],
  };
}

function makeSupersessionMap(entries: Array<[string, { superseded: boolean; supersededBy: string | null }]>): Map<string, SupersessionStatus> {
  return new Map(entries);
}

describe('StalenessDetector', () => {
  let gitClient: IGitClient;
  let config: LoreConfig;
  let detector: StalenessDetector;

  beforeEach(() => {
    gitClient = createMockGitClient();
    config = createDefaultConfig();
    detector = new StalenessDetector(gitClient, config);
  });

  describe('analyze', () => {
    describe('age signal', () => {
      it('should detect atoms older than the configured threshold', async () => {
        // Atom is 1 year old, threshold is 6 months
        const oldDate = new Date();
        oldDate.setFullYear(oldDate.getFullYear() - 1);

        const atom = makeAtom({ date: oldDate });
        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(1);
        expect(result[0].reasons.some((r) => r.signal === 'age')).toBe(true);
      });

      it('should not flag atoms newer than the threshold', async () => {
        // Atom is 1 day old, threshold is 6 months
        const recentDate = new Date();
        recentDate.setDate(recentDate.getDate() - 1);

        const atom = makeAtom({ date: recentDate });
        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(0);
      });

      it('should respect custom age threshold', async () => {
        config = createDefaultConfig({ olderThan: '30d' });
        detector = new StalenessDetector(gitClient, config);

        // Atom is 60 days old, threshold is 30 days
        const date = new Date();
        date.setDate(date.getDate() - 60);

        const atom = makeAtom({ date });
        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(1);
        expect(result[0].reasons.some((r) => r.signal === 'age' && r.description.includes('threshold: 30d'))).toBe(true);
      });

      it('should handle year duration format', async () => {
        config = createDefaultConfig({ olderThan: '1y' });
        detector = new StalenessDetector(gitClient, config);

        // Atom is 2 years old
        const date = new Date();
        date.setFullYear(date.getFullYear() - 2);

        const atom = makeAtom({ date });
        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(1);
      });

      it('should handle week duration format', async () => {
        config = createDefaultConfig({ olderThan: '2w' });
        detector = new StalenessDetector(gitClient, config);

        // Atom is 3 weeks old
        const date = new Date();
        date.setDate(date.getDate() - 21);

        const atom = makeAtom({ date });
        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(1);
      });
    });

    describe('drift signal', () => {
      it('should detect files with too many commits since the atom', async () => {
        vi.mocked(gitClient.countCommitsSince).mockResolvedValue(25);

        const atom = makeAtom({
          date: new Date(), // recent, so age won't trigger
          filesChanged: ['src/auth.ts'],
        });

        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(1);
        expect(result[0].reasons.some((r) => r.signal === 'drift')).toBe(true);
        expect(result[0].reasons.some((r) => r.signal === 'drift' && r.description.includes('25 commits'))).toBe(true);
      });

      it('should not flag files under the drift threshold', async () => {
        vi.mocked(gitClient.countCommitsSince).mockResolvedValue(5);

        const atom = makeAtom({
          date: new Date(),
          filesChanged: ['src/auth.ts'],
        });

        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(0);
      });

      it('should check drift for each file in filesChanged', async () => {
        vi.mocked(gitClient.countCommitsSince)
          .mockResolvedValueOnce(5)   // auth.ts: under threshold
          .mockResolvedValueOnce(30); // db.ts: over threshold

        const atom = makeAtom({
          date: new Date(),
          filesChanged: ['src/auth.ts', 'src/db.ts'],
        });

        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(1);
        expect(result[0].reasons.some((r) => r.signal === 'drift' && r.description.includes('src/db.ts'))).toBe(true);
      });

      it('should handle errors from countCommitsSince gracefully', async () => {
        vi.mocked(gitClient.countCommitsSince).mockRejectedValue(new Error('file not found'));

        const atom = makeAtom({
          date: new Date(),
          filesChanged: ['deleted-file.ts'],
        });

        const result = await detector.analyze([atom], makeSupersessionMap([]));

        // Should not crash, and should not add a drift reason for the deleted file
        expect(result).toHaveLength(0);
      });

      it('should respect custom drift threshold', async () => {
        config = createDefaultConfig({ driftThreshold: 5 });
        detector = new StalenessDetector(gitClient, config);
        vi.mocked(gitClient.countCommitsSince).mockResolvedValue(10);

        const atom = makeAtom({
          date: new Date(),
          filesChanged: ['src/auth.ts'],
        });

        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(1);
        expect(result[0].reasons.some((r) => r.signal === 'drift' && r.description.includes('threshold: 5'))).toBe(true);
      });
    });

    describe('low confidence signal', () => {
      it('should detect atoms with Confidence: low', async () => {
        const atom = makeAtom({
          date: new Date(),
          confidence: 'low',
        });

        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(1);
        expect(result[0].reasons.some((r) => r.signal === 'low-confidence')).toBe(true);
      });

      it('should not flag atoms with Confidence: medium', async () => {
        const atom = makeAtom({
          date: new Date(),
          confidence: 'medium',
        });

        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(0);
      });

      it('should not flag atoms with Confidence: high', async () => {
        const atom = makeAtom({
          date: new Date(),
          confidence: 'high',
        });

        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(0);
      });

      it('should not flag atoms with null confidence', async () => {
        const atom = makeAtom({
          date: new Date(),
          confidence: null,
        });

        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(0);
      });
    });

    describe('expired hints signal', () => {
      it('should detect expired [until:YYYY-MM] directives', async () => {
        const atom = makeAtom({
          date: new Date(),
          directives: ['Migrate to v2 API [until:2024-06]'],
        });

        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(1);
        expect(result[0].reasons.some((r) => r.signal === 'expired-hint')).toBe(true);
        expect(result[0].reasons.some((r) => r.signal === 'expired-hint' && r.description.includes('until:2024-06'))).toBe(true);
      });

      it('should detect expired [until:YYYY-MM-DD] directives', async () => {
        const atom = makeAtom({
          date: new Date(),
          directives: ['Remove feature flag [until:2024-01-15]'],
        });

        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(1);
        expect(result[0].reasons.some((r) => r.signal === 'expired-hint' && r.description.includes('until:2024-01-15'))).toBe(true);
      });

      it('should not flag future [until:] directives', async () => {
        const futureDate = new Date();
        futureDate.setFullYear(futureDate.getFullYear() + 1);
        const futureStr = `${futureDate.getFullYear()}-12`;

        const atom = makeAtom({
          date: new Date(),
          directives: [`Migrate to v2 API [until:${futureStr}]`],
        });

        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(0);
      });

      it('should detect multiple expired hints in different directives', async () => {
        const atom = makeAtom({
          date: new Date(),
          directives: [
            'Task A [until:2024-01]',
            'Task B [until:2024-06]',
          ],
        });

        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(1);
        // Should have two expired hint reasons
        const expiredReasons = result[0].reasons.filter((r) => r.signal === 'expired-hint');
        expect(expiredReasons).toHaveLength(2);
      });

      it('should handle directives without [until:] hints', async () => {
        const atom = makeAtom({
          date: new Date(),
          directives: ['Keep this module small', 'Prefer composition over inheritance'],
        });

        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(0);
      });
    });

    describe('orphaned dependency signal', () => {
      it('should detect dependencies on superseded atoms', async () => {
        const atom = makeAtom({
          date: new Date(),
          dependsOn: ['bbbb2222'],
        });

        const supersessionMap = makeSupersessionMap([
          ['bbbb2222', { superseded: true, supersededBy: 'cccc3333' }],
        ]);

        const result = await detector.analyze([atom], supersessionMap);

        expect(result).toHaveLength(1);
        expect(result[0].reasons.some((r) => r.signal === 'orphaned-dep')).toBe(true);
        expect(result[0].reasons.some((r) => r.signal === 'orphaned-dep' && r.description.includes('bbbb2222'))).toBe(true);
      });

      it('should not flag dependencies on active atoms', async () => {
        const atom = makeAtom({
          date: new Date(),
          dependsOn: ['bbbb2222'],
        });

        const supersessionMap = makeSupersessionMap([
          ['bbbb2222', { superseded: false, supersededBy: null }],
        ]);

        const result = await detector.analyze([atom], supersessionMap);

        expect(result).toHaveLength(0);
      });

      it('should not flag dependencies on unknown atoms', async () => {
        const atom = makeAtom({
          date: new Date(),
          dependsOn: ['bbbb2222'],
        });

        // Empty map: dependency not found in the supersession map
        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(0);
      });

      it('should detect multiple orphaned dependencies', async () => {
        const atom = makeAtom({
          date: new Date(),
          dependsOn: ['bbbb2222', 'cccc3333'],
        });

        const supersessionMap = makeSupersessionMap([
          ['bbbb2222', { superseded: true, supersededBy: 'dddd4444' }],
          ['cccc3333', { superseded: true, supersededBy: 'eeee5555' }],
        ]);

        const result = await detector.analyze([atom], supersessionMap);

        expect(result).toHaveLength(1);
        const orphanReasons = result[0].reasons.filter((r) => r.signal === 'orphaned-dep');
        expect(orphanReasons).toHaveLength(2);
      });

      it('should skip invalid Lore-id references in depends-on', async () => {
        const atom = makeAtom({
          date: new Date(),
          dependsOn: ['not-valid-id'],
        });

        const supersessionMap = makeSupersessionMap([
          ['not-valid-id', { superseded: true, supersededBy: 'aaaa1111' }],
        ]);

        const result = await detector.analyze([atom], supersessionMap);

        expect(result).toHaveLength(0);
      });
    });

    describe('combined signals', () => {
      it('should report multiple staleness reasons for one atom', async () => {
        vi.mocked(gitClient.countCommitsSince).mockResolvedValue(30);

        const oldDate = new Date();
        oldDate.setFullYear(oldDate.getFullYear() - 2);

        const atom = makeAtom({
          date: oldDate,
          confidence: 'low',
          directives: ['Remove flag [until:2024-01]'],
          filesChanged: ['src/auth.ts'],
          dependsOn: ['bbbb2222'],
        });

        const supersessionMap = makeSupersessionMap([
          ['bbbb2222', { superseded: true, supersededBy: 'cccc3333' }],
        ]);

        const result = await detector.analyze([atom], supersessionMap);

        expect(result).toHaveLength(1);
        // Should have all 5 signals
        expect(result[0].reasons.some((r) => r.signal === 'age')).toBe(true);
        expect(result[0].reasons.some((r) => r.signal === 'drift')).toBe(true);
        expect(result[0].reasons.some((r) => r.signal === 'low-confidence')).toBe(true);
        expect(result[0].reasons.some((r) => r.signal === 'expired-hint')).toBe(true);
        expect(result[0].reasons.some((r) => r.signal === 'orphaned-dep')).toBe(true);
      });

      it('should not report atoms with no staleness signals', async () => {
        const atom = makeAtom({ date: new Date() });

        const result = await detector.analyze([atom], makeSupersessionMap([]));

        expect(result).toHaveLength(0);
      });

      it('should analyze multiple atoms independently', async () => {
        const oldDate = new Date();
        oldDate.setFullYear(oldDate.getFullYear() - 1);

        const staleAtom = makeAtom({ loreId: 'aaaa1111', date: oldDate });
        const freshAtom = makeAtom({ loreId: 'bbbb2222', date: new Date() });

        const result = await detector.analyze([staleAtom, freshAtom], makeSupersessionMap([]));

        expect(result).toHaveLength(1);
        expect(result[0].atom.loreId).toBe('aaaa1111');
      });

      it('should handle empty atom list', async () => {
        const result = await detector.analyze([], makeSupersessionMap([]));

        expect(result).toHaveLength(0);
      });
    });
  });
});
