import type { IPrompt } from './prompt.js';
import type { CommitInput } from '../services/commit-builder.js';

export interface TrailerCollectorResult {
  readonly key: keyof NonNullable<CommitInput['trailers']>;
  readonly value: readonly string[] | string | undefined;
}

/**
 * Strategy interface for collecting a single trailer value from the user.
 *
 * Each implementation encapsulates the prompt logic for one trailer type
 * (multi-value array trailers or single enum-choice trailers).
 *
 * GoF: Strategy -- each collector encapsulates a different collection algorithm.
 * SOLID: SRP -- each collector is responsible for exactly one trailer.
 * SOLID: OCP -- new trailer types require only a new collector implementation.
 */
export interface ITrailerCollector {
  collect(prompt: IPrompt): Promise<TrailerCollectorResult>;
}
