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
  readonly last?: number;
  readonly strict?: boolean;
  readonly commitMsgFile?: string;
}

/**
 * Register the `lore validate [range]` command.
 * Validates commits for Lore protocol compliance.
 * Default: last commit (HEAD~1..HEAD).
 * Accepts a git revision range as argument, or `--from <ref>` for `<ref>..HEAD`.
 * (`--since <ref>`, a deprecated alias of `--from` since 0.7.0, was removed in 0.8.0.)
 *
 * Exit codes:
 * - Range modes (positional range, `--from`, `--last`, default): 1 on errors,
 *   2 on warnings only, 0 when clean.
 * - Hook mode (`--commit-msg-file`): 1 on errors, 0 otherwise. Warnings are
 *   advisory so they never block a commit; pass `--strict` to upgrade them
 *   to errors (which `[hooks] enforce = true` does).
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
    .option('--last <n>', 'Validate the last N commits', parseInt)
    .option('--strict', 'Treat warnings as errors')
    .option('--commit-msg-file <path>', 'Validate a commit message file (used by git hooks)')
    .action(async (range: string | undefined, options: ValidateCommandOptions) => {
      const { validator, gitClient, trailerParser, getFormatter } = deps;

      const isHookMode = Boolean(options.commitMsgFile);
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

        const ref = options.from;
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

      const exitCode = resolveExitCode(totalErrors, totalWarnings, isHookMode);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
      }
    });
}

/**
 * Map the (post-`--strict`) issue counts to a process exit code.
 * Hook mode treats warnings as advisory: only errors block the commit.
 */
function resolveExitCode(totalErrors: number, totalWarnings: number, isHookMode: boolean): number {
  if (totalErrors > 0) {
    return 1;
  }
  if (totalWarnings > 0 && !isHookMode) {
    return 2;
  }
  return 0;
}
