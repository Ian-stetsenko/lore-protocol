import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerCacheCommand } from '../../../src/commands/cache.js';
import type { IOutputFormatter } from '../../../src/interfaces/output-formatter.js';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

vi.mock('node:fs/promises');

describe('registerCacheCommand', () => {
  let program: Command;
  let formatter: IOutputFormatter;
  let consoleSpy: any;

  beforeEach(() => {
    vi.resetAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    formatter = {
      formatSuccess: vi.fn((m) => `SUCCESS: ${m}`),
      formatError: vi.fn((code, messages) => `ERROR ${code}: ${messages[0].message}`),
    } as any;

    program = new Command();
    program.exitOverride();
    registerCacheCommand(program, {
      getFormatter: () => formatter,
      cacheDir: join(process.cwd(), '.lore', 'cache'),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removes the cache directory when --clean is provided', async () => {
    vi.mocked(rm).mockResolvedValue(undefined);

    await program.parseAsync(['node', 'lore', 'cache', '--clean']);

    expect(rm).toHaveBeenCalledWith(
      expect.stringContaining(join('.lore', 'cache')),
      { recursive: true, force: true }
    );
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Successfully cleared local cache.'));
  });

  it('handles errors during cache removal', async () => {
    const error = new Error('Permission denied');
    vi.mocked(rm).mockRejectedValue(error);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const initialExitCode = process.exitCode;

    await program.parseAsync(['node', 'lore', 'cache', '--clean']);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to clear cache: Permission denied'));
    expect(process.exitCode).toBe(1);
    
    // Reset exitCode for other tests/runs
    process.exitCode = initialExitCode;
  });
});
