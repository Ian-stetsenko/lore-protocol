import type {
  LoreTrailers,
  LoreId,
  TrailerKey,
  ArrayTrailerKey,
  EnumTrailerKey,
  ConfidenceLevel,
  ScopeRiskLevel,
  ReversibilityLevel,
} from '../types/domain.js';
import {
  LORE_TRAILER_KEYS,
  ARRAY_TRAILER_KEYS,
  ENUM_TRAILER_KEYS,
  CONFIDENCE_VALUES,
  SCOPE_RISK_VALUES,
  REVERSIBILITY_VALUES,
} from '../util/constants.js';

const TRAILER_LINE_PATTERN = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/;
const CONTINUATION_LINE_PATTERN = /^[ \t]+(.*)$/;

/**
 * Parses raw trailer text into structured LoreTrailers and serializes back.
 *
 * GRASP: Information Expert -- knows trailer format rules.
 * SRP: Only parsing/serialization logic. No git interaction, no validation.
 */
export class TrailerParser {
  /**
   * Parse a raw trailer block (multi-line string) into LoreTrailers.
   * Lines in `Key: Value` format are parsed as trailers.
   * Lines starting with whitespace are continuation lines appended to the
   * previous trailer's value.
   *
   * Array trailers (Constraint, Rejected, etc.) can appear multiple times
   * and their values are collected into arrays.
   * Enum trailers (Confidence, Scope-risk, Reversibility) appear once with
   * a known value.
   * Lore-id is a special single-value trailer.
   * Unrecognized keys that appear in customKeys go into the `custom` map.
   */
  parse(rawTrailers: string, customKeys: readonly string[] = []): LoreTrailers {
    const lines = rawTrailers.split('\n');
    const entries = this.parseLinesToEntries(lines);

    const arrayTrailerKeySet = new Set<string>(ARRAY_TRAILER_KEYS);
    const enumTrailerKeySet = new Set<string>(ENUM_TRAILER_KEYS);
    const loreKeySet = new Set<string>(LORE_TRAILER_KEYS);
    const customKeySet = new Set<string>(customKeys);

    let loreId: LoreId = '';
    const arrays: Record<string, string[]> = {};
    for (const key of ARRAY_TRAILER_KEYS) {
      arrays[key] = [];
    }
    const enums: Record<string, string | null> = {};
    for (const key of ENUM_TRAILER_KEYS) {
      enums[key] = null;
    }
    const custom = new Map<string, string[]>();

    for (const { key, value } of entries) {
      if (key === 'Lore-id') {
        loreId = value.trim();
        continue;
      }

      if (arrayTrailerKeySet.has(key)) {
        arrays[key].push(value.trim());
        continue;
      }

      if (enumTrailerKeySet.has(key)) {
        const trimmed = value.trim();
        if (this.isValidEnumValue(key as EnumTrailerKey, trimmed)) {
          enums[key] = trimmed;
        }
        continue;
      }

      if (!loreKeySet.has(key as TrailerKey)) {
        if (customKeySet.has(key) || customKeys.length === 0) {
          const existing = custom.get(key) ?? [];
          existing.push(value.trim());
          custom.set(key, existing);
        }
      }
    }

    return {
      'Lore-id': loreId,
      Constraint: arrays['Constraint'],
      Rejected: arrays['Rejected'],
      Confidence: (enums['Confidence'] as ConfidenceLevel) ?? null,
      'Scope-risk': (enums['Scope-risk'] as ScopeRiskLevel) ?? null,
      Reversibility: (enums['Reversibility'] as ReversibilityLevel) ?? null,
      Directive: arrays['Directive'],
      Tested: arrays['Tested'],
      'Not-tested': arrays['Not-tested'],
      Supersedes: arrays['Supersedes'],
      'Depends-on': arrays['Depends-on'],
      Related: arrays['Related'],
      custom,
    };
  }

  /**
   * Serialize LoreTrailers back into git trailer format (multi-line string).
   * Order: Lore-id first, then array trailers, then enum trailers, then custom.
   * Each trailer appears as `Key: Value`, one per line.
   * Array trailers with multiple values produce multiple lines.
   */
  serialize(trailers: LoreTrailers): string {
    const lines: string[] = [];

    if (trailers['Lore-id']) {
      lines.push(`Lore-id: ${trailers['Lore-id']}`);
    }

    for (const key of ARRAY_TRAILER_KEYS) {
      const values = trailers[key as keyof LoreTrailers] as readonly string[];
      for (const value of values) {
        lines.push(`${key}: ${value}`);
      }
    }

    for (const key of ENUM_TRAILER_KEYS) {
      const value = trailers[key as keyof LoreTrailers] as string | null;
      if (value !== null) {
        lines.push(`${key}: ${value}`);
      }
    }

    for (const [key, values] of trailers.custom) {
      for (const value of values) {
        lines.push(`${key}: ${value}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Check if a string contains any Lore trailers.
   * Returns true if any line matches a known Lore trailer key.
   */
  containsLoreTrailers(text: string): boolean {
    const lines = text.split('\n');
    for (const line of lines) {
      const match = TRAILER_LINE_PATTERN.exec(line);
      if (match) {
        const key = match[1];
        if (LORE_TRAILER_KEYS.includes(key as TrailerKey)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Extract the trailer block from a full commit message.
   * The trailer block is the last paragraph of the message -- separated from
   * the body by a blank line and containing at least one `Key: Value` line.
   */
  extractTrailerBlock(fullMessage: string): string {
    const trimmed = fullMessage.trimEnd();
    if (!trimmed) {
      return '';
    }

    // Split into paragraphs by blank lines
    const paragraphs = trimmed.split(/\n\n+/);
    if (paragraphs.length === 0) {
      return '';
    }

    // The trailer block is the last paragraph, if it contains trailers
    const lastParagraph = paragraphs[paragraphs.length - 1];
    const lines = lastParagraph.split('\n');

    // Check if this paragraph has at least one trailer line
    let hasTrailerLine = false;
    for (const line of lines) {
      if (TRAILER_LINE_PATTERN.test(line)) {
        hasTrailerLine = true;
        break;
      }
    }

    if (!hasTrailerLine) {
      return '';
    }

    // Verify all lines are either trailer lines or continuation lines
    for (const line of lines) {
      if (!TRAILER_LINE_PATTERN.test(line) && !CONTINUATION_LINE_PATTERN.test(line) && line.trim() !== '') {
        return '';
      }
    }

    return lastParagraph;
  }

  /**
   * Parse lines into key-value entries, handling continuation lines.
   * A continuation line (starting with whitespace) appends to the
   * previous trailer's value with a space separator.
   */
  private parseLinesToEntries(lines: string[]): readonly { key: string; value: string }[] {
    const entries: { key: string; value: string }[] = [];

    for (const line of lines) {
      // Skip empty lines
      if (line.trim() === '') {
        continue;
      }

      // Check for continuation line first
      const continuationMatch = CONTINUATION_LINE_PATTERN.exec(line);
      if (continuationMatch && entries.length > 0) {
        const lastEntry = entries[entries.length - 1];
        lastEntry.value = `${lastEntry.value} ${continuationMatch[1]}`;
        continue;
      }

      // Check for trailer line
      const trailerMatch = TRAILER_LINE_PATTERN.exec(line);
      if (trailerMatch) {
        entries.push({ key: trailerMatch[1], value: trailerMatch[2] });
      }
    }

    return entries;
  }

  private static readonly ENUM_VALUE_LOOKUP: Record<EnumTrailerKey, ReadonlySet<string>> = {
    'Confidence': new Set<string>(CONFIDENCE_VALUES),
    'Scope-risk': new Set<string>(SCOPE_RISK_VALUES),
    'Reversibility': new Set<string>(REVERSIBILITY_VALUES),
  };

  private isValidEnumValue(key: EnumTrailerKey, value: string): boolean {
    const validValues = TrailerParser.ENUM_VALUE_LOOKUP[key];
    return validValues !== undefined && validValues.has(value);
  }
}
