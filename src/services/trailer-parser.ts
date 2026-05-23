import type {
  LoreTrailers,
  TrailerKey,
} from '../types/domain.js';
import {
  ARRAY_TRAILER_KEYS,
  ENUM_TRAILER_KEYS,
  LORE_ID_KEY,
} from '../util/constants.js';
import type { Protocol } from './protocol.js';

const TRAILER_LINE_PATTERN = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/;
const CONTINUATION_LINE_PATTERN = /^[ \t]+(.*)$/;

/**
 * Parses raw trailer text into structured LoreTrailers and serializes back.
 *
 * GRASP: Information Expert -- knows trailer format rules.
 * SRP: Only parsing/serialization logic. No git interaction, no validation.
 * SOLID: OCP -- fully metadata-driven; no hardcoded trailer names.
 */
export class TrailerParser {
  constructor(private readonly protocol?: Protocol) {}

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
   * All values are stored internally as string arrays for uniformity.
   */
  parse(rawTrailers: string): LoreTrailers {
    const lines = rawTrailers.split('\n');
    const entries = this.parseLinesToEntries(lines);

    const result: Record<string, string[]> = {};

    // Initialize core arrays and enums with empty arrays for uniformity
    for (const key of ARRAY_TRAILER_KEYS) {
      result[key] = [];
    }
    for (const key of ENUM_TRAILER_KEYS) {
      result[key] = [];
    }
    result[LORE_ID_KEY] = [];

    for (const { key, value } of entries) {
      const trimmedValue = value.trim();

      // Authorize the key via the protocol engine
      // If no engine is provided (fallback), we use permissive defaults.
      const authorizedKey = this.protocol ? this.protocol.authorize(key) : (key as TrailerKey);
      if (!authorizedKey) {
        continue;
      }

      // Special handling for enums: validate value if possible
      const def = this.protocol?.getDefinition(key);
      if (def?.validation === 'values' && def.values) {
        const validValues = Object.keys(def.values);
        if (validValues.includes(trimmedValue)) {
          result[authorizedKey] = [trimmedValue];
        }
        continue;
      }

      // Default: Always store as array
      const existing = result[authorizedKey] ?? [];
      existing.push(trimmedValue);
      result[authorizedKey] = existing;
    }

    return result as unknown as LoreTrailers;
  }

  /**
   * Serialize LoreTrailers back into git trailer format (multi-line string).
   * Order: Lore-id first, then other trailers in protocol-defined order.
   * Each trailer appears as `Key: Value`, one per line.
   * Array trailers with multiple values produce multiple lines.
   */
  serialize(trailers: LoreTrailers): string {
    const lines: string[] = [];
    const processed = new Set<string>();

    // 1. Lore-id always first
    const loreIdValues = trailers[LORE_ID_KEY];
    if (loreIdValues && loreIdValues.length > 0) {
      lines.push(`${LORE_ID_KEY}: ${loreIdValues[0]}`);
      processed.add(LORE_ID_KEY);
    }

    // 2. All other trailers
    // Use protocol authorized keys for canonical order, then add any remaining
    const authorizedKeys = this.protocol ? this.protocol.getAuthorizedKeys() : [];
    const allKeys = Array.from(new Set([...authorizedKeys, ...Object.keys(trailers)]));

    for (const key of allKeys) {
      if (processed.has(key)) {
        continue;
      }
      processed.add(key);

      const values = trailers[key];
      if (!values || values.length === 0) {
        continue;
      }

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
        const authorized = this.protocol ? this.protocol.authorize(key) : (key as TrailerKey);
        if (authorized) {
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
}
