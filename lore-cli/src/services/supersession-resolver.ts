import type { LoreAtom, LoreId, SupersessionStatus } from '../types/domain.js';
import { LORE_ID_PATTERN } from '../util/constants.js';

/**
 * Computes supersession chains and determines which atoms are active vs. superseded.
 *
 * GRASP: Information Expert -- the data it needs (Supersedes trailers) lives in atoms.
 * SRP: Only supersession logic, no git interaction or formatting.
 */
export class SupersessionResolver {
  /**
   * Given a set of atoms, compute which are superseded and by whom.
   * Returns a map from LoreId to SupersessionStatus.
   *
   * Logic: iterate all atoms. For each atom that has `Supersedes` trailers,
   * mark the referenced atoms as superseded (supersededBy = this atom's loreId).
   * Handle transitive chains: if A supersedes B and B supersedes C,
   * both B and C are superseded.
   */
  resolve(atoms: readonly LoreAtom[]): Map<string, SupersessionStatus> {
    const statusMap = new Map<string, SupersessionStatus>();

    // Initialize all atoms as not superseded
    for (const atom of atoms) {
      statusMap.set(atom.loreId, {
        superseded: false,
        supersededBy: null,
      });
    }

    // Build a lookup map for quick access
    const atomById = new Map<string, LoreAtom>();
    for (const atom of atoms) {
      atomById.set(atom.loreId, atom);
    }

    // First pass: mark direct supersessions
    for (const atom of atoms) {
      for (const supersededId of atom.trailers.Supersedes) {
        if (!LORE_ID_PATTERN.test(supersededId)) {
          continue;
        }

        if (statusMap.has(supersededId)) {
          statusMap.set(supersededId, {
            superseded: true,
            supersededBy: atom.loreId,
          });
        }
      }
    }

    // Second pass: resolve transitive chains
    // If A supersedes B and B supersedes C, then C is also superseded.
    // We walk the chain from each superseding atom downward.
    this.resolveTransitiveChains(atoms, atomById, statusMap);

    return statusMap;
  }

  /**
   * Filter atoms to only those that are active (not superseded).
   */
  filterActive(
    atoms: readonly LoreAtom[],
    supersessionMap: Map<string, SupersessionStatus>,
  ): LoreAtom[] {
    return atoms.filter((atom) => {
      const status = supersessionMap.get(atom.loreId);
      return status === undefined || !status.superseded;
    });
  }

  /**
   * Resolve transitive supersession chains.
   *
   * For each atom that supersedes others, follow the chain of what those
   * superseded atoms themselves supersede, marking everything along the way.
   * Uses a visited set to handle circular references safely.
   */
  private resolveTransitiveChains(
    atoms: readonly LoreAtom[],
    atomById: Map<string, LoreAtom>,
    statusMap: Map<string, SupersessionStatus>,
  ): void {
    for (const atom of atoms) {
      if (atom.trailers.Supersedes.length === 0) {
        continue;
      }

      // For each atom that does superseding, walk the chain of what
      // the superseded atoms themselves supersede
      const visited = new Set<string>();
      visited.add(atom.loreId);

      const queue: LoreId[] = [...atom.trailers.Supersedes];

      while (queue.length > 0) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) {
          continue;
        }
        visited.add(currentId);

        if (!LORE_ID_PATTERN.test(currentId)) {
          continue;
        }

        // Mark as superseded if it exists in our atom set
        if (statusMap.has(currentId)) {
          const currentStatus = statusMap.get(currentId)!;
          // Only update if not already marked superseded (preserve first superseder)
          if (!currentStatus.superseded) {
            statusMap.set(currentId, {
              superseded: true,
              supersededBy: atom.loreId,
            });
          }
        }

        // Follow the chain: what does this superseded atom itself supersede?
        const supersededAtom = atomById.get(currentId);
        if (supersededAtom) {
          for (const nextId of supersededAtom.trailers.Supersedes) {
            if (!visited.has(nextId)) {
              queue.push(nextId);
            }
          }
        }
      }
    }
  }
}
