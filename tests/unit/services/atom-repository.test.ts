import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AtomRepository } from '../../../src/services/atom-repository.js';
import type { IGitClient, RawCommit } from '../../../src/interfaces/git-client.js';
import type { PathQueryOptions } from '../../../src/types/query.js';
import type { LoreTrailers } from '../../../src/types/domain.js';
import { CustomTrailerCollection } from '../../../src/types/custom-trailer-collection.js';

/**
 * Minimal TrailerParser mock that satisfies the AtomRepository's usage.
 */
function createMockTrailerParser() {
  return {
    containsLoreTrailers: vi.fn((text: string) => text.includes('Lore-id')),
    parse: vi.fn((rawTrailers: string, _customKeys: readonly string[]): LoreTrailers => {
      const trailers = parseTrailersFromText(rawTrailers);
      return trailers;
    }),
    serialize: vi.fn(() => ''),
    extractTrailerBlock: vi.fn(() => ''),
  };
}

/**
 * Simple trailer text parser for tests.
 * Extracts key: value pairs from a multi-line trailer block.
 */
function parseTrailersFromText(raw: string): LoreTrailers {
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  let loreId = '';
  const constraints: string[] = [];
  const rejected: string[] = [];
  let confidence: LoreTrailers['Confidence'] = null;
  let scopeRisk: LoreTrailers['Scope-risk'] = null;
  let reversibility: LoreTrailers['Reversibility'] = null;
  const directives: string[] = [];
  const tested: string[] = [];
  const notTested: string[] = [];
  const supersedes: string[] = [];
  const dependsOn: string[] = [];
  const related: string[] = [];

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).trim();
    const value = line.substring(colonIdx + 1).trim();

    switch (key) {
      case 'Lore-id': loreId = value; break;
      case 'Constraint': constraints.push(value); break;
      case 'Rejected': rejected.push(value); break;
      case 'Confidence': confidence = value as LoreTrailers['Confidence']; break;
      case 'Scope-risk': scopeRisk = value as LoreTrailers['Scope-risk']; break;
      case 'Reversibility': reversibility = value as LoreTrailers['Reversibility']; break;
      case 'Directive': directives.push(value); break;
      case 'Tested': tested.push(value); break;
      case 'Not-tested': notTested.push(value); break;
      case 'Supersedes': supersedes.push(value); break;
      case 'Depends-on': dependsOn.push(value); break;
      case 'Related': related.push(value); break;
    }
  }

  return {
    'Lore-id': loreId,
    Constraint: constraints,
    Rejected: rejected,
    Confidence: confidence,
    'Scope-risk': scopeRisk,
    Reversibility: reversibility,
    Directive: directives,
    Tested: tested,
    'Not-tested': notTested,
    Supersedes: supersedes,
    'Depends-on': dependsOn,
    Related: related,
    custom: CustomTrailerCollection.empty(),
  };
}

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

function makeLoreCommit(options: {
  hash?: string;
  date?: string;
  author?: string;
  subject?: string;
  body?: string;
  loreId?: string;
  trailerExtras?: string;
}): RawCommit {
  const loreId = options.loreId ?? 'a1b2c3d4';
  const extras = options.trailerExtras ?? '';
  return {
    hash: options.hash ?? 'abc12345',
    date: options.date ?? '2025-01-15T10:00:00Z',
    author: options.author ?? 'dev@example.com',
    subject: options.subject ?? 'feat(auth): add login',
    body: options.body ?? 'Implemented login flow.',
    trailers: `Lore-id: ${loreId}\n${extras}`.trim(),
  };
}

function makeGitLogArgs(filePath: string = 'src/auth.ts'): readonly string[] {
  return ['--', filePath];
}

function makeQueryOptions(overrides: Partial<PathQueryOptions> = {}): PathQueryOptions {
  return {
    scope: null,
    follow: false,
    all: false,
    author: null,
    limit: null,
    maxCommits: null,
    since: null,
    ...overrides,
  };
}

describe('AtomRepository', () => {
  let gitClient: IGitClient;
  let trailerParser: ReturnType<typeof createMockTrailerParser>;
  let repo: AtomRepository;

  beforeEach(() => {
    gitClient = createMockGitClient();
    trailerParser = createMockTrailerParser();
    repo = new AtomRepository(gitClient, trailerParser as any);
  });

  describe('findByTarget', () => {
    it('should return atoms for a file target', async () => {
      const commit = makeLoreCommit({ loreId: 'a1b2c3d4' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['src/auth.ts']);

      const gitLogArgs = makeGitLogArgs();
      const options = makeQueryOptions();
      const result = await repo.findByTarget(gitLogArgs, options);

      expect(result).toHaveLength(1);
      expect(result[0].loreId).toBe('a1b2c3d4');
      expect(result[0].commitHash).toBe('abc12345');
      expect(result[0].author).toBe('dev@example.com');
      expect(result[0].filesChanged).toEqual(['src/auth.ts']);
    });

    it('should filter out non-Lore commits', async () => {
      const loreCommit = makeLoreCommit({ loreId: 'a1b2c3d4' });
      const nonLoreCommit: RawCommit = {
        hash: 'def456',
        date: '2025-01-16T10:00:00Z',
        author: 'dev@example.com',
        subject: 'chore: update deps',
        body: '',
        trailers: '',
      };

      vi.mocked(gitClient.log).mockResolvedValue([loreCommit, nonLoreCommit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['src/auth.ts']);

      const result = await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      expect(result).toHaveLength(1);
      expect(result[0].loreId).toBe('a1b2c3d4');
    });

    it('should pass author filter to git log args', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const options = makeQueryOptions({ author: 'alice@example.com' });
      await repo.findByTarget(makeGitLogArgs(), options);

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--author=alice@example.com');
    });

    it('should pass since filter to git log args', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const options = makeQueryOptions({ since: '2025-01-01' });
      await repo.findByTarget(makeGitLogArgs(), options);

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--since=2025-01-01');
    });

    it('should pass maxCommits to git log args', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const options = makeQueryOptions({ maxCommits: 5 });
      await repo.findByTarget(makeGitLogArgs(), options);

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--max-count=5');
    });

    it('should return empty array when no commits match', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const result = await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      expect(result).toEqual([]);
    });

    it('should apply author filter at the application level', async () => {
      const commit1 = makeLoreCommit({ hash: 'aaa', author: 'alice@example.com', loreId: 'aaaa1111' });
      const commit2 = makeLoreCommit({ hash: 'bbb', author: 'bob@example.com', loreId: 'bbbb2222' });
      vi.mocked(gitClient.log).mockResolvedValue([commit1, commit2]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['src/auth.ts']);

      const options = makeQueryOptions({ author: 'alice' });
      const result = await repo.findByTarget(makeGitLogArgs(), options);

      expect(result).toHaveLength(1);
      expect(result[0].author).toBe('alice@example.com');
    });

    it('should not apply limit at the repository level (caller responsibility)', async () => {
      const commits = [
        makeLoreCommit({ hash: 'aaa', loreId: 'aaaa1111' }),
        makeLoreCommit({ hash: 'bbb', loreId: 'bbbb2222' }),
        makeLoreCommit({ hash: 'ccc', loreId: 'cccc3333' }),
      ];
      vi.mocked(gitClient.log).mockResolvedValue(commits);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['src/auth.ts']);

      const options = makeQueryOptions({ limit: 2 });
      const result = await repo.findByTarget(makeGitLogArgs(), options);

      expect(result).toHaveLength(3);
    });
  });

  describe('findByLoreId', () => {
    it('should find an atom by its Lore-id', async () => {
      const commit = makeLoreCommit({ loreId: 'deadbeef' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['src/auth.ts']);

      const result = await repo.findByLoreId('deadbeef');

      expect(result).not.toBeNull();
      expect(result!.loreId).toBe('deadbeef');
    });

    it('should return null if no atom matches the Lore-id', async () => {
      const commit = makeLoreCommit({ loreId: 'a1b2c3d4' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue([]);

      const result = await repo.findByLoreId('deadbeef');

      expect(result).toBeNull();
    });

    it('should return null for invalid Lore-id format', async () => {
      const result = await repo.findByLoreId('not-valid');

      expect(result).toBeNull();
      expect(gitClient.log).not.toHaveBeenCalled();
    });

    it('should return null for empty Lore-id', async () => {
      const result = await repo.findByLoreId('');

      expect(result).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all Lore atoms', async () => {
      const commits = [
        makeLoreCommit({ hash: 'aaa', loreId: 'aaaa1111' }),
        makeLoreCommit({ hash: 'bbb', loreId: 'bbbb2222' }),
      ];
      vi.mocked(gitClient.log).mockResolvedValue(commits);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue([]);

      const result = await repo.findAll();

      expect(result).toHaveLength(2);
    });

    it('should strip trailers from body when body is exactly the trailer block', async () => {
      const trailersRaw = 'Lore-id: aaaa1111\nDirective: keep simple';
      const commit: RawCommit = {
        hash: 'aaa',
        date: '2025-01-15T10:00:00Z',
        author: 'dev@example.com',
        subject: 'feat: no body',
        body: trailersRaw,
        trailers: trailersRaw,
      };
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue([]);

      const result = await repo.findAll();

      expect(result).toHaveLength(1);
      expect(result[0].body).toBe('');
    });

    it('should pass since option to git log', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await repo.findAll({ since: '2025-01-01' });

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--since=2025-01-01');
    });

    it('should pass until option to git log', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await repo.findAll({ until: '2025-06-01' });

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--until=2025-06-01');
    });

    it('should pass maxCommits option to git log', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await repo.findAll({ maxCommits: 10 });

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--max-count=10');
    });

    it('should return empty array when no Lore commits exist', async () => {
      const nonLoreCommit: RawCommit = {
        hash: 'abc',
        date: '2025-01-15T10:00:00Z',
        author: 'dev@example.com',
        subject: 'chore: update deps',
        body: '',
        trailers: '',
      };
      vi.mocked(gitClient.log).mockResolvedValue([nonLoreCommit]);

      const result = await repo.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('findByScope', () => {
    it('should find atoms matching the scope', async () => {
      const authCommit = makeLoreCommit({ subject: 'feat(auth): add login', loreId: 'aaaa1111' });
      const dbCommit = makeLoreCommit({ subject: 'fix(database): fix query', loreId: 'bbbb2222' });
      vi.mocked(gitClient.log).mockResolvedValue([authCommit, dbCommit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue([]);

      const result = await repo.findByScope('auth', makeQueryOptions());

      expect(result).toHaveLength(1);
      expect(result[0].loreId).toBe('aaaa1111');
    });

    it('should match scope case-insensitively', async () => {
      const commit = makeLoreCommit({ subject: 'feat(Auth): add login', loreId: 'aaaa1111' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue([]);

      const result = await repo.findByScope('auth', makeQueryOptions());

      expect(result).toHaveLength(1);
    });

    it('should return empty array when no scope matches', async () => {
      const commit = makeLoreCommit({ subject: 'feat(auth): add login', loreId: 'aaaa1111' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue([]);

      const result = await repo.findByScope('payments', makeQueryOptions());

      expect(result).toEqual([]);
    });

    it('should handle commits without scope in subject', async () => {
      const commit = makeLoreCommit({ subject: 'fix: typo', loreId: 'aaaa1111' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue([]);

      const result = await repo.findByScope('auth', makeQueryOptions());

      expect(result).toEqual([]);
    });
  });

  describe('resolveFollowLinks', () => {
    it('should resolve atoms referenced by Related trailers', async () => {
      const atom1Trailers = 'Lore-id: aaaa1111\nRelated: bbbb2222';
      const atom2Trailers = 'Lore-id: bbbb2222';

      const commit1 = makeLoreCommit({ hash: 'aaa', loreId: 'aaaa1111', trailerExtras: 'Related: bbbb2222' });
      const commit2 = makeLoreCommit({ hash: 'bbb', loreId: 'bbbb2222' });

      // First call for initial atoms, second call for findByLoreId
      vi.mocked(gitClient.log).mockResolvedValue([commit1, commit2]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue([]);

      // Parse the initial atoms ourselves
      const initialAtoms = [{
        loreId: 'aaaa1111',
        commitHash: 'aaa',
        date: new Date('2025-01-15T10:00:00Z'),
        author: 'dev@example.com',
        intent: 'feat(auth): add login',
        body: '',
        trailers: {
          'Lore-id': 'aaaa1111',
          Constraint: [],
          Rejected: [],
          Confidence: null,
          'Scope-risk': null,
          Reversibility: null,
          Directive: [],
          Tested: [],
          'Not-tested': [],
          Supersedes: [],
          'Depends-on': [],
          Related: ['bbbb2222'],
          custom: CustomTrailerCollection.empty(),
        } as LoreTrailers,
        filesChanged: [],
      }];

      const result = await repo.resolveFollowLinks(initialAtoms, 2);

      expect(result).toHaveLength(2);
      const ids = result.map((a) => a.loreId);
      expect(ids).toContain('aaaa1111');
      expect(ids).toContain('bbbb2222');
    });

    it('should return original atoms when maxDepth is 0', async () => {
      const atoms = [{
        loreId: 'aaaa1111',
        commitHash: 'aaa',
        date: new Date(),
        author: 'dev@example.com',
        intent: 'test',
        body: '',
        trailers: {
          'Lore-id': 'aaaa1111',
          Constraint: [],
          Rejected: [],
          Confidence: null,
          'Scope-risk': null,
          Reversibility: null,
          Directive: [],
          Tested: [],
          'Not-tested': [],
          Supersedes: [],
          'Depends-on': [],
          Related: ['bbbb2222'],
          custom: CustomTrailerCollection.empty(),
        } as LoreTrailers,
        filesChanged: [],
      }];

      const result = await repo.resolveFollowLinks(atoms, 0);

      expect(result).toHaveLength(1);
      expect(result[0].loreId).toBe('aaaa1111');
    });

    it('should return original atoms when no follow links exist', async () => {
      const atoms = [{
        loreId: 'aaaa1111',
        commitHash: 'aaa',
        date: new Date(),
        author: 'dev@example.com',
        intent: 'test',
        body: '',
        trailers: {
          'Lore-id': 'aaaa1111',
          Constraint: [],
          Rejected: [],
          Confidence: null,
          'Scope-risk': null,
          Reversibility: null,
          Directive: [],
          Tested: [],
          'Not-tested': [],
          Supersedes: [],
          'Depends-on': [],
          Related: [],
          custom: CustomTrailerCollection.empty(),
        } as LoreTrailers,
        filesChanged: [],
      }];

      const result = await repo.resolveFollowLinks(atoms, 3);

      expect(result).toHaveLength(1);
    });

    it('should handle circular references without infinite loop', async () => {
      // Atom A references B, Atom B references A
      const commitA = makeLoreCommit({ hash: 'aaa', loreId: 'aaaa1111', trailerExtras: 'Related: bbbb2222' });
      const commitB = makeLoreCommit({ hash: 'bbb', loreId: 'bbbb2222', trailerExtras: 'Related: aaaa1111' });

      vi.mocked(gitClient.log).mockResolvedValue([commitA, commitB]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue([]);

      const atomA = {
        loreId: 'aaaa1111',
        commitHash: 'aaa',
        date: new Date(),
        author: 'dev@example.com',
        intent: 'test',
        body: '',
        trailers: {
          'Lore-id': 'aaaa1111',
          Constraint: [],
          Rejected: [],
          Confidence: null,
          'Scope-risk': null,
          Reversibility: null,
          Directive: [],
          Tested: [],
          'Not-tested': [],
          Supersedes: [],
          'Depends-on': [],
          Related: ['bbbb2222'],
          custom: CustomTrailerCollection.empty(),
        } as LoreTrailers,
        filesChanged: [],
      };

      const result = await repo.resolveFollowLinks([atomA], 5);

      expect(result).toHaveLength(2);
    });

    it('should not exceed maxDepth in transitive resolution', async () => {
      // Chain: A -> B -> C -> D, but maxDepth = 1
      const commitB = makeLoreCommit({ hash: 'bbb', loreId: 'bbbb2222', trailerExtras: 'Related: cccc3333' });
      const commitC = makeLoreCommit({ hash: 'ccc', loreId: 'cccc3333', trailerExtras: 'Related: dddd4444' });
      const commitD = makeLoreCommit({ hash: 'ddd', loreId: 'dddd4444' });

      // findByLoreId will search all commits
      vi.mocked(gitClient.log).mockResolvedValue([commitB, commitC, commitD]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue([]);

      const atomA = {
        loreId: 'aaaa1111',
        commitHash: 'aaa',
        date: new Date(),
        author: 'dev@example.com',
        intent: 'test',
        body: '',
        trailers: {
          'Lore-id': 'aaaa1111',
          Constraint: [],
          Rejected: [],
          Confidence: null,
          'Scope-risk': null,
          Reversibility: null,
          Directive: [],
          Tested: [],
          'Not-tested': [],
          Supersedes: [],
          'Depends-on': [],
          Related: ['bbbb2222'],
          custom: CustomTrailerCollection.empty(),
        } as LoreTrailers,
        filesChanged: [],
      };

      const result = await repo.resolveFollowLinks([atomA], 1);

      // Should find A and B only (depth 1), not C or D
      expect(result).toHaveLength(2);
      const ids = result.map((a) => a.loreId);
      expect(ids).toContain('aaaa1111');
      expect(ids).toContain('bbbb2222');
    });

    it('should return empty array for empty input', async () => {
      const result = await repo.resolveFollowLinks([], 3);
      expect(result).toEqual([]);
    });
  });

  describe('git log format', () => {
    it('should pass args to git client log (format is applied by GitClient)', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      await repo.findAll();

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      // The format string is now applied by GitClient.log(), not AtomRepository
      expect(Array.isArray(logArgs)).toBe(true);
    });

    it('should pass pre-resolved git log args including -- separator to git client', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);

      const gitLogArgs = ['--', 'src/auth.ts'];
      await repo.findByTarget(gitLogArgs, makeQueryOptions());

      const logArgs = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(logArgs).toContain('--');
      expect(logArgs).toContain('src/auth.ts');
    });
  });

  describe('batching behavior', () => {
    it('should call getFilesChanged only for Lore commits, not non-Lore commits', async () => {
      const loreCommit = makeLoreCommit({ loreId: 'aaaa1111' });
      const nonLoreCommit: RawCommit = {
        hash: 'non-lore',
        date: '2025-01-16T10:00:00Z',
        author: 'dev@example.com',
        subject: 'chore: deps',
        body: '',
        trailers: '',
      };
      vi.mocked(gitClient.log).mockResolvedValue([loreCommit, nonLoreCommit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['src/auth.ts']);

      await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      expect(gitClient.getFilesChanged).toHaveBeenCalledTimes(1);
      expect(gitClient.getFilesChanged).toHaveBeenCalledWith('abc12345');
    });

    it('should handle more commits than batch size', async () => {
      const commits = Array.from({ length: 25 }, (_, i) =>
        makeLoreCommit({ hash: `hash${i}`, loreId: `${String(i).padStart(8, '0')}` }),
      );
      vi.mocked(gitClient.log).mockResolvedValue(commits);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['file.ts']);

      const result = await repo.findByTarget(makeGitLogArgs(), makeQueryOptions());

      expect(result).toHaveLength(25);
      expect(gitClient.getFilesChanged).toHaveBeenCalledTimes(25);
    });

    it('should propagate getFilesChanged errors', async () => {
      const commit = makeLoreCommit({ loreId: 'deadbeef' });
      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockRejectedValue(new Error('git failed'));

      await expect(
        repo.findByTarget(makeGitLogArgs(), makeQueryOptions()),
      ).rejects.toThrow('git failed');
    });
  });
});
