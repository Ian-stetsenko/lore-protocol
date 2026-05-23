import type { Command } from 'commander';
import type { CommitBuilder } from '../services/commit-builder.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { CommitInputResolver, CommitCommandOptions } from '../services/commit-input-resolver.js';
import type { HeadLoreIdReader } from '../services/head-lore-id-reader.js';
import { LoreError, NoStagedChangesError, ValidationError } from '../util/errors.js';
import { LORE_ID_KEY } from '../util/constants.js';
import type { LoreConfig, CustomTrailerDefinition } from '../types/config.js';
import type { Protocol } from '../services/protocol.js';

/** Keys on CommitCommandOptions that are NOT user-supplied input. */
const NON_INPUT_KEYS: ReadonlySet<string> = new Set(['amend', 'edit']);

/**
 * Detect conflicting input when --no-edit is used.
 * Uses exclusion: anything in options that is NOT amend/edit is user input.
 * New flags are caught automatically — no maintenance list to update.
 */
function hasConflictingInput(options: CommitCommandOptions): boolean {
  return Object.entries(options)
    .filter(([k]) => !NON_INPUT_KEYS.has(k))
    .some(([, v]) => v !== undefined && v !== false);
}

/**
 * Register the `lore commit` command.
 * Default: read JSON from stdin.
 * --file <path>: read JSON from file.
 * -i / --interactive: interactive mode (guided prompts).
 * Flags: --intent, --body, --constraint, etc.
 * --amend: amend the last commit (preserves Lore-id).
 * --no-edit: keep existing message (use with --amend).
 */
export function registerCommitCommand(
  program: Command,
  deps: {
    commitBuilder: CommitBuilder;
    gitClient: IGitClient;
    getFormatter: () => IOutputFormatter;
    commitInputResolver: CommitInputResolver;
    headLoreIdReader: HeadLoreIdReader;
    config: LoreConfig;
    protocol: Protocol;
  },
): void {
  const { protocol } = deps;
  const cmd = program
    .command('commit')
    .description('Create a Lore-enriched commit')
    .option('--amend', 'Amend the last commit')
    .option('--no-edit', 'Keep the existing commit message (use with --amend)')
    .option('--file <path>', 'Read JSON input from file')
    .option('-i, --interactive', 'Interactive mode (guided prompts)')
    .option('--intent <text>', 'Intent line (why the change was made)')
    .option('--body <text>', 'Body (narrative context)');

  // Dynamically register flags for all authorized trailers from the protocol metadata
  const authorizedKeys = protocol.getAuthorizedKeys();
  for (const key of authorizedKeys) {
    // Skip Lore-id to maintain perfect parity with 'main' branch UI
    if (key === LORE_ID_KEY) continue;
    
    const def = protocol.getDefinition(key);
    if (def) {
      registerFlagForDefinition(cmd, key, def);
    }
  }

  // 4. Add catch-all flag for permissive mode / ad-hoc trailers
  cmd.option('--trailer <key=value...>', 'Custom trailer (repeatable, format: Key=Value)')
    .action(async (options: CommitCommandOptions) => {
      const { commitBuilder, gitClient, getFormatter, commitInputResolver, headLoreIdReader } = deps;
      const formatter = getFormatter();

      // --no-edit without --amend is invalid
      if (options.edit === false && !options.amend) {
        throw new LoreError('--no-edit can only be used with --amend', 1);
      }

      // --amend --no-edit: pass through to git, no Lore processing
      if (options.amend && options.edit === false) {
        if (hasConflictingInput(options)) {
          throw new LoreError(
            '--no-edit keeps the existing message unchanged. Remove --no-edit to update trailers, or remove the input flags/payload to keep the message as-is.',
            1,
          );
        }

        // --no-edit requires staged changes since we aren't changing the message
        const hasStaged = await gitClient.hasStagedChanges();
        if (!hasStaged) {
          throw new NoStagedChangesError();
        }

        const result = await gitClient.commit('', { amend: true, noEdit: true });
        console.log(formatter.formatSuccess(`Commit amended: ${result.hash}`, { hash: result.hash }));
        return;
      }

      // Check for staged changes (skip when amending)
      if (!options.amend) {
        const hasStaged = await gitClient.hasStagedChanges();
        if (!hasStaged) {
          throw new NoStagedChangesError();
        }
      }

      // 5. Resolve input (interactive, file, flags, or stdin)
      const input = await commitInputResolver.resolve(options);

      // 6. Validate input before building message
      const issues = commitBuilder.validate(input);
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length > 0) {
        throw new ValidationError('Commit input validation failed', issues);
      }

      // 7. Build and commit
      let existingLoreId;
      if (options.amend) {
        existingLoreId = await headLoreIdReader.read();
      }

      const message = commitBuilder.build(input, existingLoreId ?? undefined);
      const result = await gitClient.commit(message, { amend: !!options.amend });

      // Output
      const verb = options.amend ? 'amended' : 'created';
      console.log(
        formatter.formatSuccess(
          `Commit ${verb}: ${result.hash}`,
          { hash: result.hash },
        ),
      );
    });
}

/**
 * Register a CLI flag for a trailer definition.
 */
function registerFlagForDefinition(cmd: Command, key: string, def: CustomTrailerDefinition): void {
  const flagName = def.cli?.flag || slugify(key);
  const shorthand = def.cli?.shorthand ? `-${def.cli.shorthand}, ` : '';
  const argTemplate = def.multivalue ? `<text...>` : `<text>`;
  const description = `${def.description}${def.multivalue ? ' (repeatable)' : ''}`;

  cmd.option(`${shorthand}--${flagName} ${argTemplate}`, description);
}

/**
 * Convert a trailer key to a CLI-friendly flag name.
 */
function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}
