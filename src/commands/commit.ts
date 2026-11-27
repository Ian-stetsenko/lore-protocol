import type { Command } from 'commander';
import type { CommitBuilder, CommitInput } from '../services/commit-builder.js';
import type { AtomRepository } from '../services/atom-repository.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type {
  CommitInputResolver,
  CommitCommandOptions,
} from '../services/commit-input-resolver.js';
import type { HeadLoreIdReader } from '../services/head-lore-id-reader.js';
import type { ValidationIssue } from '../types/output.js';
import { LORE_ID_PATTERN, REFERENCE_TRAILER_KEYS } from '../util/constants.js';
import { LoreError, NoStagedChangesError, ValidationError, GitError } from '../util/errors.js';

/** Keys on CommitCommandOptions that are NOT user-supplied input. */
const NON_INPUT_KEYS: ReadonlySet<string> = new Set(['amend', 'edit', 'verifyRefs']);

/**
 * Detect conflicting input when --no-edit is used.
 * Uses exclusion: anything in options that is NOT a mode flag (amend, edit,
 * verifyRefs) is user input. Data-carrying flags added later are caught
 * automatically; mode flags must join NON_INPUT_KEYS instead.
 */
function hasConflictingInput(options: CommitCommandOptions): boolean {
  return Object.entries(options)
    .filter(([k]) => !NON_INPUT_KEYS.has(k))
    .some(([, v]) => v !== undefined);
}

/**
 * Collect the pattern-valid reference ids from resolved input as
 * trailer-id pairs, deduplicated on the (trailer, id) pair: the same id
 * repeated under the same trailer reports once, while the same id under
 * different trailers stays one pair each. Pattern-invalid ids are skipped
 * here: the builder's format validation owns them, and resolution only
 * applies to ids that could exist on a ref. No pairs means no repository
 * access at all.
 */
function collectReferencePairs(input: CommitInput): ReadonlyArray<{ readonly trailer: string; readonly id: string }> {
  const pairs: Array<{ trailer: string; id: string }> = [];
  const seen = new Set<string>();
  for (const key of REFERENCE_TRAILER_KEYS) {
    const ids = input.trailers?.[key] ?? [];
    for (const id of ids) {
      if (LORE_ID_PATTERN.test(id)) {
        const pairKey = `${key}:${id}`;
        if (!seen.has(pairKey)) {
          seen.add(pairKey);
          pairs.push({ trailer: key, id });
        }
      }
    }
  }
  return pairs;
}

/**
 * Register the `lore commit` command.
 * Default: read JSON from stdin.
 * --file <path>: read JSON from file.
 * -i / --interactive: interactive mode (guided prompts).
 * Flags: --intent, --body, --constraint, etc.
 * --amend: amend the last commit (preserves Lore-id).
 * --no-edit: keep existing message (use with --amend).
 * --no-verify-refs: skip Lore-id reference validation.
 */
export function registerCommitCommand(
  program: Command,
  deps: {
    commitBuilder: CommitBuilder;
    gitClient: IGitClient;
    getFormatter: () => IOutputFormatter;
    commitInputResolver: CommitInputResolver;
    headLoreIdReader: HeadLoreIdReader;
    atomRepository: AtomRepository;
  },
): void {
  program
    .command('commit')
    .description('Create a Lore-enriched commit')
    .option('--amend', 'Amend the last commit')
    .option('--no-edit', 'Keep the existing commit message (use with --amend)')
    .option('--no-verify-refs', 'Skip Lore-id reference validation')
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
      const {
        commitBuilder,
        gitClient,
        getFormatter,
        commitInputResolver,
        headLoreIdReader,
        atomRepository,
      } = deps;
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
        const loreId = await headLoreIdReader.read();
        const result = await gitClient.commit('', { amend: true, noEdit: true });
        const message = loreId
          ? `Commit amended: ${result.hash} | Lore-id: ${loreId}`
          : `Commit amended: ${result.hash}`;
        console.log(formatter.formatSuccess(message, { hash: result.hash, loreId }));
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

      // Validate input format and resolve references as one batched pass:
      // a command carrying malformed ids AND unresolvable ids fails once,
      // with both issue classes in a single ValidationError.
      const issues = commitBuilder.validate(input);

      let referenceIssues: readonly ValidationIssue[] = [];
      // Validate reference trailer ids against history: every pattern-valid
      // Supersedes/Depends-on/Related id must resolve on some ref. Runs only
      // when such ids exist, so commits without references never touch the
      // shared Lore-id index; a throw here precedes the build, so nothing is
      // committed on failure. --no-verify-refs skips the gate entirely.
      // The gate is best-effort: a GitError (e.g. a transient index build
      // failure) means "could not check", not "check failed" -- validation
      // is skipped with a pinned stderr warning and the commit proceeds.
      if (options.verifyRefs) {
        try {
          const referencePairs = collectReferencePairs(input);
          if (referencePairs.length > 0) {
            const uniqueIds = [...new Set(referencePairs.map((pair) => pair.id))];
            const resolved = await atomRepository.resolveReferenceIds(uniqueIds);
            // Near-match candidates are fetched once per unique unresolved id;
            // pairs may share an id, the candidate list is shared across them.
            const nearMatches = new Map<string, readonly string[]>();
            for (const id of uniqueIds) {
              if (resolved.get(id) == null) {
                nearMatches.set(id, await atomRepository.findNearMatchIds(id));
              }
            }
            referenceIssues = referencePairs
              .filter((pair) => resolved.get(pair.id) == null)
              .map((pair) => {
                const candidates = nearMatches.get(pair.id) ?? [];
                const suggestion =
                  candidates.length > 0
                    ? ` Did you mean one of: ${candidates.join(', ')}?`
                    : '';
                return {
                  severity: 'error' as const,
                  rule: 'reference-resolves',
                  message: `${pair.trailer} references Lore-id ${pair.id}, which resolves on no ref.${suggestion}`,
                };
              });
          }
        } catch (error) {
          // Only git-level failures mean "could not check": skip validation
          // with the pinned warning. Anything else fails loudly -- never
          // swallow a ValidationError (a LoreError subclass) as a skip.
          if (!(error instanceof GitError)) {
            throw error;
          }
          console.error(
            formatter.formatError(0, [
              {
                severity: 'warning',
                message: 'validation skipped: the Lore-id index could not be built',
              },
            ]),
          );
        }
      }

      const allIssues = [...issues, ...referenceIssues];
      if (allIssues.some((issue) => issue.severity === 'error')) {
        throw new ValidationError('Commit input validation failed', allIssues);
      }

      // Build the commit message (reuse existing Lore-id on amend)
      const { message: commitMessage, loreId } = commitBuilder.build(input, existingLoreId ?? undefined);

      // Run git commit
      const result = await gitClient.commit(commitMessage, options.amend ? { amend: true } : undefined);

      // Output
      const verb = options.amend ? 'amended' : 'created';
      console.log(
        formatter.formatSuccess(
          `Commit ${verb}: ${result.hash} | Lore-id: ${loreId}`,
          { hash: result.hash, loreId },
        ),
      );
    });
}
