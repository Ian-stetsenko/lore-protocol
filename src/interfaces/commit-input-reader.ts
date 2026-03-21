import type { CommitInput } from '../services/commit-builder.js';

/**
 * Strategy interface for reading commit input from different sources.
 *
 * SOLID: OCP -- new input sources can be added by implementing this interface
 * without modifying existing code.
 * GoF: Strategy -- each implementation encapsulates a different input algorithm.
 */
export interface ICommitInputReader {
  read(): Promise<CommitInput>;
}
