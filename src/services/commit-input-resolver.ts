import type { IPrompt } from '../interfaces/prompt.js';
import type { ICommitInputReader } from '../interfaces/commit-input-reader.js';
import type { CommitInput } from './commit-builder.js';
import { readFile } from 'node:fs/promises';

import { InteractiveInputReader } from './readers/interactive-input-reader.js';
import { JsonInputReader } from './readers/json-input-reader.js';
import { FlagsInputReader } from './readers/flags-input-reader.js';

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
  constructor(private readonly prompt: IPrompt) {}

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
    if (options.intent) {
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
      case InputMode.Interactive:
        return new InteractiveInputReader(this.prompt);
      case InputMode.File: {
        const content = await this.readFileContent(options.file!);
        return new JsonInputReader(content);
      }
      case InputMode.Stdin: {
        const content = await this.readStdinContent();
        return new JsonInputReader(content);
      }
      case InputMode.Flags:
        return new FlagsInputReader(options);
    }
  }

  /**
   * Read raw content from a file path.
   */
  private async readFileContent(filePath: string): Promise<string> {
    return readFile(filePath, 'utf-8');
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
