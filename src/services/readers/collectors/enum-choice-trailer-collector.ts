import type { IPrompt } from '../../../interfaces/prompt.js';
import type {
  ITrailerCollector,
  TrailerCollectionResult,
} from '../../../interfaces/trailer-collector.js';

interface EnumChoiceTrailerConfig {
  readonly key: string;
  readonly confirmMessage: string;
  readonly choiceMessage: string;
  readonly values: readonly string[];
}

/**
 * Collects a single enum choice for enum-type trailers.
 *
 * Asks the user if they want to set the value; if yes, presents the
 * available choices.
 *
 * GoF: Strategy -- one of two trailer collection strategies.
 * SOLID: SRP -- responsible only for enum-choice collection logic.
 */
export class EnumChoiceTrailerCollector implements ITrailerCollector {
  readonly key: string;
  private readonly confirmMessage: string;
  private readonly choiceMessage: string;
  private readonly values: readonly string[];

  constructor(config: EnumChoiceTrailerConfig) {
    this.key = config.key;
    this.confirmMessage = config.confirmMessage;
    this.choiceMessage = config.choiceMessage;
    this.values = config.values;
  }

  async collect(prompt: IPrompt): Promise<TrailerCollectionResult> {
    const wantsValue = await prompt.askConfirm(this.confirmMessage, false);
    if (!wantsValue) {
      return { key: this.key, value: undefined };
    }

    const chosen = await prompt.askChoice(this.choiceMessage, this.values);
    return { key: this.key, value: chosen };
  }
}
