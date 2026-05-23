import type { IPrompt } from '../interfaces/prompt.js';
import type { ICommitInputReader } from '../interfaces/commit-input-reader.js';
import type { CommitInput } from '../types/commit.js';
import { readFile } from 'node:fs/promises';

import { InteractiveInputReader } from './readers/interactive-input-reader.js';
import { JsonInputReader } from './readers/json-input-reader.js';
import { FlagsInputReader } from './readers/flags-input-reader.js';
import { TrailerCollectorRegistry } from './readers/collectors/trailer-collector-registry.js';
import type { Protocol } from './protocol.js';

/**
 * The modes of commit input resolution, ordered by priority.
 * interactive > file > flags > stdin
 */
export enum InputMode {
  Interactive = 'interactive',
  File = 'file',
  Flags = 'flags',
  Stdin = 'stdin',
}

/**
 * CLI options passed to the commit command.
 * 
 * SOLID: SRP -- pure DTO for CLI option parsing.
 * Supports dynamic core flags via index signature.
 */
export interface CommitCommandOptions {
  readonly amend?: boolean;
  readonly edit?: boolean;
  readonly file?: string;
  readonly interactive?: boolean;
  readonly intent?: string;
  readonly body?: string;
  readonly trailer?: string[];
  /** Dynamic core flags from definitions (e.g. confidence, scope-risk) */
  readonly [key: string]: unknown;
}

/**
 * Resolves commit input from the appropriate source based on CLI options.
 *
 * Pure dispatcher: determines the input mode, constructs the appropriate
 * ICommitInputReader strategy, and delegates reading to it.
 *
 * Mode priority: interactive > file > flags > stdin.
 * When no flags are set and stdin is a TTY, resolves to 'interactive' to
 * avoid hanging on stdin.
 *
 * GoF: Strategy -- delegates reading to ICommitInputReader implementations.
 * GRASP: Controller -- coordinates mode resolution and reader creation.
 * SOLID: OCP -- new input modes require only a new reader + a case in createReader().
 */
export class CommitInputResolver {
  constructor(
    private readonly prompt: IPrompt,
    private readonly protocol: Protocol,
  ) {}

  /**
   * Resolve commit input from the appropriate source based on CLI options.
   */
  async resolve(options: CommitCommandOptions): Promise<CommitInput> {
    const mode = this.resolveMode(options);
    const reader = await this.createReader(mode, options);
    return reader.read();
  }

  /**
   * Determine the input mode based on option priority.
   * interactive > file > flags > stdin
   * When no flags are set and stdin is a TTY, default to 'interactive'.
   */
  private resolveMode(options: CommitCommandOptions): InputMode {
    if (options.interactive) {
      return InputMode.Interactive;
    }
    if (options.file) {
      return InputMode.File;
    }
    
    // Check if any intent or any trailer flag was provided
    const hasFlags = !!options.intent || 
                   !!options.trailer || 
                   Object.keys(options).some(k => k !== 'amend' && k !== 'edit');

    if (hasFlags) {
      return InputMode.Flags;
    }
    if (process.stdin.isTTY) {
      return InputMode.Interactive;
    }
    return InputMode.Stdin;
  }

  /**
   * Construct the appropriate ICommitInputReader for the resolved mode.
   */
  private async createReader(
    mode: InputMode,
    options: CommitCommandOptions,
  ): Promise<ICommitInputReader> {
    switch (mode) {
      case InputMode.Interactive: {
        const registry = new TrailerCollectorRegistry(this.protocol);
        return new InteractiveInputReader(
          this.prompt,
          registry.getCollectors(),
        );
      }
      case InputMode.File:
        return new JsonInputReader(await readFile(options.file!, 'utf-8'));
      case InputMode.Flags:
        return new FlagsInputReader(options, this.protocol);
      case InputMode.Stdin:
        return new JsonInputReader(await this.readStdinContent());
    }
  }

  /**
   * Read raw content from stdin, collecting chunks until EOF.
   */
  private readStdinContent(): Promise<string> {
    const chunks: Buffer[] = [];

    return new Promise<string>((resolve, reject) => {
      process.stdin.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      process.stdin.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf-8'));
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
}
