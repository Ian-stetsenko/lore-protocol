import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveLoreRoot } from '../../src/services/root-resolver.js';
import type { IConfigLoader } from '../../src/interfaces/config-loader.js';
import type { IGitClient } from '../../src/interfaces/git-client.js';

describe('resolveLoreRoot', () => {
  const mockConfigLoader = {
    findConfigPath: vi.fn(),
  } as unknown as IConfigLoader;

  const mockGitClient = {
    isInsideRepo: vi.fn(),
    getRepoRoot: vi.fn(),
  } as unknown as IGitClient;

  const cwd = '/users/dev/project/src';

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns the parent of .lore directory if config is found', async () => {
    const configPath = '/users/dev/project/.lore/config.toml';
    vi.mocked(mockConfigLoader.findConfigPath).mockResolvedValue(configPath);

    const root = await resolveLoreRoot(cwd, mockConfigLoader, mockGitClient);

    expect(root).toBe('/users/dev/project');
    expect(mockConfigLoader.findConfigPath).toHaveBeenCalledWith(cwd);
  });

  it('returns git root if no .lore is found but inside a repo', async () => {
    vi.mocked(mockConfigLoader.findConfigPath).mockResolvedValue(null);
    vi.mocked(mockGitClient.isInsideRepo).mockResolvedValue(true);
    vi.mocked(mockGitClient.getRepoRoot).mockResolvedValue('/users/dev/project');

    const root = await resolveLoreRoot(cwd, mockConfigLoader, mockGitClient);

    expect(root).toBe('/users/dev/project');
  });

  it('falls back to cwd if neither .lore nor git root is found', async () => {
    vi.mocked(mockConfigLoader.findConfigPath).mockResolvedValue(null);
    vi.mocked(mockGitClient.isInsideRepo).mockResolvedValue(false);

    const root = await resolveLoreRoot(cwd, mockConfigLoader, mockGitClient);

    expect(root).toBe(cwd);
  });

  it('falls back to cwd if an error occurs during resolution', async () => {
    vi.mocked(mockConfigLoader.findConfigPath).mockRejectedValue(new Error('FS Error'));

    const root = await resolveLoreRoot(cwd, mockConfigLoader, mockGitClient);

    expect(root).toBe(cwd);
  });

  it('prioritizes .lore directory over git root', async () => {
    // Scenario: A project inside a larger git repo, but with its own .lore
    const configPath = '/users/dev/project/sub-project/.lore/config.toml';
    vi.mocked(mockConfigLoader.findConfigPath).mockResolvedValue(configPath);
    vi.mocked(mockGitClient.isInsideRepo).mockResolvedValue(true);
    vi.mocked(mockGitClient.getRepoRoot).mockResolvedValue('/users/dev/project');

    const root = await resolveLoreRoot(cwd, mockConfigLoader, mockGitClient);

    expect(root).toBe('/users/dev/project/sub-project');
  });
});
