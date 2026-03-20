import type { Command } from 'commander';
import type { Validator } from '../services/validator.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { FormattableValidationResult } from '../types/output.js';

interface ValidateCommandOptions {
  readonly since?: string;
  readonly last?: number;
  readonly strict?: boolean;
}

/**
 * Register the `lore validate [range]` command.
 * Validates commits for Lore protocol compliance.
 * Default: last commit (HEAD~1..HEAD).
 * Accepts git revision range as argument.
 */
export function registerValidateCommand(
  program: Command,
  deps: {
    validator: Validator;
    gitClient: IGitClient;
    getFormatter: () => IOutputFormatter;
  },
): void {
  program
    .command('validate [range]')
    .description('Validate commits for Lore protocol compliance')
    .option('--since <ref>', 'Validate all commits since ref (e.g., main)')
    .option('--last <n>', 'Validate the last N commits', parseInt)
    .option('--strict', 'Treat warnings as errors')
    .action(async (range: string | undefined, options: ValidateCommandOptions) => {
      const { validator, gitClient, getFormatter } = deps;

      // Determine the revision range
      let logArgs: string[];

      if (range) {
        // Explicit range: e.g., HEAD~5..HEAD or main..feature
        logArgs = [range];
      } else if (options.since) {
        logArgs = [`${options.since}..HEAD`];
      } else if (options.last !== undefined && options.last > 0) {
        logArgs = [`-${options.last}`];
      } else {
        // Default: last commit
        logArgs = ['-1'];
      }

      // Get raw commits from git
      const rawCommits = await gitClient.log(logArgs);

      // Validate all commits
      const results = validator.validate(rawCommits);

      // Compute summary
      let totalErrors = 0;
      let totalWarnings = 0;

      for (const result of results) {
        for (const issue of result.issues) {
          if (issue.severity === 'error') {
            totalErrors++;
          } else {
            totalWarnings++;
          }
        }
      }

      // In strict mode, warnings count as errors
      if (options.strict) {
        totalErrors += totalWarnings;
        totalWarnings = 0;
      }

      const allValid = totalErrors === 0;

      const validationResult: FormattableValidationResult = {
        valid: allValid,
        summary: {
          errors: totalErrors,
          warnings: totalWarnings,
          commitsChecked: results.length,
        },
        results,
      };

      const formatter = getFormatter();
      console.log(formatter.formatValidationResult(validationResult));

      // Exit with appropriate code
      if (totalErrors > 0) {
        process.exitCode = 1;
      } else if (totalWarnings > 0) {
        process.exitCode = 2;
      }
    });
}
