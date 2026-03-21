import type { ICommitInputReader } from '../../interfaces/commit-input-reader.js';
import type { CommitInput } from '../commit-builder.js';
import type { IPrompt } from '../../interfaces/prompt.js';
import type { ITrailerCollector } from '../../interfaces/trailer-collector.js';
import { PROMPT_STRINGS } from '../../util/constants.js';

/**
 * Reads commit input through interactive terminal prompts.
 *
 * Template Method pattern (via composition): read() orchestrates the
 * collection steps -- collectIntent(), collectBody(), collectTrailers() --
 * each of which is a private method responsible for one section.
 *
 * Trailer collection is delegated to ITrailerCollector strategies, which
 * are injected via the constructor. This makes the class open for extension
 * (new trailers) without modification.
 *
 * GRASP: Information Expert -- owns all knowledge of interactive input collection.
 * SOLID: SRP -- single responsibility of collecting commit input interactively.
 * SOLID: OCP -- new trailer types require only a new ITrailerCollector, not changes here.
 */
export class InteractiveInputReader implements ICommitInputReader {
  constructor(
    private readonly prompt: IPrompt,
    private readonly collectors: readonly ITrailerCollector[],
  ) {}

  async read(): Promise<CommitInput> {
    try {
      const intent = await this.collectIntent();
      const body = await this.collectBody();
      const trailers = await this.collectTrailers();
      return { intent, body, trailers };
    } finally {
      this.prompt.close();
    }
  }

  private async collectIntent(): Promise<string> {
    return this.prompt.askText(PROMPT_STRINGS.INTENT, {
      maxLength: 72,
    });
  }

  private async collectBody(): Promise<string | undefined> {
    const wantsBody = await this.prompt.askConfirm(PROMPT_STRINGS.ADD_BODY, false);
    if (!wantsBody) {
      return undefined;
    }
    return this.prompt.askMultiline(PROMPT_STRINGS.BODY_INPUT);
  }

  private async collectTrailers(): Promise<CommitInput['trailers']> {
    const trailers: Record<string, readonly string[] | string | undefined> = {};
    for (const collector of this.collectors) {
      const result = await collector.collect(this.prompt);
      trailers[result.key] = result.value;
    }
    return trailers as CommitInput['trailers'];
  }
}
