import type { TrailerParser } from './trailer-parser.js';
import type { LoreIdGenerator } from './lore-id-generator.js';
import type { LoreConfig } from '../types/config.js';
import type { LoreTrailers, ConfidenceLevel, ScopeRiskLevel, ReversibilityLevel, LoreId } from '../types/domain.js';
import type { ValidationIssue } from '../types/output.js';
import {
  CONFIDENCE_VALUES,
  SCOPE_RISK_VALUES,
  REVERSIBILITY_VALUES,
  LORE_ID_PATTERN,
} from '../util/constants.js';

export interface CommitInput {
  readonly intent: string;
  readonly body?: string;
  readonly trailers?: {
    readonly Constraint?: readonly string[];
    readonly Rejected?: readonly string[];
    readonly Confidence?: ConfidenceLevel;
    readonly 'Scope-risk'?: ScopeRiskLevel;
    readonly Reversibility?: ReversibilityLevel;
    readonly Directive?: readonly string[];
    readonly Tested?: readonly string[];
    readonly 'Not-tested'?: readonly string[];
    readonly Supersedes?: readonly string[];
    readonly 'Depends-on'?: readonly string[];
    readonly Related?: readonly string[];
    readonly custom?: Readonly<Record<string, readonly string[]>>;
  };
}

export class CommitBuilder {
  private readonly trailerParser: TrailerParser;
  private readonly loreIdGenerator: LoreIdGenerator;
  private readonly config: LoreConfig;

  constructor(
    trailerParser: TrailerParser,
    loreIdGenerator: LoreIdGenerator,
    config: LoreConfig,
  ) {
    this.trailerParser = trailerParser;
    this.loreIdGenerator = loreIdGenerator;
    this.config = config;
  }

  build(input: CommitInput): string {
    const loreId = this.loreIdGenerator.generate();
    const trailers = this.buildTrailers(loreId, input);
    const serialized = this.trailerParser.serialize(trailers);

    const parts: string[] = [input.intent];

    if (input.body) {
      parts.push('');
      parts.push(input.body);
    }

    parts.push('');
    parts.push(serialized);

    return parts.join('\n');
  }

  validate(input: CommitInput): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // 1. Intent length
    if (input.intent.length > this.config.validation.intentMaxLength) {
      issues.push({
        severity: 'warning',
        rule: 'intent-length',
        message: `Intent exceeds ${this.config.validation.intentMaxLength} characters (got ${input.intent.length})`,
      });
    }

    // 2. Intent must not be empty
    if (input.intent.trim().length === 0) {
      issues.push({
        severity: 'error',
        rule: 'intent-required',
        message: 'Intent must not be empty',
      });
    }

    // 3. Validate enum values
    if (input.trailers?.Confidence !== undefined) {
      if (
        !(CONFIDENCE_VALUES as readonly string[]).includes(
          input.trailers.Confidence,
        )
      ) {
        issues.push({
          severity: 'error',
          rule: 'invalid-enum',
          message: `Invalid Confidence value: "${input.trailers.Confidence}". Expected one of: ${CONFIDENCE_VALUES.join(', ')}`,
        });
      }
    }

    if (input.trailers?.['Scope-risk'] !== undefined) {
      if (
        !(SCOPE_RISK_VALUES as readonly string[]).includes(
          input.trailers['Scope-risk'],
        )
      ) {
        issues.push({
          severity: 'error',
          rule: 'invalid-enum',
          message: `Invalid Scope-risk value: "${input.trailers['Scope-risk']}". Expected one of: ${SCOPE_RISK_VALUES.join(', ')}`,
        });
      }
    }

    if (input.trailers?.Reversibility !== undefined) {
      if (
        !(REVERSIBILITY_VALUES as readonly string[]).includes(
          input.trailers.Reversibility,
        )
      ) {
        issues.push({
          severity: 'error',
          rule: 'invalid-enum',
          message: `Invalid Reversibility value: "${input.trailers.Reversibility}". Expected one of: ${REVERSIBILITY_VALUES.join(', ')}`,
        });
      }
    }

    // 4. Validate lore-id format in reference trailers
    const referenceKeys = ['Supersedes', 'Depends-on', 'Related'] as const;
    for (const key of referenceKeys) {
      const values = input.trailers?.[key];
      if (values) {
        for (const value of values) {
          if (!LORE_ID_PATTERN.test(value)) {
            issues.push({
              severity: 'error',
              rule: 'invalid-lore-id-ref',
              message: `Invalid Lore-id reference in ${key}: "${value}". Must be 8-character hex.`,
            });
          }
        }
      }
    }

    // 5. Required trailers from config
    const requiredTrailers = this.config.trailers.required;
    for (const required of requiredTrailers) {
      if (!this.hasTrailer(input, required)) {
        issues.push({
          severity: this.config.validation.strict ? 'error' : 'warning',
          rule: 'required-trailer',
          message: `Required trailer "${required}" is missing`,
        });
      }
    }

    // 6. Total message line count
    const lineCount = this.estimateLineCount(input);
    if (lineCount > this.config.validation.maxMessageLines) {
      issues.push({
        severity: 'warning',
        rule: 'message-length',
        message: `Message exceeds ${this.config.validation.maxMessageLines} lines (estimated ${lineCount})`,
      });
    }

    return issues;
  }

  private buildTrailers(loreId: LoreId, input: CommitInput): LoreTrailers {
    return {
      'Lore-id': loreId,
      Constraint: input.trailers?.Constraint ? [...input.trailers.Constraint] : [],
      Rejected: input.trailers?.Rejected ? [...input.trailers.Rejected] : [],
      Confidence: input.trailers?.Confidence ?? null,
      'Scope-risk': input.trailers?.['Scope-risk'] ?? null,
      Reversibility: input.trailers?.Reversibility ?? null,
      Directive: input.trailers?.Directive ? [...input.trailers.Directive] : [],
      Tested: input.trailers?.Tested ? [...input.trailers.Tested] : [],
      'Not-tested': input.trailers?.['Not-tested'] ? [...input.trailers['Not-tested']] : [],
      Supersedes: input.trailers?.Supersedes ? [...input.trailers.Supersedes] : [],
      'Depends-on': input.trailers?.['Depends-on'] ? [...input.trailers['Depends-on']] : [],
      Related: input.trailers?.Related ? [...input.trailers.Related] : [],
      custom: this.buildCustomMap(input.trailers?.custom),
    };
  }

  private hasTrailer(input: CommitInput, key: string): boolean {
    if (!input.trailers) return false;

    // Check core trailers first
    const trailerMap = input.trailers as Record<string, unknown>;
    const value = trailerMap[key];

    if (value !== undefined && value !== null) {
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'string') return value.length > 0;
      return true;
    }

    // Check custom trailers
    if (input.trailers.custom) {
      const customValue = input.trailers.custom[key];
      if (customValue && customValue.length > 0) return true;
    }

    return false;
  }

  private buildCustomMap(
    custom: Readonly<Record<string, readonly string[]>> | undefined,
  ): ReadonlyMap<string, readonly string[]> {
    if (!custom) return new Map();
    const map = new Map<string, readonly string[]>();
    for (const [key, values] of Object.entries(custom)) {
      if (Array.isArray(values) && values.length > 0) {
        map.set(key, [...values]);
      }
    }
    return map;
  }

  private estimateLineCount(input: CommitInput): number {
    let count = 1; // intent line
    if (input.body) {
      count += 1; // blank line
      count += input.body.split('\n').length;
    }
    count += 1; // blank line before trailers
    // Count trailer lines
    if (input.trailers) {
      count += 1; // Lore-id
      const arrayKeys = [
        'Constraint',
        'Rejected',
        'Directive',
        'Tested',
        'Not-tested',
        'Supersedes',
        'Depends-on',
        'Related',
      ] as const;
      for (const key of arrayKeys) {
        const values = input.trailers[key];
        if (values) {
          count += values.length;
        }
      }
      const enumKeys = ['Confidence', 'Scope-risk', 'Reversibility'] as const;
      for (const key of enumKeys) {
        if (input.trailers[key] !== undefined) {
          count += 1;
        }
      }
      if (input.trailers.custom) {
        for (const values of Object.values(input.trailers.custom)) {
          count += values.length;
        }
      }
    }
    return count;
  }
}
