import type { TrailerParser } from './trailer-parser.js';
import type { LoreIdGenerator } from './lore-id-generator.js';
import type { LoreConfig } from '../types/config.js';
import type { LoreTrailers, LoreId } from '../types/domain.js';
import type { CommitInput } from '../types/commit.js';
import type { ValidationIssue } from '../types/output.js';
import { ARRAY_TRAILER_KEYS, ENUM_TRAILER_KEYS, LORE_ID_KEY } from '../util/constants.js';
import type { Protocol } from './protocol.js';

/**
 * Builds and validates git commit messages enriched with Lore decision context.
 *
 * SOLID: SRP -- responsible only for commit message construction.
 * SOLID: OCP -- fully metadata-driven; no hardcoded trailer names in construction.
 */
export class CommitBuilder {
  constructor(
    private readonly trailerParser: TrailerParser,
    private readonly loreIdGenerator: LoreIdGenerator,
    private readonly config: LoreConfig,
    private readonly protocol: Protocol,
  ) {}

  /**
   * Builds a full git commit message with subject, body, and Lore trailer block.
   */
  build(input: CommitInput, existingLoreId?: LoreId): string {
    const loreId = existingLoreId || this.loreIdGenerator.generate();
    const trailers = this.buildTrailers(loreId, input);
    const trailerBlock = this.trailerParser.serialize(trailers);

    let message = input.intent;
    if (input.body && input.body.trim()) {
      message += `\n\n${input.body.trim()}`;
    }
    message += `\n\n${trailerBlock}`;

    return message;
  }

  /**
   * Performs validation on the commit input.
   */
  validate(input: CommitInput): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // 1. Intent presence
    if (!input.intent.trim()) {
      issues.push({
        severity: 'error',
        rule: 'intent-required',
        message: 'Commit intent (subject line) is required',
      });
    }

    // 2. Intent length
    if (input.intent.length > this.config.validation.intentMaxLength) {
      issues.push({
        severity: 'warning',
        rule: 'intent-length',
        message: `Intent exceeds ${this.config.validation.intentMaxLength} characters (got ${input.intent.length})`,
      });
    }

    // 3. Metadata-driven schema validation
    if (input.trailers) {
      const authorizedKeys = this.protocol.getAuthorizedKeys();
      for (const key of authorizedKeys) {
        const def = this.protocol.getDefinition(key);
        if (!def) continue;

        const values = input.trailers[key];
        if (!values || values.length === 0) continue;

        if (def.validation === 'values' && def.values) {
          const allowedValues = Object.keys(def.values);
          for (const v of values) {
            if (!allowedValues.includes(v)) {
              issues.push({
                severity: 'error',
                rule: 'invalid-enum',
                field: key,
                message: `Invalid value for "${key}": "${v}". Expected one of: ${allowedValues.join(', ')}`,
              });
            }
          }
        } else if (def.validation === 'pattern' && def.pattern) {
          const regex = new RegExp(def.pattern);
          for (const v of values) {
            if (!regex.test(v)) {
              // Map pattern failures to specific rules for backward compatibility with tests
              let rule = 'invalid-format';
              if (def.ui?.kind === 'reference') {
                rule = 'invalid-lore-id-ref';
              }

              issues.push({
                severity: 'error',
                rule,
                field: key,
                message: `Value for "${key}" does not match pattern: ${def.pattern}`,
              });
            }
          }
        }
      }
    }

    // 4. Required trailers
    const requiredKeys = new Set(this.config.trailers.required);
    for (const key of requiredKeys) {
      if (!this.hasTrailer(input, key)) {
        issues.push({
          severity: this.config.validation.strict ? 'error' : 'warning',
          rule: 'required-trailer',
          field: key,
          message: `Required trailer "${key}" is missing`,
        });
      }
    }

    // 5. Total message line count
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

  /**
   * Dynamically constructs a LoreTrailers object from input metadata.
   */
  private buildTrailers(loreId: LoreId, input: CommitInput): LoreTrailers {
    // Start with a record that is strictly string[]
    const result: Record<string, string[]> = {
      [LORE_ID_KEY]: [loreId],
    };

    // Pre-initialize core keys for uniformity
    for (const key of ARRAY_TRAILER_KEYS) result[key] = [];
    for (const key of ENUM_TRAILER_KEYS) result[key] = [];

    if (input.trailers) {
      for (const [key, values] of Object.entries(input.trailers)) {
        if (key === LORE_ID_KEY) continue;
        if (values) {
          result[key] = [...values];
        }
      }
    }

    return result as unknown as LoreTrailers;
  }

  private hasTrailer(input: CommitInput, key: string): boolean {
    const val = input.trailers?.[key];
    return !!val && val.length > 0;
  }

  private estimateLineCount(input: CommitInput): number {
    let count = 1; // intent
    if (input.body) {
      count += 2; // blank line + body
      count += input.body.split('\n').length;
    }
    if (input.trailers) {
      count += 2; // blank line + LORE_ID_KEY
      for (const values of Object.values(input.trailers)) {
        if (values) {
          count += values.length;
        }
      }
    }
    return count;
  }
}
