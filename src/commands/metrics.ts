import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { SupersessionResolver } from '../services/supersession-resolver.js';
import type { StalenessDetector } from '../services/staleness-detector.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { MetricsCollector } from '../services/metrics-collector.js';

/**
 * Register the `lore metrics` command.
 * Computes 8 categories of adoption and health metrics for a Lore-enriched repository.
 */
export function registerMetricsCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    supersessionResolver: SupersessionResolver;
    stalenessDetector: StalenessDetector;
    gitClient: IGitClient;
    metricsCollector: MetricsCollector;
    getFormatter: () => IOutputFormatter;
  },
): void {
  program
    .command('metrics')
    .description('Measure Lore adoption and protocol health')
    .option('--since <ref>', 'Only consider commits since ref/date')
    .action(async (options: { since?: string }) => {
      const {
        atomRepository,
        supersessionResolver,
        stalenessDetector,
        gitClient,
        metricsCollector,
        getFormatter,
      } = deps;

      // Resolve the --since option: command-level overrides global
      const globalOpts = program.opts();
      const since = options.since ?? globalOpts.since ?? undefined;

      // 1. Fetch all Lore atoms
      const atoms = await atomRepository.findAll({ since });

      // 2. Count total commits in the repo (within the same period)
      const totalCommitCount = await gitClient.countAllCommits(since);

      // 3. List all tracked files in the repo
      const allRepoFiles = await gitClient.listTrackedFiles();

      // 4. Compute supersession
      const supersessionMap = supersessionResolver.resolve(atoms);
      const activeAtoms = supersessionResolver.filterActive(atoms, supersessionMap);

      // 5. Run staleness analysis on active atoms
      const staleReports = await stalenessDetector.analyze(activeAtoms, supersessionMap);
      const staleAtomIds = new Set(staleReports.map(r => r.atom.loreId));

      // 6. Collect all metrics
      const result = metricsCollector.collectAll({
        atoms,
        supersessionMap,
        staleAtomIds,
        totalCommitCount,
        allRepoFiles: [...allRepoFiles],
        since: since ?? null,
      });

      // 7. Format and output
      const formatter = getFormatter();
      console.log(formatter.formatMetricsResult(result));
    });
}
