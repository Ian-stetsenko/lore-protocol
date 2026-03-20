import type { Command } from 'commander';
import { executePathQuery, addPathQueryOptions, type PathQueryDeps, type PathQueryCommandOptions } from './helpers/path-query.js';

/**
 * Register the `lore directives <target>` command.
 * Shows only Directive trailers.
 */
export function registerDirectivesCommand(
  program: Command,
  deps: PathQueryDeps,
): void {
  const cmd = program
    .command('directives <target>')
    .description('Active forward-looking warnings for a code region');

  addPathQueryOptions(cmd);

  cmd.action(async (target: string, options: PathQueryCommandOptions) => {
    await executePathQuery(target, options, deps, 'directives', ['Directive']);
  });
}
