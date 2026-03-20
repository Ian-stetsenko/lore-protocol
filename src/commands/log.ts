import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { SupersessionStatus } from '../types/domain.js';
import type { QueryResult, QueryMeta } from '../types/query.js';
import type { FormattableQueryResult } from '../types/output.js';

interface LogCommandOptions {
  readonly limit?: number;
  readonly since?: string;
}

/**
 * Register the `lore log` command.
 * Lore-enriched git log. Shows all Lore-enriched commits in reverse
 * chronological order. Path arguments after `--` are passed through.
 */
export function registerLogCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    getFormatter: () => IOutputFormatter;
  },
): void {
  program
    .command('log')
    .description('Lore-enriched git log')
    .option('--limit <n>', 'Limit number of results', parseInt)
    .option('--since <ref>', 'Only consider commits since ref/date')
    .allowUnknownOption(true)
    .action(async (options: LogCommandOptions, cmd) => {
      const { atomRepository, getFormatter } = deps;

      // Capture any path args that appear after `--` in the parent program
      // Commander stores them in program.args after the command name
      const rawArgs = cmd.parent?.args ?? [];
      const dashDashIndex = process.argv.indexOf('--');
      const pathArgs: string[] = [];
      if (dashDashIndex !== -1) {
        pathArgs.push(...process.argv.slice(dashDashIndex + 1));
      }

      // Build options for atomRepository.findAll
      const findOptions: { since?: string; limit?: number } = {};
      if (options.since) {
        findOptions.since = options.since;
      }
      if (options.limit !== undefined && options.limit > 0) {
        findOptions.limit = options.limit;
      }

      let atoms = await atomRepository.findAll(findOptions);

      // If path args were provided, filter atoms by files changed
      if (pathArgs.length > 0) {
        atoms = atoms.filter((atom) =>
          atom.filesChanged.some((file) =>
            pathArgs.some((pathArg) => file.startsWith(pathArg)),
          ),
        );
      }

      // Build supersession map (no filtering for log -- show everything)
      const supersessionMap = new Map<string, SupersessionStatus>();
      for (const atom of atoms) {
        supersessionMap.set(atom.loreId, {
          superseded: false,
          supersededBy: null,
        });
      }

      const meta: QueryMeta = {
        totalAtoms: atoms.length,
        filteredAtoms: atoms.length,
        oldest: atoms.length > 0
          ? new Date(Math.min(...atoms.map((a) => a.date.getTime())))
          : null,
        newest: atoms.length > 0
          ? new Date(Math.max(...atoms.map((a) => a.date.getTime())))
          : null,
      };

      const result: QueryResult = {
        command: 'log',
        target: pathArgs.length > 0 ? pathArgs.join(', ') : 'all',
        targetType: 'global',
        atoms,
        meta,
      };

      const formattable: FormattableQueryResult = {
        result,
        supersessionMap,
        visibleTrailers: 'all',
      };

      const formatter = getFormatter();
      console.log(formatter.formatQueryResult(formattable));
    });
}
