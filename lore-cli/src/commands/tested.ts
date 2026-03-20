import type { Command } from 'commander';
import { executePathQuery, addPathQueryOptions, type PathQueryDeps, type PathQueryCommandOptions } from './helpers/path-query.js';

/**
 * Register the `lore tested <target>` command.
 * Shows Tested and Not-tested trailers.
 */
export function registerTestedCommand(
  program: Command,
  deps: PathQueryDeps,
): void {
  const cmd = program
    .command('tested <target>')
    .description('Test coverage: what was and was not verified');

  addPathQueryOptions(cmd);

  cmd.action(async (target: string, options: PathQueryCommandOptions) => {
    await executePathQuery(target, options, deps, 'tested', ['Tested', 'Not-tested']);
  });
}
