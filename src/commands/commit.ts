import type { Command } from 'commander';
import type { CommitBuilder } from '../services/commit-builder.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { CommitInputResolver, CommitCommandOptions } from '../services/commit-input-resolver.js';
import { NoStagedChangesError, ValidationError } from '../util/errors.js';

/**
 * Register the `lore commit` command.
 * Default: read JSON from stdin.
 * --file <path>: read JSON from file.
 * -i / --interactive: interactive mode (guided prompts).
 * Flags: --intent, --body, --constraint, etc.
 */
export function registerCommitCommand(
  program: Command,
  deps: {
    commitBuilder: CommitBuilder;
    gitClient: IGitClient;
    getFormatter: () => IOutputFormatter;
    commitInputResolver: CommitInputResolver;
  },
): void {
  program
    .command('commit')
    .description('Create a Lore-enriched commit')
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
      const { commitBuilder, gitClient, getFormatter, commitInputResolver } = deps;
      const formatter = getFormatter();

      // 1. Check for staged changes
      const hasStaged = await gitClient.hasStagedChanges();
      if (!hasStaged) {
        throw new NoStagedChangesError();
      }

      // 2. Resolve input from the appropriate source
      const input = await commitInputResolver.resolve(options);

      // 3. Validate input
      const issues = commitBuilder.validate(input);
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length > 0) {
        throw new ValidationError('Commit input validation failed', issues);
      }

      // 4. Build the commit message
      const message = commitBuilder.build(input);

      // 5. Run git commit
      const result = await gitClient.commit(message);

      // 6. Output
      console.log(
        formatter.formatSuccess(
          `Commit created: ${result.hash}`,
          { hash: result.hash },
        ),
      );
    });
}
