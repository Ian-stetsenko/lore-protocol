import type { LoreAtom } from '../../types/domain.js';
import type { QueryMeta } from '../../types/query.js';

/**
 * Build QueryMeta from a set of atoms.
 *
 * @param totalAtoms - Count before any result-level limiting (e.g., --limit)
 * @param displayAtoms - The atoms that will actually be shown to the user
 */
export function buildQueryMeta(totalAtoms: number, displayAtoms: readonly LoreAtom[]): QueryMeta {
  if (displayAtoms.length === 0) {
    return { totalAtoms, filteredAtoms: 0, oldest: null, newest: null };
  }

  // Use reduce instead of Math.min/max spread to avoid call-stack overflow on large arrays
  const { min, max } = displayAtoms.reduce(
    (acc, a) => {
      const t = a.date.getTime();
      return { min: t < acc.min ? t : acc.min, max: t > acc.max ? t : acc.max };
    },
    { min: Infinity, max: -Infinity },
  );

  return {
    totalAtoms,
    filteredAtoms: displayAtoms.length,
    oldest: new Date(min),
    newest: new Date(max),
  };
}
