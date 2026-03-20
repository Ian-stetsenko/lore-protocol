import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { SquashMerger } from '../services/squash-merger.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import { LoreError } from '../util/errors.js';

interface SquashCommandOptions {
  readonly intent?: string;
  readonly body?: string;
}

/**
 * Register the `lore squash <range>` command.
 * Takes a git revision range, gets all Lore atoms in that range,
 * merges them via SquashMerger, and outputs the merged message to stdout.
 */
export function registerSquashCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    squashMerger: SquashMerger;
    getFormatter: () => IOutputFormatter;
  },
): void {
  program
    .command('squash <range>')
    .description('Merge atoms for squash-merge preparation')
    .option('--intent <text>', 'Override the intent line of the merged message')
    .option('--body <text>', 'Override the body of the merged message')
    .action(async (range: string, options: SquashCommandOptions) => {
      const { atomRepository, squashMerger } = deps;

      const atoms = await atomRepository.findByRange(range);

      if (atoms.length === 0) {
        throw new LoreError('No Lore atoms found in the specified range.', 1);
      }

      const mergedMessage = squashMerger.merge(atoms, {
        intent: options.intent,
        body: options.body,
      });

      // Output to stdout (raw message, not formatted)
      console.log(mergedMessage);
    });
}
