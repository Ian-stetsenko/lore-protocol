import type { ICommitInputReader } from '../../interfaces/commit-input-reader.js';
import type { CommitInput } from '../commit-builder.js';
import type { CommitCommandOptions } from '../commit-input-resolver.js';
import type { ConfidenceLevel, ScopeRiskLevel, ReversibilityLevel } from '../../types/domain.js';

/**
 * Reads commit input from CLI flag values.
 *
 * Pure data mapping -- no I/O, no prompts.
 *
 * GRASP: Information Expert -- owns all knowledge of CLI-flags-to-CommitInput mapping.
 * SOLID: SRP -- single responsibility of mapping flags to CommitInput.
 */
export class FlagsInputReader implements ICommitInputReader {
  constructor(private readonly options: CommitCommandOptions) {}

  async read(): Promise<CommitInput> {
    return {
      intent: this.options.intent ?? '',
      body: this.options.body,
      trailers: {
        Constraint: this.options.constraint,
        Rejected: this.options.rejected,
        Confidence: this.options.confidence as ConfidenceLevel | undefined,
        'Scope-risk': this.options.scopeRisk as ScopeRiskLevel | undefined,
        Reversibility: this.options.reversibility as ReversibilityLevel | undefined,
        Directive: this.options.directive,
        Tested: this.options.tested,
        'Not-tested': this.options.notTested,
        Supersedes: this.options.supersedes,
        'Depends-on': this.options.dependsOn,
        Related: this.options.related,
      },
    };
  }
}
