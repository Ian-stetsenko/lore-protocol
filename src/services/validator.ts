import type { TrailerParser } from './trailer-parser.js';
import type { LoreConfig } from '../types/config.js';
import type { RawCommit } from '../interfaces/git-client.js';
import type { CommitValidationResult, ValidationIssue } from '../types/output.js';
import {
  CONFIDENCE_VALUES,
  SCOPE_RISK_VALUES,
  REVERSIBILITY_VALUES,
  LORE_ID_PATTERN,
  ARRAY_TRAILER_KEYS,
} from '../util/constants.js';
import type { LoreTrailers } from '../types/domain.js';

export class Validator {
  private readonly trailerParser: TrailerParser;
  private readonly config: LoreConfig;

  constructor(
    trailerParser: TrailerParser,
    config: LoreConfig,
  ) {
    this.trailerParser = trailerParser;
    this.config = config;
  }

  validate(commits: readonly RawCommit[]): CommitValidationResult[] {
    return commits.map((commit) => this.validateCommit(commit));
  }

  private validateCommit(commit: RawCommit): CommitValidationResult {
    const issues: ValidationIssue[] = [];
    let trailers: LoreTrailers | null = null;
    let loreId: string | null = null;

    // Rule 1: Valid trailer format (parseable)
    try {
      trailers = this.trailerParser.parse(
        commit.trailers,
        this.config.trailers.custom,
      );
      loreId = trailers['Lore-id'] || null;
    } catch {
      issues.push({
        severity: 'error',
        rule: 'trailer-format',
        message: 'Failed to parse trailer block',
      });
    }

    // Rule 2: Lore-id present
    if (trailers && !trailers['Lore-id']) {
      issues.push({
        severity: 'error',
        rule: 'lore-id-present',
        message: 'Lore-id trailer is missing',
      });
    }

    // Rule 3: Lore-id format (8-char hex)
    if (trailers && trailers['Lore-id'] && !LORE_ID_PATTERN.test(trailers['Lore-id'])) {
      issues.push({
        severity: 'error',
        rule: 'lore-id-format',
        message: `Lore-id "${trailers['Lore-id']}" is not a valid 8-character hex string`,
      });
    }

    // Rule 4: Valid enum values
    if (trailers) {
      this.validateEnumValues(trailers, issues);
    }

    // Rule 5: Intent length
    if (commit.subject.length > this.config.validation.intentMaxLength) {
      issues.push({
        severity: 'warning',
        rule: 'intent-length',
        message: `Intent exceeds ${this.config.validation.intentMaxLength} characters (got ${commit.subject.length})`,
      });
    }

    // Rule 6: Required trailers present
    if (trailers) {
      this.validateRequiredTrailers(trailers, issues);
    }

    // Rule 7: Message line count
    const totalLines = this.countMessageLines(commit);
    if (totalLines > this.config.validation.maxMessageLines) {
      issues.push({
        severity: 'warning',
        rule: 'message-length',
        message: `Message exceeds ${this.config.validation.maxMessageLines} lines (got ${totalLines})`,
      });
    }

    // Rule 8: Reference format valid (8-char hex)
    if (trailers) {
      this.validateReferenceFormats(trailers, issues);
    }

    // Rule 9: More than 5 of any trailer type
    if (trailers) {
      this.validateTrailerCounts(trailers, issues);
    }

    const hasErrors = issues.some((i) => i.severity === 'error');

    return {
      commit: commit.hash,
      loreId,
      valid: !hasErrors,
      issues,
    };
  }

  private validateEnumValues(
    trailers: LoreTrailers,
    issues: ValidationIssue[],
  ): void {
    if (
      trailers.Confidence !== null &&
      !(CONFIDENCE_VALUES as readonly string[]).includes(trailers.Confidence)
    ) {
      issues.push({
        severity: 'error',
        rule: 'invalid-enum',
        message: `Invalid Confidence value: "${trailers.Confidence}". Expected one of: ${CONFIDENCE_VALUES.join(', ')}`,
      });
    }

    if (
      trailers['Scope-risk'] !== null &&
      !(SCOPE_RISK_VALUES as readonly string[]).includes(trailers['Scope-risk'])
    ) {
      issues.push({
        severity: 'error',
        rule: 'invalid-enum',
        message: `Invalid Scope-risk value: "${trailers['Scope-risk']}". Expected one of: ${SCOPE_RISK_VALUES.join(', ')}`,
      });
    }

    if (
      trailers.Reversibility !== null &&
      !(REVERSIBILITY_VALUES as readonly string[]).includes(
        trailers.Reversibility,
      )
    ) {
      issues.push({
        severity: 'error',
        rule: 'invalid-enum',
        message: `Invalid Reversibility value: "${trailers.Reversibility}". Expected one of: ${REVERSIBILITY_VALUES.join(', ')}`,
      });
    }
  }

  private validateRequiredTrailers(
    trailers: LoreTrailers,
    issues: ValidationIssue[],
  ): void {
    for (const required of this.config.trailers.required) {
      const hasValue = this.trailerHasValue(trailers, required);
      if (!hasValue) {
        issues.push({
          severity: this.config.validation.strict ? 'error' : 'warning',
          rule: 'required-trailer',
          message: `Required trailer "${required}" is missing`,
        });
      }
    }
  }

  private trailerHasValue(trailers: LoreTrailers, key: string): boolean {
    // Check known trailer keys
    switch (key) {
      case 'Lore-id':
        return !!trailers['Lore-id'];
      case 'Constraint':
        return trailers.Constraint.length > 0;
      case 'Rejected':
        return trailers.Rejected.length > 0;
      case 'Confidence':
        return trailers.Confidence !== null;
      case 'Scope-risk':
        return trailers['Scope-risk'] !== null;
      case 'Reversibility':
        return trailers.Reversibility !== null;
      case 'Directive':
        return trailers.Directive.length > 0;
      case 'Tested':
        return trailers.Tested.length > 0;
      case 'Not-tested':
        return trailers['Not-tested'].length > 0;
      case 'Supersedes':
        return trailers.Supersedes.length > 0;
      case 'Depends-on':
        return trailers['Depends-on'].length > 0;
      case 'Related':
        return trailers.Related.length > 0;
      default: {
        // Check custom trailers
        const customValues = trailers.custom.get(key);
        return customValues !== undefined && customValues.length > 0;
      }
    }
  }

  private validateReferenceFormats(
    trailers: LoreTrailers,
    issues: ValidationIssue[],
  ): void {
    const refSets: { key: string; values: readonly string[] }[] = [
      { key: 'Supersedes', values: trailers.Supersedes },
      { key: 'Depends-on', values: trailers['Depends-on'] },
      { key: 'Related', values: trailers.Related },
    ];

    for (const { key, values } of refSets) {
      for (const value of values) {
        if (!LORE_ID_PATTERN.test(value)) {
          issues.push({
            severity: 'warning',
            rule: 'reference-format',
            message: `Invalid reference format in ${key}: "${value}". Expected 8-character hex.`,
          });
        }
      }
    }
  }

  private validateTrailerCounts(
    trailers: LoreTrailers,
    issues: ValidationIssue[],
  ): void {
    const countChecks: { key: string; count: number }[] = [];

    for (const key of ARRAY_TRAILER_KEYS) {
      const values = trailers[key];
      if (Array.isArray(values) || (values && 'length' in values)) {
        countChecks.push({ key, count: values.length });
      }
    }

    for (const { key, count } of countChecks) {
      if (count > 5) {
        issues.push({
          severity: 'warning',
          rule: 'trailer-count',
          message: `More than 5 values for ${key} (got ${count})`,
        });
      }
    }
  }

  private countMessageLines(commit: RawCommit): number {
    let count = 1; // subject line
    if (commit.body.trim()) {
      count += 1; // blank line between subject and body
      count += commit.body.split('\n').length;
    }
    if (commit.trailers.trim()) {
      count += 1; // blank line before trailers
      count += commit.trailers.split('\n').length;
    }
    return count;
  }
}
