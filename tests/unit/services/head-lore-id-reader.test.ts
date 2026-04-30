import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeadLoreIdReader } from '../../../src/services/head-lore-id-reader.js';
import { TrailerParser } from '../../../src/services/trailer-parser.js';
import type { IGitClient } from '../../../src/interfaces/git-client.js';

function createMockGitClient(headMessage: string): IGitClient {
  return {
    log: vi.fn(),
    blame: vi.fn(),
    commit: vi.fn(),
    hasStagedChanges: vi.fn(),
    getRepoRoot: vi.fn(),
    isInsideRepo: vi.fn(),
    getFilesChanged: vi.fn(),
    countCommitsSince: vi.fn(),
    resolveRef: vi.fn(),
    getHeadMessage: vi.fn().mockResolvedValue(headMessage),
  };
}

describe('HeadLoreIdReader', () => {
  let trailerParser: TrailerParser;

  beforeEach(() => {
    trailerParser = new TrailerParser();
  });

  it('should return Lore-id when HEAD has Lore trailers', async () => {
    const message = [
      'feat: add login flow',
      '',
      'Lore-id: a1b2c3d4',
      'Confidence: high',
    ].join('\n');

    const gitClient = createMockGitClient(message);
    const reader = new HeadLoreIdReader(gitClient, trailerParser);

    const result = await reader.read();

    expect(result).toBe('a1b2c3d4');
  });

  it('should return null when HEAD has no trailers', async () => {
    const message = 'feat: simple commit with no trailers';

    const gitClient = createMockGitClient(message);
    const reader = new HeadLoreIdReader(gitClient, trailerParser);

    const result = await reader.read();

    expect(result).toBeNull();
  });

  it('should return null when HEAD has trailers but no Lore-id', async () => {
    const message = [
      'feat: add feature',
      '',
      'Signed-off-by: Someone <someone@example.com>',
    ].join('\n');

    const gitClient = createMockGitClient(message);
    const reader = new HeadLoreIdReader(gitClient, trailerParser);

    const result = await reader.read();

    expect(result).toBeNull();
  });

  it('should handle empty commit message', async () => {
    const gitClient = createMockGitClient('');
    const reader = new HeadLoreIdReader(gitClient, trailerParser);

    const result = await reader.read();

    expect(result).toBeNull();
  });

  it('should return Lore-id from a full commit message with body', async () => {
    const message = [
      'feat: add authentication module',
      '',
      'This implements OAuth2 flow with PKCE.',
      'Includes refresh token rotation.',
      '',
      'Lore-id: deadbeef',
      'Constraint: Must use HTTPS',
      'Confidence: medium',
      'Scope-risk: moderate',
    ].join('\n');

    const gitClient = createMockGitClient(message);
    const reader = new HeadLoreIdReader(gitClient, trailerParser);

    const result = await reader.read();

    expect(result).toBe('deadbeef');
  });

  it('should return null when getHeadMessage throws (empty repo)', async () => {
    const gitClient = createMockGitClient('');
    vi.mocked(gitClient.getHeadMessage).mockRejectedValue(new Error('fatal: bad default revision'));
    const reader = new HeadLoreIdReader(gitClient, trailerParser);

    const result = await reader.read();

    expect(result).toBeNull();
  });

  it('should return null when Lore-id is not valid hex format', async () => {
    const message = [
      'feat: broken lore-id',
      '',
      'Lore-id: not-valid',
      'Confidence: high',
    ].join('\n');

    const gitClient = createMockGitClient(message);
    const reader = new HeadLoreIdReader(gitClient, trailerParser);

    const result = await reader.read();

    expect(result).toBeNull();
  });
});
