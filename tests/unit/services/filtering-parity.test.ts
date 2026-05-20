import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchFilter } from "../../../src/services/search-filter.js";
import { AtomRepository } from '../../../src/services/atom-repository.js';
import { TrailerParser } from '../../../src/services/trailer-parser.js';
import type { IGitClient, RawCommit } from '../../../src/interfaces/git-client.js';
import type { PathQueryOptions } from '../../../src/types/query.js';

describe('AtomRepository Filtering Parity', () => {
  let gitClient: IGitClient;
  let trailerParser: TrailerParser;
  let repo: AtomRepository;

  const mockAtoms: RawCommit[] = [
    {
      hash: 'hash1',
      date: '2026-05-01T12:00:00Z',
      author: 'cole@example.com',
      subject: 'feat(auth): valid login',
      body: 'Body text here',
      trailers: 'Lore-id: abc12345\nConfidence: high',
    },
    {
      hash: 'hash2',
      date: '2026-05-02T12:00:00Z',
      author: 'ivan@example.com',
      subject: 'fix(ui): layout bug',
      body: 'Body text here',
      trailers: 'Lore-id: def67890\nConfidence: low',
    },
    {
      hash: 'hash3',
      date: '2026-05-03T12:00:00Z',
      author: 'cole@example.com',
      subject: 'feat(api): endpoint',
      body: 'Search for "login" here but not in subject',
      trailers: 'Lore-id: 01234567\nConfidence: medium',
    },
    {
      hash: 'hash4',
      date: '2026-05-04T12:00:00Z',
      author: 'other@example.com',
      subject: 'chore: no lore here',
      body: 'just text',
      trailers: '', // Missing Lore-id
    },
    {
      hash: 'hash5',
      date: '2026-05-05T12:00:00Z',
      author: 'false-positive-login@example.com',
      subject: 'feat(api): false positive',
      body: 'No match here',
      trailers: 'Lore-id: fedcba98\nConfidence: high\nConstraint: This commit matches in email only',
    },
  ];

  beforeEach(() => {
    gitClient = {
      log: vi.fn(),
      resolveRef: vi.fn().mockResolvedValue('head-hash'),
      getFilesChanged: vi.fn().mockResolvedValue(['src/file.ts']),
      getCommitsByHashes: vi.fn(),
    } as any;

    trailerParser = new TrailerParser();

    const searchFilter = new SearchFilter();

    repo = new AtomRepository(
      gitClient,
      trailerParser, searchFilter,
    );
  });

  describe('Discovery Phase (Git Coarse Filtering)', () => {
    it('should always include Atom Discovery Mode flags (Lore-id sentinel)', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      await repo.findAll();
      
      const args = vi.mocked(gitClient.log).mock.calls[0][0];

      expect(args).toContain('--grep=^Lore-id: [0-9a-f]{8}');
      expect(args).toContain('--extended-regexp');
      expect(args).toContain('--regexp-ignore-case');
      expect(args).toContain('--all-match');
    });

    it('should generate correct Git flags for author and scope with Discovery Mode', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      const options = {
        author: 'cole',
        scope: 'auth',
      };

      await repo.findAll(options);
      const args = vi.mocked(gitClient.log).mock.calls[0][0];

      expect(args).toContain('--author=cole');
      expect(args).toContain('--regexp-ignore-case');
      expect(args).toContain('--all-match');
      // Scope regex check
      expect(args).toContain('--grep=^[a-zA-Z]+\\(auth\\)');
      expect(args).toContain('--extended-regexp');
    });

    it('should generate correct Git flags for the "has" trailer filter', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      await repo.findAll({ has: 'Constraint' });
      
      const args = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(args).toContain('--grep=^Constraint: ');
    });

    it('should generate correct Git flags for Enum filters (pushdown)', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      await repo.findAll({
        confidence: 'high',
        scopeRisk: 'narrow',
        reversibility: 'clean',
      });
      
      const args = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(args).toContain('--grep=^Confidence: high');
      expect(args).toContain('--grep=^Scope-risk: narrow');
      expect(args).toContain('--grep=^Reversibility: clean');
    });

    it('should generate correct Git flags for full-text search (pushdown)', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      await repo.findAll({ text: 'login logic' });
      
      const args = vi.mocked(gitClient.log).mock.calls[0][0];
      expect(args).toContain('--grep=login logic');
    });

    it('should escape regex special characters in scope and loreId (Security)', async () => {
      vi.mocked(gitClient.log).mockResolvedValue([]);
      
      // Test scope escaping
      await repo.findAll({ scope: 'auth)' });
      let args = vi.mocked(gitClient.log).mock.calls[0][0];
      // Expected: ^[a-zA-Z]+\(auth\)\)
      // Since it's passed as a literal string to execFile, no extra JS backslashes are needed in the match
      expect(args).toContain('--grep=^[a-zA-Z]+\\(auth\\)\\)');

      // Test loreId in findByLoreId (which also uses escapeRegex)
      await repo.findByLoreId('abc12345');
      args = vi.mocked(gitClient.log).mock.calls[1][0];
      expect(args).toContain('--grep=^Lore-id: abc12345');
    });
  });

  describe('Refinement Phase (Lore Fine Filtering)', () => {
    it('should correctly narrow results even if Git produces false positives', async () => {
      // Simulate Git returning everything (no coarse filtering)
      vi.mocked(gitClient.log).mockResolvedValue(mockAtoms);

      const result = await repo.findAll({
        author: 'cole',
        scope: 'auth',
      });

      expect(result).toHaveLength(1);
      expect(result[0].commitHash).toBe('hash1');
    });

    it('should correctly refine results for Enums and Has', async () => {
      vi.mocked(gitClient.log).mockResolvedValue(mockAtoms);

      // Only hash1 is high confidence
      const resultConf = await repo.findAll({ confidence: 'high' });
      expect(resultConf).toHaveLength(2); // hash1 and hash5
      
      // hash5 has a Constraint trailer
      const resultHas = await repo.findAll({ has: 'Constraint' });
      expect(resultHas).toHaveLength(1);
      expect(resultHas[0].commitHash).toBe('hash5');
    });

    it('should correctly refine results for full-text search', async () => {
      vi.mocked(gitClient.log).mockResolvedValue(mockAtoms);

      // Search for "login" which is in body of hash3 but not subject
      const result = await repo.findAll({ text: 'login' });
      expect(result).toHaveLength(2); // hash1 (subject) and hash3 (body)
      const hashes = result.map(a => a.commitHash);
      expect(hashes).toContain('hash1');
      expect(hashes).toContain('hash3');
    });
  });

  describe('Integration of Filters', () => {
    it('behaves as an AND operation across different filter types', async () => {
      vi.mocked(gitClient.log).mockResolvedValue(mockAtoms);

      const options: Partial<QueryOptions> = {
        author: 'cole',
        scope: 'api',
      };

      const result = await repo.findAll(options);

      // Only hash3 matches both
      expect(result).toHaveLength(1);
      expect(result[0].commitHash).toBe('hash3');
    });
  });
});
