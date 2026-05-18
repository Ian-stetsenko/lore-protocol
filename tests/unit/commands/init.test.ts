import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerInitCommand } from '../../../src/commands/init.js';
import type { IOutputFormatter } from '../../../src/interfaces/output-formatter.js';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

vi.mock('node:fs/promises');

describe('registerInitCommand', () => {
  let program: Command;
  let formatter: IOutputFormatter;
  let consoleSpy: any;

  beforeEach(() => {
    vi.resetAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    formatter = {
      formatSuccess: vi.fn((m) => `SUCCESS: ${m}`),
      formatError: vi.fn((m) => `ERROR: ${m}`),
    } as any;

    program = new Command();
    program.exitOverride();
    registerInitCommand(program, { getFormatter: () => formatter });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates .lore/config.toml and .gitignore when they do not exist', async () => {
    // access throws for all files
    vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    await program.parseAsync(['node', 'lore', 'init']);

    // Check directory creation
    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining('.lore'), { recursive: true });
    
    // Check config creation
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining(join('.lore', 'config.toml')),
      expect.stringContaining('version = "1.0"'),
      'utf-8'
    );

    // Check .gitignore creation
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.gitignore'),
      '.lore/cache\n',
      'utf-8'
    );

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Created .lore/config.toml'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Created .gitignore to ignore .lore/cache'));
  });

  it('updates existing .gitignore if .lore/cache is missing', async () => {
    // Config exists, but .gitignore exists without the pattern
    vi.mocked(access).mockResolvedValue(undefined); // config exists
    vi.mocked(readFile).mockImplementation(async (path: any) => {
      if (path.toString().endsWith('.gitignore')) return 'node_modules\n';
      return 'existing config content';
    });
    vi.mocked(writeFile).mockResolvedValue(undefined);

    await program.parseAsync(['node', 'lore', 'init']);

    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.gitignore'),
      'node_modules\n.lore/cache\n',
      'utf-8'
    );
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Updated .gitignore to ignore .lore/cache'));
  });

  it('does not update .gitignore if .lore/cache is already present', async () => {
    vi.mocked(access).mockResolvedValue(undefined);
    vi.mocked(readFile).mockImplementation(async (path: any) => {
      if (path.toString().endsWith('.gitignore')) return 'node_modules\n.lore/cache\n';
      return 'existing config';
    });

    await program.parseAsync(['node', 'lore', 'init']);

    // writeFile should NOT be called for .gitignore
    const gitignoreCalls = vi.mocked(writeFile).mock.calls.filter(call => call[0].toString().endsWith('.gitignore'));
    expect(gitignoreCalls).toHaveLength(0);
  });

  it('handles existing .gitignore without a trailing newline', async () => {
    vi.mocked(access).mockResolvedValue(undefined);
    vi.mocked(readFile).mockImplementation(async (path: any) => {
      if (path.toString().endsWith('.gitignore')) return 'node_modules'; // No newline
      return 'existing config';
    });

    await program.parseAsync(['node', 'lore', 'init']);

    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.gitignore'),
      'node_modules\n.lore/cache\n',
      'utf-8'
    );
  });
});
