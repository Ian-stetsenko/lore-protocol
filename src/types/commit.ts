import type { LoreTrailers } from './domain.js';

/**
 * The structured input for creating a Lore atom.
 * Maps directly to the uniform domain model.
 */
export interface CommitInput {
  readonly intent: string;
  readonly body?: string;
  readonly trailers?: LoreTrailers;
}
