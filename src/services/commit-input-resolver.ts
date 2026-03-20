import type { IPrompt } from '../interfaces/prompt.js';
import type { CommitInput } from './commit-builder.js';
import type { ConfidenceLevel, ScopeRiskLevel, ReversibilityLevel } from '../types/domain.js';
import { readFile } from 'node:fs/promises';
import { CONFIDENCE_VALUES, SCOPE_RISK_VALUES, REVERSIBILITY_VALUES } from '../util/constants.js';

/**
 * The modes of commit input resolution, ordered by priority.
 * interactive > file > flags > stdin
 */
type InputMode = 'interactive' | 'file' | 'flags' | 'stdin';

/**
 * A function that reads commit input from a particular source.
 */
type InputReader = (options: CommitCommandOptions) => Promise<CommitInput>;

/**
 * CLI options passed to the commit command.
 */
export interface CommitCommandOptions {
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
 * Resolves commit input from the appropriate source based on CLI options.
 *
 * Replaces the if/else chain in the commit command with a dispatch map.
 * Mode priority: interactive > file > flags > stdin.
 * When no flags are set and stdin is a TTY, resolves to 'interactive' to
 * avoid hanging on stdin.
 *
 * GRASP: Information Expert -- owns all knowledge of input resolution.
 * SOLID: SRP -- single responsibility of resolving commit input from any source.
 */
export class CommitInputResolver {
  private readonly prompt: IPrompt;
  private readonly readers: Record<InputMode, InputReader>;

  constructor(prompt: IPrompt) {
    this.prompt = prompt;
    this.readers = {
      interactive: () => this.collectInteractiveInput(),
      file: (options) => this.readFromFile(options.file!),
      flags: (options) => Promise.resolve(this.buildInputFromFlags(options)),
      stdin: () => this.readInputFromStdin(),
    };
  }

  /**
   * Resolve commit input from the appropriate source based on CLI options.
   */
  async resolve(options: CommitCommandOptions): Promise<CommitInput> {
    const mode = this.resolveMode(options);
    const reader = this.readers[mode];
    return reader(options);
  }

  /**
   * Determine the input mode based on option priority.
   * interactive > file > flags > stdin
   * When no flags are set and stdin is a TTY, default to 'interactive'.
   */
  private resolveMode(options: CommitCommandOptions): InputMode {
    if (options.interactive) {
      return 'interactive';
    }
    if (options.file) {
      return 'file';
    }
    if (options.intent) {
      return 'flags';
    }
    if (process.stdin.isTTY) {
      return 'interactive';
    }
    return 'stdin';
  }

  /**
   * Read JSON input from a file.
   */
  private async readFromFile(filePath: string): Promise<CommitInput> {
    const content = await readFile(filePath, 'utf-8');
    return this.parseJsonInput(content);
  }

  /**
   * Read JSON from stdin, collecting chunks until EOF.
   */
  private async readInputFromStdin(): Promise<CommitInput> {
    const chunks: Buffer[] = [];

    return new Promise<CommitInput>((resolve, reject) => {
      process.stdin.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      process.stdin.on('end', () => {
        const content = Buffer.concat(chunks).toString('utf-8');
        try {
          resolve(this.parseJsonInput(content));
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
  private parseJsonInput(content: string): CommitInput {
    const parsed = JSON.parse(content) as Record<string, unknown>;

    const intent = typeof parsed.intent === 'string' ? parsed.intent : '';
    const body = typeof parsed.body === 'string' ? parsed.body : undefined;

    const trailersRaw = typeof parsed.trailers === 'object' && parsed.trailers !== null
      ? parsed.trailers as Record<string, unknown>
      : undefined;

    let trailers: CommitInput['trailers'];
    if (trailersRaw) {
      trailers = {
        Constraint: this.asStringArray(trailersRaw['Constraint']),
        Rejected: this.asStringArray(trailersRaw['Rejected']),
        Confidence: this.asEnumValue(trailersRaw['Confidence']) as ConfidenceLevel | undefined,
        'Scope-risk': this.asEnumValue(trailersRaw['Scope-risk']) as ScopeRiskLevel | undefined,
        Reversibility: this.asEnumValue(trailersRaw['Reversibility']) as ReversibilityLevel | undefined,
        Directive: this.asStringArray(trailersRaw['Directive']),
        Tested: this.asStringArray(trailersRaw['Tested']),
        'Not-tested': this.asStringArray(trailersRaw['Not-tested']),
        Supersedes: this.asStringArray(trailersRaw['Supersedes']),
        'Depends-on': this.asStringArray(trailersRaw['Depends-on']),
        Related: this.asStringArray(trailersRaw['Related']),
      };
    }

    return { intent, body, trailers };
  }

  private asStringArray(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
      return value.filter((v): v is string => typeof v === 'string');
    }
    return undefined;
  }

  private asEnumValue(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  /**
   * Build CommitInput from CLI flags.
   */
  private buildInputFromFlags(options: CommitCommandOptions): CommitInput {
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
  private async collectInteractiveInput(): Promise<CommitInput> {
    try {
      // Required: intent
      const intent = await this.prompt.askText('Intent (why the change was made):', {
        maxLength: 72,
      });

      // Optional: body
      const wantsBody = await this.prompt.askConfirm('Add a body? (narrative context)', false);
      let body: string | undefined;
      if (wantsBody) {
        body = await this.prompt.askMultiline('Body (press Enter on empty line to finish):');
      }

      // Constraints
      const constraints = await this.collectMultipleValues(
        'Add a Constraint?',
        'Constraint:',
      );

      // Rejected
      const rejected = await this.collectMultipleValues(
        'Add a Rejected alternative?',
        'Rejected (format: alternative | reason):',
      );

      // Confidence
      let confidence: ConfidenceLevel | undefined;
      const wantsConfidence = await this.prompt.askConfirm('Set Confidence?', false);
      if (wantsConfidence) {
        confidence = await this.prompt.askChoice('Confidence:', CONFIDENCE_VALUES);
      }

      // Scope-risk
      let scopeRisk: ScopeRiskLevel | undefined;
      const wantsScopeRisk = await this.prompt.askConfirm('Set Scope-risk?', false);
      if (wantsScopeRisk) {
        scopeRisk = await this.prompt.askChoice('Scope-risk:', SCOPE_RISK_VALUES);
      }

      // Reversibility
      let reversibility: ReversibilityLevel | undefined;
      const wantsReversibility = await this.prompt.askConfirm('Set Reversibility?', false);
      if (wantsReversibility) {
        reversibility = await this.prompt.askChoice('Reversibility:', REVERSIBILITY_VALUES);
      }

      // Directives
      const directives = await this.collectMultipleValues(
        'Add a Directive?',
        'Directive:',
      );

      // Tested
      const tested = await this.collectMultipleValues(
        'Add a Tested entry?',
        'Tested:',
      );

      // Not-tested
      const notTested = await this.collectMultipleValues(
        'Add a Not-tested entry?',
        'Not-tested:',
      );

      // Supersedes
      const supersedes = await this.collectMultipleValues(
        'Add a Supersedes reference?',
        'Supersedes (8-char hex Lore-id):',
      );

      // Depends-on
      const dependsOn = await this.collectMultipleValues(
        'Add a Depends-on reference?',
        'Depends-on (8-char hex Lore-id):',
      );

      // Related
      const related = await this.collectMultipleValues(
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
      this.prompt.close();
    }
  }

  /**
   * Helper to collect multiple values of the same trailer type.
   * Asks the user if they want to add one; if yes, collects value and asks again.
   */
  private async collectMultipleValues(
    confirmMessage: string,
    inputMessage: string,
  ): Promise<string[]> {
    const values: string[] = [];

    while (true) {
      const wantsMore = await this.prompt.askConfirm(confirmMessage, false);
      if (!wantsMore) break;

      const value = await this.prompt.askText(inputMessage);
      if (value.trim()) {
        values.push(value.trim());
      }
    }

    return values;
  }
}
