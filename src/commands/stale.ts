import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { SupersessionResolver } from '../services/supersession-resolver.js';
import type { StalenessDetector } from '../services/staleness-detector.js';
import type { PathResolver } from '../services/path-resolver.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { LoreAtom, SupersessionStatus } from '../types/domain.js';
import type { PathQueryOptions } from '../types/query.js';
import type { FormattableStalenessResult, StaleAtomReport } from '../types/output.js';

interface StaleCommandOptions {
  readonly olderThan?: string;
  readonly drift?: number;
  readonly lowConfidence?: boolean;
}

/**
 * Register the `lore stale [target]` command.
 * Flags potentially outdated knowledge using multiple staleness signals.
 * Target is optional -- if omitted, analyzes all atoms globally.
 */
export function registerStaleCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    supersessionResolver: SupersessionResolver;
    stalenessDetector: StalenessDetector;
    pathResolver: PathResolver;
    getFormatter: () => IOutputFormatter;
  },
): void {
  program
    .command('stale [target]')
    .description('Flag potentially outdated knowledge')
    .option('--older-than <duration>', 'Time-based staleness threshold (e.g., 6m, 1y)')
    .option('--drift <n>', 'File drift threshold (commits since atom)', parseInt)
    .option('--low-confidence', 'Flag low-confidence atoms')
    .action(async (target: string | undefined, options: StaleCommandOptions) => {
      const { atomRepository, supersessionResolver, stalenessDetector, pathResolver, getFormatter } = deps;

      let atoms: LoreAtom[];

      if (target) {
        const parsedTarget = pathResolver.parseTarget(target);
        const queryOptions: PathQueryOptions = {
          scope: null,
          follow: false,
          all: false,
          author: null,
          limit: null,
          since: null,
        };
        atoms = await atomRepository.findByTarget(parsedTarget, queryOptions);
      } else {
        atoms = await atomRepository.findAll();
      }

      // Compute supersession for dependency-orphan detection
      const supersessionMap: Map<string, SupersessionStatus> = supersessionResolver.resolve(atoms);

      // Filter to active atoms only (stale check on superseded atoms is not useful)
      const activeAtoms = supersessionResolver.filterActive(atoms, supersessionMap);

      // Run staleness analysis
      let reports: StaleAtomReport[] = await stalenessDetector.analyze(
        activeAtoms,
        supersessionMap,
      );

      // Apply additional CLI-level filters
      if (options.olderThan || options.drift !== undefined || options.lowConfidence) {
        reports = reports.filter((report) => {
          const matchesAge = options.olderThan
            ? report.reasons.some((r) => r.startsWith('Age:'))
            : true;
          const matchesDrift = options.drift !== undefined
            ? report.reasons.some((r) => r.startsWith('Drift:'))
            : true;
          const matchesConfidence = options.lowConfidence
            ? report.reasons.some((r) => r.startsWith('Low confidence:'))
            : true;

          // If specific filters are given, require at least one to match
          if (options.olderThan && !options.drift && !options.lowConfidence) {
            return matchesAge;
          }
          if (!options.olderThan && options.drift !== undefined && !options.lowConfidence) {
            return matchesDrift;
          }
          if (!options.olderThan && options.drift === undefined && options.lowConfidence) {
            return matchesConfidence;
          }

          return matchesAge || matchesDrift || matchesConfidence;
        });
      }

      const stalenessResult: FormattableStalenessResult = {
        atoms: reports,
      };

      const formatter = getFormatter();
      console.log(formatter.formatStalenessResult(stalenessResult));
    });
}
