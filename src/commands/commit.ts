import type { Command } from 'commander';
import type { CommitBuilder } from '../services/commit-builder.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { CommitInputResolver, CommitCommandOptions } from '../services/commit-input-resolver.js';
import type { HeadLoreIdReader } from '../services/head-lore-id-reader.js';
import { LoreError, NoStagedChangesError, ValidationError } from '../util/errors.js';

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
  },
): void {
  program
    .command('commit')
    .description('Create a Lore-enriched commit')
    .option('--amend', 'Amend the last commit')
    .option('--no-edit', 'Keep the existing commit message (use with --amend)')
    .option('--file <path>', 'Read JSON input from file')
    .option('-i, --interactive', 'Interactive mode (guided prompts)')
    .option('--intent <text>', 'Intent line (why the change was made)')
    .option('--body <text>', 'Body (narrative context)')
    .option('--constraint <text...>', 'Constraint trailer value (repeatable)')
    .option('--rejected <text...>', 'Rejected trailer value (repeatable)')
    .option('--confidence <level>', 'Confidence level: low, medium, high')
    .option('--scope-risk <level>', 'Scope-risk level: narrow, moderate, wide')
    .option('--reversibility <level>', 'Reversibility level: clean, migration-needed, irreversible')
    .option('--directive <text...>', 'Directive trailer value (repeatable)')
    .option('--tested <text...>', 'Tested trailer value (repeatable)')
    .option('--not-tested <text...>', 'Not-tested trailer value (repeatable)')
    .option('--supersedes <id...>', 'Supersedes Lore-id (repeatable)')
    .option('--depends-on <id...>', 'Depends-on Lore-id (repeatable)')
    .option('--related <id...>', 'Related Lore-id (repeatable)')
    .action(async (options: CommitCommandOptions) => {
      const { commitBuilder, gitClient, getFormatter, commitInputResolver, headLoreIdReader } = deps;
      const formatter = getFormatter();

      // --no-edit without --amend is invalid
      if (options.edit === false && !options.amend) {
        throw new LoreError('--no-edit can only be used with --amend', 1);
      }

      // --amend --no-edit: pass through to git, no Lore processing
      if (options.amend && options.edit === false) {
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

      // Read existing Lore-id when amending
      const existingLoreId = options.amend ? await headLoreIdReader.read() : null;

      // Resolve input from the appropriate source
      const input = await commitInputResolver.resolve(options);

      // Validate input
      const issues = commitBuilder.validate(input);
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length > 0) {
        throw new ValidationError('Commit input validation failed', issues);
      }

      // Build the commit message (reuse existing Lore-id on amend)
      const message = commitBuilder.build(input, existingLoreId ?? undefined);

      // Run git commit
      const result = await gitClient.commit(message, options.amend ? { amend: true } : undefined);

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
