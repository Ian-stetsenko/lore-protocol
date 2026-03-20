import { createInterface, type Interface as ReadlineInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { IPrompt } from '../interfaces/prompt.js';

/**
 * IPrompt implementation using Node.js readline/promises.
 * Provides interactive terminal prompts for `lore commit -i`.
 *
 * GRASP: Protected Variations -- terminal I/O is volatile.
 * SOLID: LSP -- substitutable with a mock for testing.
 */
export class TerminalPrompt implements IPrompt {
  private rl: ReadlineInterface | null = null;

  private getReadline(): ReadlineInterface {
    if (this.rl === null) {
      this.rl = createInterface({ input: stdin, output: stdout });
    }
    return this.rl;
  }

  async askText(
    message: string,
    options?: { default?: string; maxLength?: number },
  ): Promise<string> {
    const rl = this.getReadline();

    const defaultHint = options?.default ? ` (default: ${options.default})` : '';
    const answer = await rl.question(`${message}${defaultHint} `);

    const trimmed = answer.trim();
    if (trimmed.length === 0 && options?.default) {
      return options.default;
    }

    if (options?.maxLength && trimmed.length > options.maxLength) {
      return trimmed.slice(0, options.maxLength);
    }

    return trimmed;
  }

  async askMultiline(message: string): Promise<string> {
    const rl = this.getReadline();

    console.log(message);
    const lines: string[] = [];

    while (true) {
      const line = await rl.question('');
      if (line.trim() === '') {
        break;
      }
      lines.push(line);
    }

    return lines.join('\n');
  }

  async askChoice<T extends string>(
    message: string,
    choices: readonly T[],
  ): Promise<T> {
    const rl = this.getReadline();

    const choiceList = choices.map((c, i) => `  ${i + 1}) ${c}`).join('\n');
    console.log(`${message}\n${choiceList}`);

    while (true) {
      const answer = await rl.question('Choice (number): ');
      const index = parseInt(answer.trim(), 10) - 1;

      if (index >= 0 && index < choices.length) {
        return choices[index];
      }

      // Also accept the exact value
      const matched = choices.find(
        (c) => c.toLowerCase() === answer.trim().toLowerCase(),
      );
      if (matched) {
        return matched;
      }

      console.log(`Invalid choice. Please enter 1-${choices.length} or the exact value.`);
    }
  }

  async askConfirm(message: string, defaultValue?: boolean): Promise<boolean> {
    const rl = this.getReadline();
    const hint = defaultValue === true ? ' [Y/n]' : defaultValue === false ? ' [y/N]' : ' [y/n]';
    const answer = await rl.question(`${message}${hint} `);

    const trimmed = answer.trim().toLowerCase();

    if (trimmed === '') {
      return defaultValue ?? false;
    }

    return trimmed === 'y' || trimmed === 'yes';
  }

  close(): void {
    if (this.rl !== null) {
      this.rl.close();
      this.rl = null;
    }
  }
}
