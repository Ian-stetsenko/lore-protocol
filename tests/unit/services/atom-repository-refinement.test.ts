import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchFilter } from "../../../src/services/search-filter.js";
import { AtomRepository } from '../../../src/services/atom-repository.js';
import { TrailerParser } from '../../../src/services/trailer-parser.js';
import type { IGitClient, RawCommit } from '../../../src/interfaces/git-client.js';
import type { QueryOptions } from '../../../src/types/query.js';

describe('AtomRepository Refinement', () => {
  let gitClient: IGitClient;
  let trailerParser: TrailerParser;
  let repo: AtomRepository;

  beforeEach(() => {
    gitClient = {
      log: vi.fn(),
      getFilesChanged: vi.fn().mockResolvedValue(['file.ts']),
    } as any;
    trailerParser = new TrailerParser();
    const searchFilter = new SearchFilter();
    repo = new AtomRepository(gitClient, trailerParser, searchFilter);
  });

  describe('stripTrailersFromBody (Internal Refinement)', () => {
    it('should remove trailers even with varying whitespace', async () => {
      const trailers = 'Lore-id: 12345678\nConfidence: high';
      const raw: RawCommit = {
        hash: 'h1',
        date: '2026-01-01T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: sub',
        body: 'Main body text.\n\n   Lore-id: 12345678  \n Confidence: high \n\n',
        trailers: trailers,
      };
      vi.mocked(gitClient.log).mockResolvedValue([raw]);

      const [atom] = await repo.findAll();
      expect(atom.body).toBe('Main body text.');
    });

    it('should not strip text that looks like a trailer but is in the middle of the body', async () => {
      const trailers = 'Lore-id: 12345678';
      const raw: RawCommit = {
        hash: 'h1',
        date: '2026-01-01T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: sub',
        body: 'This line looks like a trailer:\nConstraint: must be fast\n\nBut the real one is here.\n\nLore-id: 12345678',
        trailers: trailers,
      };
      vi.mocked(gitClient.log).mockResolvedValue([raw]);

      const [atom] = await repo.findAll();
      expect(atom.body).toContain('Constraint: must be fast');
      expect(atom.body).not.toContain('Lore-id: 12345678');
    });

    it('should handle empty bodies gracefully', async () => {
      const trailers = 'Lore-id: 12345678';
      const raw: RawCommit = {
        hash: 'h1',
        date: '2026-01-01T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: sub',
        body: trailers,
        trailers: trailers,
      };
      vi.mocked(gitClient.log).mockResolvedValue([raw]);

      const [atom] = await repo.findAll();
      expect(atom.body).toBe('');
    });
  });

  describe('followLinks Integration (End-to-End)', () => {
    it('should transitively resolve links when followLinks is enabled', async () => {
      const trailersA = 'Lore-id: aaaaaaaa\nRelated: bbbbbbbb';
      const trailersB = 'Lore-id: bbbbbbbb';

      const commitA: RawCommit = {
        hash: 'hash-a',
        date: '2026-01-01T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: a',
        body: 'Main body a',
        trailers: trailersA,
      };
      const commitB: RawCommit = {
        hash: 'hash-b',
        date: '2026-01-02T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: b',
        body: 'Main body b',
        trailers: trailersB,
      };

      vi.mocked(gitClient.log)
        .mockResolvedValueOnce([commitA])
        .mockResolvedValueOnce([commitB]);
      
      vi.mocked(gitClient.getFilesChanged)
        .mockResolvedValue(['file.ts']);

      const options: QueryOptions = {
        followLinks: true,
      };

      let atoms = await repo.findByTarget(['--', 'file.ts'], options);
      if (options.followLinks) {
        atoms = await repo.resolveFollowLinks(atoms, 1);
      }

      expect(atoms).toHaveLength(2);
      const ids = atoms.map(a => a.loreId);
      expect(ids).toContain('aaaaaaaa');
      expect(ids).toContain('bbbbbbbb');
      
      const secondCallArgs = vi.mocked(gitClient.log).mock.calls[1][0];
      expect(secondCallArgs).toContain('--grep=^Lore-id: bbbbbbbb');
    });
  });

  describe('findByLoreId Robustness (The "Three Pass" System)', () => {
    it('should correctly discard atoms where the target ID is in the body but trailers have a different ID', async () => {
      const targetId = '11111111';
      const actualId = '22222222';

      const commit: RawCommit = {
        hash: 'h-cross-talk',
        date: '2026-01-01T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: cross talk',
        body: `Some text...\nLore-id: ${targetId}\n...more text.`,
        trailers: `Lore-id: ${actualId}`,
      };

      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['file.ts']);

      const result = await repo.findByLoreId(targetId);

      expect(result).toBeNull();
    });

    it('should find the atom when trailers match exactly', async () => {
      const targetId = 'aaaaaaaa';
      const commit: RawCommit = {
        hash: 'h-match',
        date: '2026-01-01T00:00:00Z',
        author: 'a@b.com',
        subject: 'feat: match',
        body: 'Main body',
        trailers: `Lore-id: ${targetId}`,
      };

      vi.mocked(gitClient.log).mockResolvedValue([commit]);
      vi.mocked(gitClient.getFilesChanged).mockResolvedValue(['file.ts']);

      const result = await repo.findByLoreId(targetId);

      expect(result).not.toBeNull();
      expect(result!.loreId).toBe(targetId);
    });
  });
});
