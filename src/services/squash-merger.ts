import type { LoreIdGenerator } from './lore-id-generator.js';
import type { LoreAtom, LoreId } from '../types/domain.js';
import type { Protocol } from './protocol.js';
import { LORE_ID_KEY } from '../util/constants.js';

/**
 * Orchestrates the merging of multiple Lore atoms during a git squash.
 * 
 * SOLID: SRP -- responsible only for combining atom data into a single message.
 * SOLID: OCP -- metadata-driven merging logic for all protocol trailers.
 * GRASP: Creator -- knows how to synthesize Lore context from multiple lineage atoms.
 */
export class SquashMerger {
  constructor(
    private readonly loreIdGenerator: LoreIdGenerator,
    private readonly protocol: Protocol,
  ) {}

  /**
   * Merge a collection of atoms into a single Lore-enriched commit message.
   *
   * Synthesizes a new atom by:
   * 1. Generating a new unique Lore-id.
   * 2. Picking the newest intent as the new subject (unless overridden).
   * 3. Concatenating all unique body summaries.
   * 4. Applying metadata-driven squash strategies (union, rank-min, rank-max)
   *    to merge trailers across all atoms.
   * 5. Dropping internal references (those pointing to atoms within the squash set).
   */
  merge(
    atoms: readonly LoreAtom[],
    options: { intent?: string; body?: string },
  ): string {
    if (atoms.length === 0) {
      throw new Error('Cannot merge zero atoms');
    }

    const newLoreId = this.loreIdGenerator.generate();
    const internalIds = new Set(atoms.map((a) => a.loreId));

    // Sort atoms by date ascending so the newest is last
    const sorted = [...atoms].sort(
      (a, b) => a.date.getTime() - b.date.getTime(),
    );
    const newest = sorted[sorted.length - 1];

    // Intent: use option or newest atom's intent
    const intent = options.intent ?? newest.intent;

    // Body: use option or concatenate body summaries
    const body = options.body ?? this.mergeBodySummaries(sorted);

    const trailerLines: string[] = [];
    trailerLines.push(`${LORE_ID_KEY}: ${newLoreId}`);

    // 1. Process All Trailers uniformly
    // Flatten all present keys across all atoms
    const allKeys = new Set<string>();
    for (const atom of atoms) {
      for (const key of Object.keys(atom.trailers)) {
        if (key !== LORE_ID_KEY) { 
          allKeys.add(key);
        }
      }
    }

    const sortedKeys = Array.from(allKeys).sort((a, b) => {
      const defA = this.protocol.getDefinition(a);
      const defB = this.protocol.getDefinition(b);
      const orderA = defA?.prompt?.order ?? 1000;
      const orderB = defB?.prompt?.order ?? 1000;
      return orderA - orderB;
    });

    for (const key of sortedKeys) {
      const def = this.protocol.getDefinition(key);
      const strategy = def?.squash || 'union';
      
      // Values are always arrays in the new flat structure
      const allValues = atoms.map(a => a.trailers[key] || []);

      if (strategy === 'rank-min' && def?.values) {
        const valueKeys = Object.keys(def.values);
        const scalars = allValues.map(v => v[0] || null);
        const merged = this.pickMinRank(scalars, valueKeys);
        if (merged !== null) trailerLines.push(`${key}: ${merged}`);
      } else if (strategy === 'rank-max' && def?.values) {
        const valueKeys = Object.keys(def.values);
        const scalars = allValues.map(v => v[0] || null);
        const merged = this.pickMaxRank(scalars, valueKeys);
        if (merged !== null) trailerLines.push(`${key}: ${merged}`);
      } else {
        // Default: Union + Dedup
        let merged = this.unionDedup(allValues);
        
        if (def?.ui?.kind === 'reference') {
          merged = this.filterExternal(merged, internalIds);
        }

        for (const v of merged) {
          trailerLines.push(`${key}: ${v}`);
        }
      }
    }

    // Assemble message
    const parts: string[] = [intent];

    if (body) {
      parts.push('');
      parts.push(body);
    }

    parts.push('');
    parts.push(trailerLines.join('\n'));

    return parts.join('\n');
  }

  /**
   * Combine body summaries from multiple atoms into a single narrative block.
   */
  private mergeBodySummaries(sortedAtoms: readonly LoreAtom[]): string {
    const summaries: string[] = [];
    for (const atom of sortedAtoms) {
      if (atom.body.trim()) {
        summaries.push(atom.body.trim());
      }
    }
    return summaries.join('\n\n');
  }

  /**
   * Deduplicate and merge multiple trailer value arrays into one.
   */
  private unionDedup(arrays: readonly (readonly string[])[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const arr of arrays) {
      for (const item of arr) {
        if (!seen.has(item)) {
          seen.add(item);
          result.push(item);
        }
      }
    }
    return result;
  }

  /**
   * Remove internal references to atoms that are being merged into the same squash.
   */
  private filterExternal(
    values: string[],
    internalIds: Set<LoreId>,
  ): string[] {
    return values.filter((v) => !internalIds.has(v));
  }

  /**
   * Pick the value with the lowest index in the order.
   */
  private pickMinRank<T extends string>(
    values: readonly (T | null)[],
    order: readonly T[],
  ): T | null {
    let lowestIndex = -1;
    let result: T | null = null;

    for (const val of values) {
      if (val === null || val === undefined) continue;
      const idx = order.indexOf(val);
      if (idx === -1) continue;
      if (result === null || idx < lowestIndex) {
        lowestIndex = idx;
        result = val;
      }
    }

    return result;
  }

  /**
   * Pick the value with the highest index in the order.
   */
  private pickMaxRank<T extends string>(
    values: readonly (T | null)[],
    order: readonly T[],
  ): T | null {
    let highestIndex = -1;
    let result: T | null = null;

    for (const val of values) {
      if (val === null || val === undefined) continue;
      const idx = order.indexOf(val);
      if (idx === -1) continue;
      if (result === null || idx > highestIndex) {
        highestIndex = idx;
        result = val;
      }
    }

    return result;
  }
}
