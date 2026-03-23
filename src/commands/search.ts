import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { SupersessionResolver } from '../services/supersession-resolver.js';
import type { SearchFilter } from '../services/search-filter.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { TrailerKey, SupersessionStatus } from '../types/domain.js';
import type { SearchOptions, QueryResult, QueryMeta } from '../types/query.js';
import type { FormattableQueryResult } from '../types/output.js';

interface SearchCommandOptions {
  readonly confidence?: string;
  readonly scopeRisk?: string;
  readonly reversibility?: string;
  readonly has?: string;
  readonly author?: string;
  readonly scope?: string;
  readonly text?: string;
  readonly since?: string;
  readonly until?: string;
  readonly limit?: number;
}

/**
 * Register the `lore search` command.
 * Cross-cutting query with filters across all lore atoms.
 */
export function registerSearchCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    supersessionResolver: SupersessionResolver;
    searchFilter: SearchFilter;
    getFormatter: () => IOutputFormatter;
  },
): void {
  program
    .command('search')
    .description('Search across all lore with filters')
    .option('--confidence <level>', 'Filter by confidence: low, medium, high')
    .option('--scope-risk <level>', 'Filter by scope-risk: narrow, moderate, wide')
    .option('--reversibility <level>', 'Filter by reversibility: clean, migration-needed, irreversible')
    .option('--has <trailer>', 'Filter atoms that contain this trailer type')
    .option('--author <email>', 'Filter by commit author')
    .option('--scope <name>', 'Filter by conventional commit scope')
    .option('--text <query>', 'Full-text search across intent, body, and trailer values')
    .option('--since <ref>', 'Only consider commits since ref/date')
    .option('--until <ref>', 'Upper time/revision bound')
    .option('--limit <n>', 'Max results', parseInt)
    .action(async (options: SearchCommandOptions) => {
      const { atomRepository, supersessionResolver, searchFilter, getFormatter } = deps;

      const searchOptions: SearchOptions = {
        confidence: (options.confidence as SearchOptions['confidence']) ?? null,
        scopeRisk: (options.scopeRisk as SearchOptions['scopeRisk']) ?? null,
        reversibility: (options.reversibility as SearchOptions['reversibility']) ?? null,
        has: (options.has as TrailerKey) ?? null,
        author: options.author ?? null,
        scope: options.scope ?? null,
        text: options.text ?? null,
        since: options.since ?? null,
        until: options.until ?? null,
        limit: options.limit ?? null,
      };

      // Get all atoms with date range filters
      let atoms = await atomRepository.findAll({
        since: searchOptions.since ?? undefined,
        until: searchOptions.until ?? undefined,
        limit: searchOptions.limit ?? undefined,
      });

      // Apply filters via SearchFilter service
      atoms = searchFilter.applyFilters(atoms, searchOptions);

      const totalAtoms = atoms.length;

      // Apply limit after filtering
      if (searchOptions.limit !== null && searchOptions.limit > 0) {
        atoms = atoms.slice(0, searchOptions.limit);
      }

      // Compute supersession
      const supersessionMap: Map<string, SupersessionStatus> = supersessionResolver.resolve(atoms);

      const meta: QueryMeta = {
        totalAtoms,
        filteredAtoms: atoms.length,
        oldest: atoms.length > 0
          ? new Date(Math.min(...atoms.map((a) => a.date.getTime())))
          : null,
        newest: atoms.length > 0
          ? new Date(Math.max(...atoms.map((a) => a.date.getTime())))
          : null,
      };

      const result: QueryResult = {
        command: 'search',
        target: buildSearchTargetDescription(searchOptions),
        targetType: 'search',
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

function buildSearchTargetDescription(options: SearchOptions): string {
  const parts: string[] = [];

  if (options.confidence) parts.push(`confidence=${options.confidence}`);
  if (options.scopeRisk) parts.push(`scope-risk=${options.scopeRisk}`);
  if (options.reversibility) parts.push(`reversibility=${options.reversibility}`);
  if (options.has) parts.push(`has=${options.has}`);
  if (options.author) parts.push(`author=${options.author}`);
  if (options.scope) parts.push(`scope=${options.scope}`);
  if (options.text) parts.push(`text="${options.text}"`);
  if (options.since) parts.push(`since=${options.since}`);
  if (options.until) parts.push(`until=${options.until}`);

  return parts.length > 0 ? parts.join(', ') : 'all';
}
