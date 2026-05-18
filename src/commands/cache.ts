import type { Command } from 'commander';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import { rm } from 'node:fs/promises';

/**
 * Register the `lore cache` command.
 * Provides management utilities for the local sharded cache.
 */
export function registerCacheCommand(
  program: Command,
  deps: {
    getFormatter: () => IOutputFormatter;
    cacheDir: string;
  },
): void {
  program
    .command('cache')
    .description('Manage the local Lore cache')
    .option('--clean', 'Clear all cached atom and query data')
    .action(async (options) => {
      const formatter = deps.getFormatter();

      if (options.clean) {
        try {
          await rm(deps.cacheDir, { recursive: true, force: true });
          console.log(formatter.formatSuccess('Successfully cleared local cache.'));
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(formatter.formatError(1, [{ severity: 'error', message: `Failed to clear cache: ${message}` }]));
          process.exitCode = 1;
          return;
        }
        return;
      }

      // If no options are provided, show help
      program.commands.find(c => c.name() === 'cache')?.help();
    });
}
