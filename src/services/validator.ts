import type { TrailerParser } from './trailer-parser.js';
import type { AtomRepository } from './atom-repository.js';
import type { LoreConfig } from '../types/config.js';
import type { RawCommit } from '../interfaces/git-client.js';
import type { CommitValidationResult, ValidationIssue } from '../types/output.js';
import { LORE_ID_PATTERN, LORE_ID_KEY } from '../util/constants.js';
import type { LoreTrailers, LoreId } from '../types/domain.js';
import type { Protocol } from './protocol.js';

/**
 * Validates existing git commits for Lore protocol compliance.
 * 
 * SOLID: SRP -- focused purely on protocol rule enforcement.
 * GRASP: Information Expert -- uses trailer definitions to validate schema.
 */
export class Validator {
  constructor(
    private readonly trailerParser: TrailerParser,
    private readonly atomRepository: AtomRepository,
    private readonly config: LoreConfig,
    private readonly protocol: Protocol,
  ) {}

  /**
   * Performs validation on a collection of raw commits.
   */
  async validate(commits: readonly RawCommit[]): Promise<CommitValidationResult[]> {
    const results: CommitValidationResult[] = [];
    for (const commit of commits) {
      results.push(await this.validateCommit(commit));
    }
    return results;
  }

  /**
   * Validate a single raw commit and collect all protocol issues.
   */
  private async validateCommit(commit: RawCommit): Promise<CommitValidationResult> {
    const issues: ValidationIssue[] = [];
    let trailers: LoreTrailers | null = null;
    let loreId: string | null = null;

    // Rule 1: Valid trailer format (parseable)
    try {
      trailers = this.trailerParser.parse(commit.trailers);
      loreId = trailers[LORE_ID_KEY][0] || null;
    } catch {
      issues.push({
        severity: 'error',
        rule: 'trailer-format',
        message: 'Failed to parse trailer block',
      });
    }

    if (trailers) {
      // 1. Schema-driven validation (Metadata-driven)
      this.validateSchema(trailers, issues);

      // 2. Intent length
      if (commit.subject.length > this.config.validation.intentMaxLength) {
        issues.push({
          severity: 'warning',
          rule: 'intent-length',
          message: `Intent exceeds ${this.config.validation.intentMaxLength} characters (got ${commit.subject.length})`,
        });
      }

      // 3. Message line count
      const totalLines = this.countMessageLines(commit);
      if (totalLines > this.config.validation.maxMessageLines) {
        issues.push({
          severity: 'warning',
          rule: 'message-length',
          message: `Message exceeds ${this.config.validation.maxMessageLines} lines (got ${totalLines})`,
        });
      }

      // 4. Trailer type counts (metadata-driven)
      this.validateTrailerCounts(trailers, issues);

      // 5. Reference existence (metadata-driven)
      await this.validateReferenceExistence(trailers, issues);
    }

    const hasErrors = issues.some((i) => i.severity === 'error');

    return {
      commit: commit.hash,
      loreId,
      valid: !hasErrors,
      issues,
    };
  }

  /**
   * Universal schema validation for all trailers (core and custom).
   * Enforces cardinality, enums, patterns, and requiredness based on definitions.
   */
  private validateSchema(
    trailers: LoreTrailers,
    issues: ValidationIssue[],
  ): void {
    const authorizedKeys = this.protocol.getAuthorizedKeys();

    for (const key of authorizedKeys) {
      const def = this.protocol.getDefinition(key);
      if (!def) continue;

      const values = trailers[key] || [];
      const isRequired = def.required;
      
      // Special Rule: Check for empty string explicitly for requiredness
      const hasValue = values.length > 0 && values.every(v => v.trim().length > 0);

      if (!hasValue && isRequired) {
        issues.push({
          severity: this.config.validation.strict || key === LORE_ID_KEY ? 'error' : 'warning',
          rule: key === LORE_ID_KEY ? 'lore-id-present' : 'required-trailer',
          field: key,
          message: `${key} trailer is missing`,
        });
        continue;
      }

      if (values.length === 0) continue;

      // Check Cardinality
      if (!def.multivalue && values.length > 1) {
        issues.push({
          severity: 'error',
          rule: 'invalid-cardinality',
          field: key,
          message: `Trailer "${key}" must have exactly one value (got ${values.length})`,
        });
      }

      // Check content rules
      for (const val of values) {
        if (def.validation === 'values' && def.values) {
          const validValues = Object.keys(def.values);
          if (!validValues.includes(val)) {
            issues.push({
              severity: 'error',
              rule: 'invalid-enum',
              field: key,
              message: `Invalid ${key} value: "${val}". Expected one of: ${validValues.join(', ')}`,
            });
          }
        } else if (def.validation === 'pattern' && def.pattern) {
          const regex = new RegExp(def.pattern);
          if (!regex.test(val)) {
            // Map pattern failures to specific semantic rules
            let rule = 'invalid-format';
            let severity: 'error' | 'warning' = 'error';
            let message = `Value for "${key}" does not match pattern: ${def.pattern}`;

            // Context-sensitive rule mapping
            if (key === LORE_ID_KEY) {
              rule = 'lore-id-format';
              message = `${LORE_ID_KEY} "${val}" is not a valid 8-character hex string`;
            } else if (def.ui?.kind === 'reference') {
              rule = 'reference-format';
              severity = 'warning';
              message = `Invalid reference format in ${key}: "${val}". Expected 8-character hex.`;
            }

            issues.push({ severity, rule, field: key, message });
          }
        }
      }
    }
  }

  /**
   * Validates that list-type trailers don't exceed reasonable counts.
   */
  private validateTrailerCounts(
    trailers: LoreTrailers,
    issues: ValidationIssue[],
  ): void {
    const listKeys = this.protocol.getListKeys();
    for (const key of listKeys) {
      const values = trailers[key];
      if (values && values.length > 5) {
        issues.push({
          severity: 'warning',
          rule: 'trailer-count',
          field: key,
          message: `More than 5 values for ${key} (got ${values.length})`,
        });
      }
    }
  }

  /**
   * Count the number of lines in the full commit message.
   */
  private countMessageLines(commit: RawCommit): number {
    let count = 1; // subject line
    if (commit.body.trim()) {
      count += 1; // blank line
      count += commit.body.split('\n').length;
    }
    if (commit.trailers.trim()) {
      count += 1; // blank line before trailers
      count += commit.trailers.split('\n').length;
    }
    return count;
  }

  /**
   * Check that referenced Lore-ids actually exist in the repository. 
   * Emits a warning for each missing reference.
   */
  private async validateReferenceExistence(
    trailers: LoreTrailers,
    issues: ValidationIssue[],
  ): Promise<void> {
    const refKeys = this.protocol.getReferenceKeys();
    for (const key of refKeys) {
      const values = trailers[key];
      if (!values) continue;

      for (const id of values) {
        // Only validate existence for values that look like Lore-ids
        if (!LORE_ID_PATTERN.test(id)) continue;
        
        const found = await this.atomRepository.findByLoreId(id);
        if (found === null) {
          issues.push({
            severity: 'warning',
            rule: 'reference-exists',
            field: key,
            message: `Referenced atom "${id}" in ${key} not found in repository`,
          });
        }
      }
    }
  }
}
