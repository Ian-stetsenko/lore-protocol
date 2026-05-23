import type { IPrompt } from './prompt.js';

export interface TrailerCollectionResult {
  readonly key: string;
  readonly value: string | string[] | undefined;
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
  readonly key: string;
  collect(prompt: IPrompt): Promise<TrailerCollectionResult>;
}
