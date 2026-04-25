import type { Command } from 'commander';
import { executePathQuery, addPathQueryOptions, type PathQueryDeps, type PathQueryCommandOptions } from './helpers/path-query.js';
import { mergeOptions } from './helpers/merge-options.js';

/**
 * Register the `lore rejected <target>` command.
 * Shows only Rejected trailers.
 */
export function registerRejectedCommand(
  program: Command,
  deps: PathQueryDeps,
): void {
  const cmd = program
    .command('rejected <target>')
    .description('Previously rejected alternatives for a code region');

  addPathQueryOptions(cmd);

  cmd.action(async (target: string, _options: PathQueryCommandOptions, command: Command) => {
    const options = mergeOptions<PathQueryCommandOptions>(command);
    await executePathQuery(target, options, deps, 'rejected', ['Rejected']);
  });
}
