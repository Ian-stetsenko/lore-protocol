import type { ICommitInputReader } from '../../interfaces/commit-input-reader.js';
import type { CommitInput } from '../commit-builder.js';
import type { ConfidenceLevel, ScopeRiskLevel, ReversibilityLevel } from '../../types/domain.js';
import { CustomTrailerCollection } from '../../types/custom-trailer-collection.js';
import { LoreError } from '../../util/errors.js';

/** Top-level keys accepted in commit input JSON. */
const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(['intent', 'body', 'trailers']);

/** Human-readable JSON type of a value, for error messages. */
function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

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
  constructor(private readonly content: string) {}

  async read(): Promise<CommitInput> {
    return this.parseJsonInput(this.content);
  }

  private parseJsonInput(content: string): CommitInput {
    let parsedUnknown: unknown;
    try {
      parsedUnknown = JSON.parse(content);
    } catch (error) {
      throw new LoreError(`Commit input is not valid JSON: ${(error as Error).message}`, 1);
    }
    this.validateTopLevel(parsedUnknown);
    const parsed = parsedUnknown as Record<string, unknown>;

    const intent = typeof parsed.intent === 'string' ? parsed.intent : '';
    const body = typeof parsed.body === 'string' ? parsed.body : undefined;

    const trailersRaw = typeof parsed.trailers === 'object' && parsed.trailers !== null
      ? parsed.trailers as Record<string, unknown>
      : undefined;

    let trailers: CommitInput['trailers'];
    if (trailersRaw) {
      const custom = CustomTrailerCollection.fromRaw(trailersRaw);

      trailers = {
        Constraint: this.asStringArray(trailersRaw['Constraint']),
        Rejected: this.asStringArray(trailersRaw['Rejected']),
        Confidence: this.asEnumValue(trailersRaw['Confidence']) as ConfidenceLevel | undefined,
        'Scope-risk': this.asEnumValue(trailersRaw['Scope-risk']) as ScopeRiskLevel | undefined,
        Reversibility: this.asEnumValue(trailersRaw['Reversibility']) as ReversibilityLevel | undefined,
        Directive: this.asStringArray(trailersRaw['Directive']),
        Tested: this.asStringArray(trailersRaw['Tested']),
        'Not-tested': this.asStringArray(trailersRaw['Not-tested']),
        Supersedes: this.asStringArray(trailersRaw['Supersedes']),
        'Depends-on': this.asStringArray(trailersRaw['Depends-on']),
        Related: this.asStringArray(trailersRaw['Related']),
        custom: custom.isEmpty ? undefined : custom,
      };
    }

    return { intent, body, trailers };
  }

  /**
   * Reject malformed top-level input loudly. A misspelled or flat schema
   * must fail the commit, never silently produce a barren atom.
   */
  private validateTopLevel(value: unknown): void {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new LoreError(
        `Commit input JSON must be an object with allowed keys intent, body, trailers; got ${jsonTypeOf(value)}.`,
        1,
      );
    }

    const parsed = value as Record<string, unknown>;
    const unknown = Object.keys(parsed).filter((key) => !TOP_LEVEL_KEYS.has(key));
    if (unknown.length > 0) {
      throw new LoreError(
        `Unknown top-level key${unknown.length > 1 ? 's' : ''} in commit input JSON: ${unknown
          .map((key) => `"${key}"`)
          .join(', ')}. Allowed keys: intent, body, trailers. Trailer values belong inside the trailers object, e.g. {"intent": "...", "trailers": {"Tested": ["..."]}}.`,
        1,
      );
    }

    if ('intent' in parsed && typeof parsed.intent !== 'string') {
      throw new LoreError(`"intent" must be a string, got ${jsonTypeOf(parsed.intent)}.`, 1);
    }
    if ('body' in parsed && typeof parsed.body !== 'string') {
      throw new LoreError(`"body" must be a string, got ${jsonTypeOf(parsed.body)}.`, 1);
    }
    if (
      'trailers' in parsed &&
      (typeof parsed.trailers !== 'object' || parsed.trailers === null || Array.isArray(parsed.trailers))
    ) {
      throw new LoreError(`"trailers" must be an object, got ${jsonTypeOf(parsed.trailers)}.`, 1);
    }
  }

  private asStringArray(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
      return value.filter((v): v is string => typeof v === 'string');
    }
    if (typeof value === 'string') {
      return [value];
    }
    return undefined;
  }

  private asEnumValue(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }
}
