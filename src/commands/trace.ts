import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { LoreAtom, LoreId } from '../types/domain.js';
import type { FormattableTraceResult, TraceEdge } from '../types/output.js';
import { LoreError } from '../util/errors.js';
import { LORE_ID_PATTERN, REFERENCE_TRAILER_KEYS } from '../util/constants.js';

/**
 * Register the `lore trace <lore-id>` command.
 * Finds an atom by Lore-id, then BFS through all references to build
 * a tree of edges showing the decision chain.
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
    .option('--max-depth <n>', 'Maximum BFS traversal depth', parseInt, 10)
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

      while (queue.length > 0) {
        const entry = queue.shift()!;
        const currentAtom = entry.atom;

        for (const key of REFERENCE_TRAILER_KEYS) {
          const relationship = key as TraceEdge['relationship'];
          const refIds = currentAtom.trailers[key] as readonly LoreId[];

          for (const refId of refIds) {
            if (!LORE_ID_PATTERN.test(refId)) {
              continue;
            }

            const targetAtom = await atomRepository.findByLoreId(refId);

            edges.push({
              from: currentAtom.loreId,
              to: refId,
              relationship,
              targetAtom,
            });

            // Continue BFS if this is a new atom we haven't visited
            // and we haven't exceeded the depth limit
            if (!visited.has(refId) && targetAtom && entry.depth + 1 <= maxDepth) {
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
