import type { Command } from 'commander';
import { executePathQuery, addPathQueryOptions, type PathQueryDeps, type PathQueryCommandOptions } from './helpers/path-query.js';

/**
 * Register the `lore context <target>` command.
 * Full lore summary showing ALL trailer types.
 */
export function registerContextCommand(
  program: Command,
  deps: PathQueryDeps,
): void {
  const cmd = program
    .command('context <target>')
    .description('Full lore summary for a code region');

  addPathQueryOptions(cmd);

  cmd.action(async (target: string, options: PathQueryCommandOptions) => {
    await executePathQuery(target, options, deps, 'context', 'all');
  });
}
