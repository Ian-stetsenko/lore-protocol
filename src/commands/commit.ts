import type { Command } from 'commander';
import type { CommitBuilder } from '../services/commit-builder.js';
import type { CommitInput } from '../services/commit-builder.js';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { IPrompt } from '../interfaces/prompt.js';
import type { ConfidenceLevel, ScopeRiskLevel, ReversibilityLevel } from '../types/domain.js';
import { NoStagedChangesError, ValidationError } from '../util/errors.js';
import { readFile } from 'node:fs/promises';
import { CONFIDENCE_VALUES, SCOPE_RISK_VALUES, REVERSIBILITY_VALUES } from '../util/constants.js';

interface CommitCommandOptions {
  readonly file?: string;
  readonly interactive?: boolean;
  readonly intent?: string;
  readonly body?: string;
  readonly constraint?: string[];
  readonly rejected?: string[];
  readonly confidence?: string;
  readonly scopeRisk?: string;
  readonly reversibility?: string;
  readonly directive?: string[];
  readonly tested?: string[];
  readonly notTested?: string[];
  readonly supersedes?: string[];
  readonly dependsOn?: string[];
  readonly related?: string[];
}

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
    prompt: IPrompt;
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
      const { commitBuilder, gitClient, getFormatter, prompt } = deps;
      const formatter = getFormatter();

      // Check for staged changes first
      const hasStaged = await gitClient.hasStagedChanges();
      if (!hasStaged) {
        throw new NoStagedChangesError();
      }

      // Determine input mode and build CommitInput
      let input: CommitInput;

      if (options.interactive) {
        input = await collectInteractiveInput(prompt);
      } else if (options.file) {
        input = await readInputFromFile(options.file);
      } else if (options.intent) {
        input = buildInputFromFlags(options);
      } else if (process.stdin.isTTY) {
        // TTY with no flags: default to interactive mode instead of hanging on stdin
        input = await collectInteractiveInput(prompt);
      } else {
        // Piped input: read JSON from stdin
        input = await readInputFromStdin();
      }

      // Validate input
      const issues = commitBuilder.validate(input);
      const errors = issues.filter((i) => i.severity === 'error');
      if (errors.length > 0) {
        throw new ValidationError('Commit input validation failed', issues);
      }

      // Build the commit message
      const message = commitBuilder.build(input);

      // Run git commit
      const result = await gitClient.commit(message);

      console.log(
        formatter.formatSuccess(
          `Commit created: ${result.hash}`,
          { hash: result.hash },
        ),
      );
    });
}

/**
 * Read JSON input from a file.
 */
async function readInputFromFile(filePath: string): Promise<CommitInput> {
  const content = await readFile(filePath, 'utf-8');
  return parseJsonInput(content);
}

/**
 * Read JSON from stdin, collecting chunks until EOF.
 */
async function readInputFromStdin(): Promise<CommitInput> {
  const chunks: Buffer[] = [];

  return new Promise<CommitInput>((resolve, reject) => {
    process.stdin.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    process.stdin.on('end', () => {
      const content = Buffer.concat(chunks).toString('utf-8');
      try {
        resolve(parseJsonInput(content));
      } catch (err) {
        reject(err);
      }
    });

    process.stdin.on('error', (err) => {
      reject(err);
    });

    // If stdin is a TTY and no data is piped, we need to resume
    if (process.stdin.isTTY) {
      process.stdin.resume();
    }
  });
}

/**
 * Parse a JSON string into CommitInput.
 */
function parseJsonInput(content: string): CommitInput {
  const parsed = JSON.parse(content) as Record<string, unknown>;

  const intent = typeof parsed.intent === 'string' ? parsed.intent : '';
  const body = typeof parsed.body === 'string' ? parsed.body : undefined;

  const trailersRaw = typeof parsed.trailers === 'object' && parsed.trailers !== null
    ? parsed.trailers as Record<string, unknown>
    : undefined;

  let trailers: CommitInput['trailers'];
  if (trailersRaw) {
    trailers = {
      Constraint: asStringArray(trailersRaw['Constraint']),
      Rejected: asStringArray(trailersRaw['Rejected']),
      Confidence: asEnumValue(trailersRaw['Confidence']) as ConfidenceLevel | undefined,
      'Scope-risk': asEnumValue(trailersRaw['Scope-risk']) as ScopeRiskLevel | undefined,
      Reversibility: asEnumValue(trailersRaw['Reversibility']) as ReversibilityLevel | undefined,
      Directive: asStringArray(trailersRaw['Directive']),
      Tested: asStringArray(trailersRaw['Tested']),
      'Not-tested': asStringArray(trailersRaw['Not-tested']),
      Supersedes: asStringArray(trailersRaw['Supersedes']),
      'Depends-on': asStringArray(trailersRaw['Depends-on']),
      Related: asStringArray(trailersRaw['Related']),
    };
  }

  return { intent, body, trailers };
}

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  return undefined;
}

function asEnumValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Build CommitInput from CLI flags.
 */
function buildInputFromFlags(options: CommitCommandOptions): CommitInput {
  return {
    intent: options.intent ?? '',
    body: options.body,
    trailers: {
      Constraint: options.constraint,
      Rejected: options.rejected,
      Confidence: options.confidence as ConfidenceLevel | undefined,
      'Scope-risk': options.scopeRisk as ScopeRiskLevel | undefined,
      Reversibility: options.reversibility as ReversibilityLevel | undefined,
      Directive: options.directive,
      Tested: options.tested,
      'Not-tested': options.notTested,
      Supersedes: options.supersedes,
      'Depends-on': options.dependsOn,
      Related: options.related,
    },
  };
}

/**
 * Walk through interactive prompts to collect commit input.
 */
async function collectInteractiveInput(prompt: IPrompt): Promise<CommitInput> {
  try {
    // Required: intent
    const intent = await prompt.askText('Intent (why the change was made):', {
      maxLength: 72,
    });

    // Optional: body
    const wantsBody = await prompt.askConfirm('Add a body? (narrative context)', false);
    let body: string | undefined;
    if (wantsBody) {
      body = await prompt.askMultiline('Body (press Enter on empty line to finish):');
    }

    // Constraints
    const constraints = await collectMultipleValues(
      prompt,
      'Add a Constraint?',
      'Constraint:',
    );

    // Rejected
    const rejected = await collectMultipleValues(
      prompt,
      'Add a Rejected alternative?',
      'Rejected (format: alternative | reason):',
    );

    // Confidence
    let confidence: ConfidenceLevel | undefined;
    const wantsConfidence = await prompt.askConfirm('Set Confidence?', false);
    if (wantsConfidence) {
      confidence = await prompt.askChoice('Confidence:', CONFIDENCE_VALUES);
    }

    // Scope-risk
    let scopeRisk: ScopeRiskLevel | undefined;
    const wantsScopeRisk = await prompt.askConfirm('Set Scope-risk?', false);
    if (wantsScopeRisk) {
      scopeRisk = await prompt.askChoice('Scope-risk:', SCOPE_RISK_VALUES);
    }

    // Reversibility
    let reversibility: ReversibilityLevel | undefined;
    const wantsReversibility = await prompt.askConfirm('Set Reversibility?', false);
    if (wantsReversibility) {
      reversibility = await prompt.askChoice('Reversibility:', REVERSIBILITY_VALUES);
    }

    // Directives
    const directives = await collectMultipleValues(
      prompt,
      'Add a Directive?',
      'Directive:',
    );

    // Tested
    const tested = await collectMultipleValues(
      prompt,
      'Add a Tested entry?',
      'Tested:',
    );

    // Not-tested
    const notTested = await collectMultipleValues(
      prompt,
      'Add a Not-tested entry?',
      'Not-tested:',
    );

    // Supersedes
    const supersedes = await collectMultipleValues(
      prompt,
      'Add a Supersedes reference?',
      'Supersedes (8-char hex Lore-id):',
    );

    // Depends-on
    const dependsOn = await collectMultipleValues(
      prompt,
      'Add a Depends-on reference?',
      'Depends-on (8-char hex Lore-id):',
    );

    // Related
    const related = await collectMultipleValues(
      prompt,
      'Add a Related reference?',
      'Related (8-char hex Lore-id):',
    );

    return {
      intent,
      body,
      trailers: {
        Constraint: constraints.length > 0 ? constraints : undefined,
        Rejected: rejected.length > 0 ? rejected : undefined,
        Confidence: confidence,
        'Scope-risk': scopeRisk,
        Reversibility: reversibility,
        Directive: directives.length > 0 ? directives : undefined,
        Tested: tested.length > 0 ? tested : undefined,
        'Not-tested': notTested.length > 0 ? notTested : undefined,
        Supersedes: supersedes.length > 0 ? supersedes : undefined,
        'Depends-on': dependsOn.length > 0 ? dependsOn : undefined,
        Related: related.length > 0 ? related : undefined,
      },
    };
  } finally {
    prompt.close();
  }
}

/**
 * Helper to collect multiple values of the same trailer type.
 * Asks the user if they want to add one; if yes, collects value and asks again.
 */
async function collectMultipleValues(
  prompt: IPrompt,
  confirmMessage: string,
  inputMessage: string,
): Promise<string[]> {
  const values: string[] = [];

  while (true) {
    const wantsMore = await prompt.askConfirm(confirmMessage, false);
    if (!wantsMore) break;

    const value = await prompt.askText(inputMessage);
    if (value.trim()) {
      values.push(value.trim());
    }
  }

  return values;
}
