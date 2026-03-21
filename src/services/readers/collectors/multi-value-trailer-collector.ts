import type { ITrailerCollector, TrailerCollectorResult } from '../../../interfaces/trailer-collector.js';
import type { IPrompt } from '../../../interfaces/prompt.js';
import type { CommitInput } from '../../commit-builder.js';

interface MultiValueTrailerConfig {
  readonly key: keyof NonNullable<CommitInput['trailers']>;
  readonly confirmMessage: string;
  readonly inputMessage: string;
}

/**
 * Collects zero or more string values for array-type trailers.
 *
 * Implements the confirm-then-loop pattern: asks the user if they want to add
 * a value, collects it, then asks again until they decline.
 *
 * GoF: Strategy -- one of two trailer collection strategies.
 * SOLID: SRP -- responsible only for multi-value collection logic.
 */
export class MultiValueTrailerCollector implements ITrailerCollector {
  private readonly key: keyof NonNullable<CommitInput['trailers']>;
  private readonly confirmMessage: string;
  private readonly inputMessage: string;

  constructor(config: MultiValueTrailerConfig) {
    this.key = config.key;
    this.confirmMessage = config.confirmMessage;
    this.inputMessage = config.inputMessage;
  }

  async collect(prompt: IPrompt): Promise<TrailerCollectorResult> {
    const values: string[] = [];

    while (true) {
      const wantsMore = await prompt.askConfirm(this.confirmMessage, false);
      if (!wantsMore) break;

      const value = await prompt.askText(this.inputMessage);
      if (value.trim()) {
        values.push(value.trim());
      }
    }

    return {
      key: this.key,
      value: values.length > 0 ? values : undefined,
    };
  }
}
