import type { Command } from 'commander';
import type { TrailerParser } from '../services/trailer-parser.js';
import type { PathResolver } from '../services/path-resolver.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { LoreAtom, LoreTrailers, SupersessionStatus } from '../types/domain.js';
import type { QueryResult, QueryMeta } from '../types/query.js';
import type { FormattableQueryResult } from '../types/output.js';
import { LORE_ID_PATTERN } from '../util/constants.js';
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
    trailerParser: TrailerParser;
    gitClient: IGitClient;
    pathResolver: PathResolver;
    getFormatter: () => IOutputFormatter;
    customTrailerKeys: readonly string[];
  },
): void {
  program
    .command('why <target>')
    .description('Decision context for a specific line or line range')
    .action(async (target: string) => {
      const { trailerParser, gitClient, pathResolver, getFormatter, customTrailerKeys } = deps;

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

      // For each unique commit hash, query just that single commit
      // and check for Lore trailers directly -- avoids loading all history.
      const atoms: LoreAtom[] = [];
      const seenLoreIds = new Set<string>();

      for (const hash of commitHashes) {
        const rawCommits = await gitClient.log(['-1', hash]);
        if (rawCommits.length === 0) {
          continue;
        }

        const raw = rawCommits[0];
        if (!trailerParser.containsLoreTrailers(raw.trailers)) {
          continue;
        }

        const trailers: LoreTrailers = trailerParser.parse(raw.trailers, customTrailerKeys);
        if (!LORE_ID_PATTERN.test(trailers['Lore-id'])) {
          continue;
        }

        if (seenLoreIds.has(trailers['Lore-id'])) {
          continue;
        }

        const filesChanged = await gitClient.getFilesChanged(raw.hash);

        const atom: LoreAtom = {
          loreId: trailers['Lore-id'],
          commitHash: raw.hash,
          date: new Date(raw.date),
          author: raw.author,
          intent: raw.subject,
          body: raw.body,
          trailers,
          filesChanged,
        };

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
