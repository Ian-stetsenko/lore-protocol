import type { Command } from 'commander';
import { executePathQuery, addPathQueryOptions, type PathQueryDeps, type PathQueryCommandOptions } from './helpers/path-query.js';
import { mergeOptions } from './helpers/merge-options.js';

/**
 * Register the `lore tested <target>` and `lore coverage <target>` commands.
 * Both show Tested and Not-tested trailers.
 * `coverage` is an alias matching the paper's CLI interface (Figure 2).
 */
export function registerTestedCommand(
  program: Command,
  deps: PathQueryDeps,
): void {
  const action = async (target: string, _options: PathQueryCommandOptions, command: Command) => {
    const options = mergeOptions<PathQueryCommandOptions>(command);
    await executePathQuery(target, options, deps, 'tested', ['Tested', 'Not-tested']);
  };

  const tested = program
    .command('tested <target>')
    .description('Test coverage: what was and was not verified');
  addPathQueryOptions(tested);
  tested.action(action);

  const coverage = program
    .command('coverage <target>')
    .description('Test coverage map (alias for tested)');
  addPathQueryOptions(coverage);
  coverage.action(action);
}
