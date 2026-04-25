import type { LoreAtom } from '../../types/domain.js';
import type { QueryMeta } from '../../types/query.js';

/**
 * Build QueryMeta from a set of atoms.
 *
 * @param totalAtoms - Count before any result-level limiting (e.g., --limit)
 * @param displayAtoms - The atoms that will actually be shown to the user
 */
export function buildQueryMeta(totalAtoms: number, displayAtoms: readonly LoreAtom[]): QueryMeta {
  return {
    totalAtoms,
    filteredAtoms: displayAtoms.length,
    oldest: displayAtoms.length > 0
      ? new Date(Math.min(...displayAtoms.map((a) => a.date.getTime())))
      : null,
    newest: displayAtoms.length > 0
      ? new Date(Math.max(...displayAtoms.map((a) => a.date.getTime())))
      : null,
  };
}
