import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { LoreAtom, LoreId } from '../types/domain.js';
import type { FormattableTraceResult, TraceEdge } from '../types/output.js';
import { LoreError } from '../util/errors.js';
import { LORE_ID_PATTERN, REFERENCE_TRAILER_KEYS } from '../util/constants.js';
import { parseNonNegativeInt } from './helpers/option-parsers.js';

/**
 * Register the `lore trace <lore-id>` command.
 * Finds an atom by Lore-id, then BFS through all references to build
 * a tree of edges showing the decision chain.
 *
 * Depth: the root is depth 0 and an edge's depth is its source depth + 1.
 * `--max-depth N` lists exactly the edges whose source depth is < N, so
 * N=0 shows the root alone.
 */
export function registerTraceCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    getFormatter: () => IOutputFormatter;
  },
): void {
  program
    .command('trace <lore-id>')
    .description('Follow decision chain from a starting atom')
    .option('--max-depth <n>', 'Maximum number of edge levels to follow', parseNonNegativeInt, 10)
    .action(async (loreId: string, options: { maxDepth: number }) => {
      const { atomRepository, getFormatter } = deps;

      if (!LORE_ID_PATTERN.test(loreId)) {
        throw new LoreError(
          `Invalid Lore-id format: "${loreId}". Must be 8-character hex.`,
          1,
        );
      }

      const rootAtom = await atomRepository.findByLoreId(loreId);
      if (!rootAtom) {
        throw new LoreError(
          `Lore-id "${loreId}" not found in commit history.`,
          1,
        );
      }

      // BFS to discover all edges
      const edges: TraceEdge[] = [];
      const visited = new Set<string>();
      visited.add(rootAtom.loreId);

      const queue: Array<{ atom: LoreAtom; depth: number }> = [
        { atom: rootAtom, depth: 0 },
      ];

      const maxDepth = options.maxDepth;

      // Edges resolve against one shared index (one git log --all pass)
      // instead of one full-history grep per edge, which is minutes on
      // large corpora. Built lazily so atoms without references never pay.
      let index: ReadonlyMap<LoreId, LoreAtom> | null = null;

      while (queue.length > 0) {
        const entry = queue.shift()!;
        if (entry.depth >= maxDepth) {
          continue;
        }
        const currentAtom = entry.atom;

        for (const key of REFERENCE_TRAILER_KEYS) {
          const relationship = key as TraceEdge['relationship'];
          const refIds = currentAtom.trailers[key] as readonly LoreId[];

          for (const refId of refIds) {
            if (!LORE_ID_PATTERN.test(refId)) {
              continue;
            }

            index ??= await atomRepository.getLoreIdIndex();

            const targetAtom = index.get(refId) ?? null;

            edges.push({
              from: currentAtom.loreId,
              to: refId,
              relationship,
              targetAtom,
            });

            // Enqueue each atom once; the depth bound is enforced at dequeue.
            // Edges back to visited atoms (cycles) are still listed above.
            if (!visited.has(refId) && targetAtom) {
              visited.add(refId);
              queue.push({ atom: targetAtom, depth: entry.depth + 1 });
            }
          }
        }
      }

      const traceResult: FormattableTraceResult = {
        root: rootAtom,
        edges,
      };

      const formatter = getFormatter();
      console.log(formatter.formatTraceResult(traceResult));
    });
}
