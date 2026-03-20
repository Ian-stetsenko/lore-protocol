import type { Command } from 'commander';
import { executePathQuery, addPathQueryOptions, type PathQueryDeps, type PathQueryCommandOptions } from './helpers/path-query.js';

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

  cmd.action(async (target: string, options: PathQueryCommandOptions) => {
    await executePathQuery(target, options, deps, 'constraints', ['Constraint']);
  });
}
