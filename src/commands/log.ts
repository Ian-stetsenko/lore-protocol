import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { SupersessionResolver } from '../services/supersession-resolver.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { PathQueryOptions, QueryResult } from '../types/query.js';
import type { LoreAtom } from '../types/domain.js';
import type { FormattableQueryResult } from '../types/output.js';
import { mergeOptions } from './helpers/merge-options.js';
import { buildQueryMeta } from './helpers/build-query-meta.js';
import { parsePositiveInt } from './helpers/path-query.js';

interface LogCommandOptions {
  readonly limit?: number;
  readonly maxCommits?: number;
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
    supersessionResolver: SupersessionResolver;
    getFormatter: () => IOutputFormatter;
  },
): void {
  program
    .command('log [paths...]')
    .description('Lore-enriched git log')
    .option('--limit <n>', 'Maximum number of results to display', parsePositiveInt)
    .option('--max-commits <n>', 'Maximum git commits to scan (supersession may be incomplete)', parsePositiveInt)
    .option('--since <ref>', 'Only consider commits since ref/date')
    .action(async (paths: string[], _options: LogCommandOptions, command: Command) => {
      const options = mergeOptions<LogCommandOptions>(command);
      const { atomRepository, supersessionResolver, getFormatter } = deps;

      let atoms: LoreAtom[];

      if (paths.length > 0) {
        // Use git-level path filtering via findByTarget (#24)
        const queryOptions: PathQueryOptions = {
          scope: null,
          follow: false,
          all: false,
          author: null,
          limit: null,
          maxCommits: options.maxCommits ?? null,
          since: options.since ?? null,
        };
        atoms = await atomRepository.findByTarget(['--', ...paths], queryOptions);
      } else {
        const findOptions: { since?: string; maxCommits?: number } = {};
        if (options.since) {
          findOptions.since = options.since;
        }
        if (options.maxCommits !== undefined && options.maxCommits > 0) {
          findOptions.maxCommits = options.maxCommits;
        }
        atoms = await atomRepository.findAll(findOptions);
      }

      // Build supersession map (show everything, including superseded atoms)
      const supersessionMap = supersessionResolver.resolve(atoms);
      const totalAtoms = atoms.length;

      // Apply result limit (--limit) after all filtering
      const displayAtoms = (options.limit !== undefined && options.limit > 0)
        ? atoms.slice(0, options.limit)
        : atoms;

      const result: QueryResult = {
        command: 'log',
        target: paths.length > 0 ? paths.join(', ') : 'all',
        targetType: 'global',
        atoms: displayAtoms,
        meta: buildQueryMeta(totalAtoms, displayAtoms),
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
