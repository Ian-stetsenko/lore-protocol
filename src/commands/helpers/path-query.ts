import type { Command } from 'commander';
import type { AtomRepository } from '../../services/atom-repository.js';
import type { SupersessionResolver } from '../../services/supersession-resolver.js';
import type { PathResolver } from '../../services/path-resolver.js';
import type { IOutputFormatter } from '../../interfaces/output-formatter.js';
import type { LoreConfig } from '../../types/config.js';
import type { TrailerKey, LoreAtom, SupersessionStatus } from '../../types/domain.js';
import type { PathQueryOptions, QueryResult, TargetType } from '../../types/query.js';
import type { FormattableQueryResult } from '../../types/output.js';
import { buildQueryMeta } from './build-query-meta.js';

export interface PathQueryDeps {
  readonly atomRepository: AtomRepository;
  readonly supersessionResolver: SupersessionResolver;
  readonly pathResolver: PathResolver;
  readonly getFormatter: () => IOutputFormatter;
  readonly config: LoreConfig;
}

export interface PathQueryCommandOptions {
  readonly scope?: string;
  readonly follow?: boolean;
  readonly all?: boolean;
  readonly author?: string;
  readonly limit?: number;
  readonly maxCommits?: number;
  readonly since?: string;
}

/**
 * Shared helper for path-scoped query commands (context, constraints, rejected,
 * directives, tested). Each command follows the same resolve -> query -> filter ->
 * format pipeline, differing only in which trailers are visible.
 *
 * GoF: Template Method (via composition, not inheritance).
 */
export async function executePathQuery(
  target: string,
  options: PathQueryCommandOptions,
  deps: PathQueryDeps,
  commandName: string,
  visibleTrailers: readonly TrailerKey[] | 'all',
): Promise<void> {
  const { atomRepository, supersessionResolver, pathResolver, getFormatter, config } = deps;

  const queryOptions: PathQueryOptions = {
    scope: options.scope ?? null,
    follow: options.follow ?? false,
    all: options.all ?? false,
    author: options.author ?? null,
    limit: options.limit ?? null,
    maxCommits: options.maxCommits ?? null,
    since: options.since ?? null,
  };

  // Step 1: Resolve target or use --scope
  let atoms: LoreAtom[];
  let targetType: TargetType | 'search' | 'global';
  let targetDisplay: string;

  if (queryOptions.scope) {
    atoms = await atomRepository.findByScope(queryOptions.scope, queryOptions);
    targetType = 'global';
    targetDisplay = `scope:${queryOptions.scope}`;
  } else {
    const parsedTarget = pathResolver.parseTarget(target);
    const gitLogArgs = pathResolver.toGitLogArgs(parsedTarget);
    atoms = await atomRepository.findByTarget(gitLogArgs, queryOptions);
    targetType = parsedTarget.type;
    targetDisplay = target;
  }

  // Step 2: Follow links if requested
  if (queryOptions.follow && atoms.length > 0) {
    atoms = await atomRepository.resolveFollowLinks(atoms, config.follow.maxDepth);
  }

  const totalAtoms = atoms.length;

  // Step 3: Compute supersession
  const supersessionMap: Map<string, SupersessionStatus> = supersessionResolver.resolve(atoms);

  // Step 4: Filter superseded atoms unless --all
  let displayAtoms: readonly LoreAtom[];
  if (queryOptions.all) {
    displayAtoms = atoms;
  } else {
    displayAtoms = supersessionResolver.filterActive(atoms, supersessionMap);
  }

  // Step 4b: Apply result limit (--limit) after supersession filtering
  if (queryOptions.limit !== null && queryOptions.limit > 0) {
    displayAtoms = displayAtoms.slice(0, queryOptions.limit);
  }

  // Step 5: Build QueryResult
  const result: QueryResult = {
    command: commandName,
    target: targetDisplay,
    targetType,
    atoms: displayAtoms,
    meta: buildQueryMeta(totalAtoms, displayAtoms),
  };

  const formattable: FormattableQueryResult = {
    result,
    supersessionMap,
    visibleTrailers,
  };

  // Step 6: Format and output
  const formatter = getFormatter();
  console.log(formatter.formatQueryResult(formattable));
}

/**
 * Add the standard path-scoped query options to a command.
 */
export function addPathQueryOptions(cmd: Command): Command {
  return cmd
    .option('--scope <name>', 'Filter by conventional commit scope instead of path')
    .option('--follow', 'Transitively follow Related/Supersedes/Depends-on links')
    .option('--all', 'Include superseded entries')
    .option('--author <email>', 'Filter by commit author')
    .option('--limit <n>', 'Maximum number of results to display', parseInt)
    .option('--max-commits <n>', 'Maximum number of git commits to scan (performance)', parseInt)
    .option('--since <ref>', 'Only consider commits since ref/date');
}
