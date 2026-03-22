import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { PathResolver } from '../services/path-resolver.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { LoreAtom, SupersessionStatus } from '../types/domain.js';
import type { QueryResult, QueryMeta } from '../types/query.js';
import type { FormattableQueryResult } from '../types/output.js';
import { LoreError } from '../util/errors.js';

/**
 * Register the `lore why <target>` command.
 * Target must be `file:line` or `file:line-line` format.
 * Uses git blame to find the commit for each line, then extracts Lore trailers.
 *
 * Performance: queries only the specific blame commits (one git log per unique hash)
 * rather than loading all atoms from history.
 */
export function registerWhyCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    gitClient: IGitClient;
    pathResolver: PathResolver;
    getFormatter: () => IOutputFormatter;
  },
): void {
  program
    .command('why <target>')
    .description('Decision context for a specific line or line range')
    .action(async (target: string) => {
      const { atomRepository, gitClient, pathResolver, getFormatter } = deps;

      const parsedTarget = pathResolver.parseTarget(target);

      if (parsedTarget.type !== 'line-range' || parsedTarget.lineStart === null) {
        throw new LoreError(
          `Target must be file:line or file:line-line format (got "${target}")`,
          1,
        );
      }

      const blameArgs = pathResolver.toGitBlameArgs(parsedTarget);
      const blameLines = await gitClient.blame(
        blameArgs.file,
        blameArgs.lineStart,
        blameArgs.lineEnd,
      );

      if (blameLines.length === 0) {
        throw new LoreError(`No blame data found for ${target}`, 1);
      }

      // Collect unique commit hashes from blame
      const commitHashes = new Set<string>();
      for (const line of blameLines) {
        commitHashes.add(line.commitHash);
      }

      // For each unique commit hash, use atomRepository to look up the atom
      const atoms: LoreAtom[] = [];
      const seenLoreIds = new Set<string>();

      for (const hash of commitHashes) {
        const atom = await atomRepository.findByCommitHash(hash);
        if (atom === null) {
          continue;
        }

        if (seenLoreIds.has(atom.loreId)) {
          continue;
        }

        atoms.push(atom);
        seenLoreIds.add(atom.loreId);
      }

      // Build result
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
        command: 'why',
        target,
        targetType: 'line-range',
        atoms,
        meta,
      };

      // Build a minimal supersession map (no supersession filtering for why)
      const supersessionMap = new Map<string, SupersessionStatus>();
      for (const atom of atoms) {
        supersessionMap.set(atom.loreId, {
          superseded: false,
          supersededBy: null,
        });
      }

      const formattable: FormattableQueryResult = {
        result,
        supersessionMap,
        visibleTrailers: 'all',
      };

      const formatter = getFormatter();
      console.log(formatter.formatQueryResult(formattable));
    });
}
