import type { Command } from 'commander';
import { executePathQuery, addPathQueryOptions, type PathQueryDeps, type PathQueryCommandOptions } from './helpers/path-query.js';
import { mergeOptions } from './helpers/merge-options.js';

/**
 * Register the `lore constraints <target>` command.
 * Shows only Constraint trailers. Superseded atoms filtered by default.
 */
export function registerConstraintsCommand(
  program: Command,
  deps: PathQueryDeps,
): void {
  const cmd = program
    .command('constraints <target>')
    .description('Active constraints for a code region');

  addPathQueryOptions(cmd);

  cmd.action(async (target: string, _options: PathQueryCommandOptions, command: Command) => {
    const options = mergeOptions<PathQueryCommandOptions>(command);
    await executePathQuery(target, options, deps, 'constraints', ['Constraint']);
  });
}
