import type { LoreAtom, TrailerKey } from '../types/domain.js';
import type { DiscoveryOptions } from '../types/query.js';
import { ARRAY_TRAILER_KEYS, ENUM_TRAILER_KEYS } from '../util/constants.js';

/**
 * Internal options for filtering that include pre-resolved absolute dates.
 */
export interface FilterOptions extends DiscoveryOptions {
  readonly sinceDate?: Date | null;
  readonly untilDate?: Date | null;
}

/**
 * Applies authoritative application-level filtering to a collection of LoreAtoms.
 *
 * GRASP: Information Expert -- knows how to match atoms against search criteria.
 * SRP: Only filtering logic, no git interaction or persistence.
 *
 * This service provides the "Authoritative Pass" in the Lore Discovery Mode
 * pipeline, ensuring absolute precision after Git's coarse --grep pass.
 */
export class SearchFilter {
  /**
   * Apply application-level filtering to the parsed atoms.
   *
   * Note: author, since, and until are also passed to git log (coarse filter)
   * in the AtomRepository, but this method provides the authoritative second
   * layer of filtering for absolute precision and Lore-specific semantics.
   */
  applyFilters(atoms: readonly LoreAtom[], options: FilterOptions): LoreAtom[] {
    let result = [...atoms];

    if (options.confidence !== null && options.confidence !== undefined) {
      result = result.filter((a) => a.trailers.Confidence === options.confidence);
    }

    if (options.scopeRisk !== null && options.scopeRisk !== undefined) {
      result = result.filter((a) => a.trailers['Scope-risk'] === options.scopeRisk);
    }

    if (options.reversibility !== null && options.reversibility !== undefined) {
      result = result.filter((a) => a.trailers.Reversibility === options.reversibility);
    }

    if (options.has !== null && options.has !== undefined) {
      result = result.filter((a) => this.atomHasTrailer(a, options.has!));
    }

    if (options.author !== null && options.author !== undefined) {
      // Authoritative pass: Git --author matches full "Name <email>"; Lore
      // atoms only store the email (%ae). This pass ensures consistency
      // with the Lore display.
      const authorLower = options.author.toLowerCase();
      result = result.filter((atom) => atom.author.toLowerCase().includes(authorLower));
    }

    if (options.scope !== null && options.scope !== undefined) {
      // Precise pass: Git --grep might match code snippets in the body.
      // This pass ensures we only match the actual intent line's scope.
      const scopeLower = options.scope.toLowerCase();
      result = result.filter((a) => {
        const extracted = this.extractScope(a.intent);
        return extracted !== null && extracted.toLowerCase() === scopeLower;
      });
    }

    if (options.sinceDate) {
      result = result.filter((atom) => atom.date >= options.sinceDate!);
    }

    if (options.untilDate) {
      result = result.filter((atom) => atom.date <= options.untilDate!);
    }

    if (options.text !== null && options.text !== undefined) {
      // Semantic pass: Git matches keywords anywhere. This pass precisely
      // checks context (intent, body, specific Lore trailers).
      const textLower = options.text.toLowerCase();
      result = result.filter((a) => this.atomMatchesText(a, textLower));
    }

    return result;
  }

  /**
   * Check if an atom has a non-empty value for the given trailer key.
   * Uses data-driven lookup via ARRAY_TRAILER_KEYS and ENUM_TRAILER_KEYS
   * instead of a per-key switch statement.
   */
  atomHasTrailer(atom: LoreAtom, trailerKey: TrailerKey): boolean {
    if (trailerKey === 'Lore-id') {
      return !!atom.trailers['Lore-id'];
    }

    // Array trailers: check length > 0
    if ((ARRAY_TRAILER_KEYS as readonly string[]).includes(trailerKey)) {
      const values = atom.trailers[trailerKey as (typeof ARRAY_TRAILER_KEYS)[number]];
      return values.length > 0;
    }

    // Enum trailers: check not null
    if ((ENUM_TRAILER_KEYS as readonly string[]).includes(trailerKey)) {
      const value = atom.trailers[trailerKey as keyof typeof atom.trailers];
      return value !== null;
    }

    return false;
  }

  /**
   * Check if an atom matches a text query across intent, body, and trailer values.
   */
  atomMatchesText(atom: LoreAtom, textLower: string): boolean {
    if (atom.intent.toLowerCase().includes(textLower)) return true;
    if (atom.body.toLowerCase().includes(textLower)) return true;

    const trailers = atom.trailers;

    // Check array trailers
    for (const key of ARRAY_TRAILER_KEYS) {
      const values = trailers[key] as readonly string[];
      for (const value of values) {
        if (value.toLowerCase().includes(textLower)) return true;
      }
    }

    // Check enum trailers
    for (const key of ENUM_TRAILER_KEYS) {
      const value = trailers[key];
      if (value?.toLowerCase().includes(textLower)) return true;
    }

    return false;
  }

  /**
   * Extract the scope from a conventional commit subject line.
   * Pattern: `type(scope): description`
   * Returns null if no scope is found.
   */
  private extractScope(subject: string): string | null {
    const match = subject.match(/^[a-zA-Z]+\(([^)]+)\)/);
    return match ? match[1] : null;
  }
}
