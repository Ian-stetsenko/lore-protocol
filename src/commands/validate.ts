import type { Command } from 'commander';
import type { Validator } from '../services/validator.js';
import type { IGitClient, RawCommit } from '../interfaces/git-client.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { TrailerParser } from '../services/trailer-parser.js';
import type { CommitValidationResult, FormattableValidationResult, ValidationIssue } from '../types/output.js';
import { LoreError } from '../util/errors.js';
import { readFile } from 'node:fs/promises';

interface ValidateCommandOptions {
  readonly from?: string;
  readonly since?: string;
  readonly last?: number;
  readonly strict?: boolean;
  readonly commitMsgFile?: string;
}

/**
 * Register the `lore validate [range]` command.
 * Validates commits for Lore protocol compliance.
 * Default: last commit (HEAD~1..HEAD).
 * Accepts a git revision range as argument, or `--from <ref>` for `<ref>..HEAD`.
 * `--since <ref>` is a deprecated alias of `--from` (removed in 0.7).
 */
export function registerValidateCommand(
  program: Command,
  deps: {
    validator: Validator;
    gitClient: IGitClient;
    trailerParser: TrailerParser;
    getFormatter: () => IOutputFormatter;
  },
): void {
  program
    .command('validate [range]')
    .description('Validate commits for Lore protocol compliance')
    .option('--from <ref>', 'Validate all commits in the range <ref>..HEAD (e.g., --from main)')
    .option('--since <ref>', 'Deprecated: use --from instead (removal in 0.7). Validate all commits since ref')
    .option('--last <n>', 'Validate the last N commits', parseInt)
    .option('--strict', 'Treat warnings as errors')
    .option('--commit-msg-file <path>', 'Validate a commit message file (used by git hooks)')
    .action(async (range: string | undefined, options: ValidateCommandOptions) => {
      const { validator, gitClient, trailerParser, getFormatter } = deps;

      if (options.since) {
        console.error(
          getFormatter().formatError(0, [
            {
              severity: 'warning',
              message: '--since is deprecated on lore validate and will be removed in 0.7; use --from <ref> instead.',
            },
          ]),
        );
      }

      let rawCommits: readonly RawCommit[];

      if (options.commitMsgFile) {
        // Hook mode: validate a commit message file before the commit exists
        const content = await readFile(options.commitMsgFile, 'utf-8');
        const trailerBlock = trailerParser.extractTrailerBlock(content);
        const lines = content.split('\n');
        rawCommits = [{
          hash: '(pending)',
          date: new Date().toISOString(),
          author: '',
          subject: lines[0] ?? '',
          body: content,
          trailers: trailerBlock,
          filesChanged: [],
        }];
      } else {
        // Normal mode: validate commits from git history
        if (range !== undefined && options.from !== undefined) {
          throw new LoreError(
            `Conflicting range specifiers: positional range "${range}" and --from ${options.from}. Pass one or the other.`,
            1,
          );
        }

        const ref = options.from ?? options.since;
        let logArgs: string[];

        if (range) {
          logArgs = [range];
        } else if (ref) {
          logArgs = [`${ref}..HEAD`];
        } else if (options.last !== undefined && options.last > 0) {
          logArgs = [`-${options.last}`];
        } else {
          logArgs = ['-1'];
        }

        rawCommits = await gitClient.log(logArgs);
      }

      // Validate all commits
      let results: readonly CommitValidationResult[] = await validator.validate(rawCommits);

      // In strict mode, upgrade each warning issue to an error
      if (options.strict) {
        results = results.map((result): CommitValidationResult => {
          const upgradedIssues: readonly ValidationIssue[] = result.issues.map(
            (issue): ValidationIssue =>
              issue.severity === 'warning'
                ? { severity: 'error', rule: issue.rule, message: issue.message }
                : issue,
          );
          const hasErrors = upgradedIssues.some((i) => i.severity === 'error');
          return {
            commit: result.commit,
            loreId: result.loreId,
            valid: !hasErrors,
            issues: upgradedIssues,
          };
        });
      }

      // Compute summary from (possibly upgraded) results
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
