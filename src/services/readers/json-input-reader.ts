import type { ICommitInputReader } from '../../interfaces/commit-input-reader.js';
import type { CommitInput } from '../../types/commit.js';

/**
 * Reads commit input by parsing a JSON string.
 *
 * Used for both file-based and stdin-based input -- the caller is responsible
 * for fetching the raw content; this class only handles parsing.
 *
 * GRASP: Information Expert -- owns all knowledge of JSON-to-CommitInput mapping.
 * SOLID: SRP -- single responsibility of parsing JSON into CommitInput.
 */
export class JsonInputReader implements ICommitInputReader {
  constructor(private readonly json: string) {}

  async read(): Promise<CommitInput> {
    if (!this.json || !this.json.trim()) {
      throw new Error('Empty JSON input');
    }

    try {
      const data = JSON.parse(this.json);
      const input: CommitInput = {
        intent: typeof data.intent === 'string' ? data.intent : '',
        body: typeof data.body === 'string' ? data.body : undefined,
      };

      if (data.trailers && typeof data.trailers === 'object' && !Array.isArray(data.trailers)) {
        const trailers: Record<string, string[]> = {};
        const rawTrailers = data.trailers as Record<string, unknown>;

        for (const key of Object.keys(rawTrailers)) {
          const val = rawTrailers[key];
          
          if (Array.isArray(val)) {
            const stringValues = val.filter((v) => typeof v === 'string');
            if (stringValues.length > 0) {
              trailers[key] = stringValues;
            }
          } else if (typeof val === 'string') {
            const trimmed = val.trim();
            if (trimmed) {
              trailers[key] = [trimmed];
            }
          }
        }
        
        (input as any).trailers = trailers;
      }

      return input;
    } catch (err) {
      if (err instanceof Error) {
        throw new Error(`Failed to parse JSON input: ${err.message}`);
      }
      throw err;
    }
  }
}
