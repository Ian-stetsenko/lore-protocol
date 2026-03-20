import type { LoreAtom, TrailerKey } from '../types/domain.js';
import type { SearchOptions } from '../types/query.js';
import { ARRAY_TRAILER_KEYS, ENUM_TRAILER_KEYS } from '../util/constants.js';

/**
 * Applies search filters to a collection of LoreAtoms.
 *
 * GRASP: Information Expert -- knows how to match atoms against search criteria.
 * SRP: Only filtering logic, no git interaction or formatting.
 */
export class SearchFilter {
  /**
   * Apply all active search filters to the atom list.
   */
  applyFilters(atoms: readonly LoreAtom[], options: SearchOptions): LoreAtom[] {
    let result = [...atoms];

    if (options.confidence !== null) {
      result = result.filter((a) => a.trailers.Confidence === options.confidence);
    }

    if (options.scopeRisk !== null) {
      result = result.filter((a) => a.trailers['Scope-risk'] === options.scopeRisk);
    }

    if (options.reversibility !== null) {
      result = result.filter((a) => a.trailers.Reversibility === options.reversibility);
    }

    if (options.has !== null) {
      const trailerKey = options.has;
      result = result.filter((a) => this.atomHasTrailer(a, trailerKey));
    }

    if (options.author !== null) {
      const authorLower = options.author.toLowerCase();
      result = result.filter((a) => a.author.toLowerCase().includes(authorLower));
    }

    if (options.scope !== null) {
      const scope = options.scope.toLowerCase();
      result = result.filter((a) => {
        const match = a.intent.match(/^[a-zA-Z]+\(([^)]+)\)/);
        return match !== null && match[1].toLowerCase() === scope;
      });
    }

    if (options.text !== null) {
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
      const values = atom.trailers[trailerKey as keyof typeof atom.trailers];
      return Array.isArray(values) ? values.length > 0 : (values as readonly string[]).length > 0;
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
      for (const value of trailers[key]) {
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
}
