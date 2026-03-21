import type { ICommitInputReader } from '../../interfaces/commit-input-reader.js';
import type { CommitInput } from '../commit-builder.js';
import type { ConfidenceLevel, ScopeRiskLevel, ReversibilityLevel } from '../../types/domain.js';

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
    const parsed = JSON.parse(content) as Record<string, unknown>;

    const intent = typeof parsed.intent === 'string' ? parsed.intent : '';
    const body = typeof parsed.body === 'string' ? parsed.body : undefined;

    const trailersRaw = typeof parsed.trailers === 'object' && parsed.trailers !== null
      ? parsed.trailers as Record<string, unknown>
      : undefined;

    let trailers: CommitInput['trailers'];
    if (trailersRaw) {
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
      };
    }

    return { intent, body, trailers };
  }

  private asStringArray(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
      return value.filter((v): v is string => typeof v === 'string');
    }
    return undefined;
  }

  private asEnumValue(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }
}
