import type { LoreIdGenerator } from './lore-id-generator.js';
import type { LoreAtom, ConfidenceLevel, ScopeRiskLevel, ReversibilityLevel, LoreId } from '../types/domain.js';

const CONFIDENCE_ORDER: readonly ConfidenceLevel[] = ['low', 'medium', 'high'];
const SCOPE_RISK_ORDER: readonly ScopeRiskLevel[] = ['narrow', 'moderate', 'wide'];
const REVERSIBILITY_ORDER: readonly ReversibilityLevel[] = ['clean', 'migration-needed', 'irreversible'];

export class SquashMerger {
  private readonly loreIdGenerator: LoreIdGenerator;

  constructor(loreIdGenerator: LoreIdGenerator) {
    this.loreIdGenerator = loreIdGenerator;
  }

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

    // Merge array trailers (deduplicated)
    const constraints = this.unionDedup(atoms.map((a) => a.trailers.Constraint));
    const rejected = this.unionDedup(atoms.map((a) => a.trailers.Rejected));
    const directives = this.unionDedup(atoms.map((a) => a.trailers.Directive));
    const tested = this.unionDedup(atoms.map((a) => a.trailers.Tested));
    const notTested = this.unionDedup(atoms.map((a) => a.trailers['Not-tested']));

    // Merge reference trailers: keep only external references
    const supersedes = this.filterExternal(
      this.unionDedup(atoms.map((a) => a.trailers.Supersedes)),
      internalIds,
    );
    const dependsOn = this.filterExternal(
      this.unionDedup(atoms.map((a) => a.trailers['Depends-on'])),
      internalIds,
    );
    const related = this.filterExternal(
      this.unionDedup(atoms.map((a) => a.trailers.Related)),
      internalIds,
    );

    // Merge enum trailers: most conservative
    const confidence = this.mergeConfidence(atoms);
    const scopeRisk = this.mergeScopeRisk(atoms);
    const reversibility = this.mergeReversibility(atoms);

    // Build trailer lines
    const trailerLines: string[] = [];
    trailerLines.push(`Lore-id: ${newLoreId}`);

    for (const v of constraints) {
      trailerLines.push(`Constraint: ${v}`);
    }
    for (const v of rejected) {
      trailerLines.push(`Rejected: ${v}`);
    }
    if (confidence !== null) {
      trailerLines.push(`Confidence: ${confidence}`);
    }
    if (scopeRisk !== null) {
      trailerLines.push(`Scope-risk: ${scopeRisk}`);
    }
    if (reversibility !== null) {
      trailerLines.push(`Reversibility: ${reversibility}`);
    }
    for (const v of directives) {
      trailerLines.push(`Directive: ${v}`);
    }
    for (const v of tested) {
      trailerLines.push(`Tested: ${v}`);
    }
    for (const v of notTested) {
      trailerLines.push(`Not-tested: ${v}`);
    }
    for (const v of supersedes) {
      trailerLines.push(`Supersedes: ${v}`);
    }
    for (const v of dependsOn) {
      trailerLines.push(`Depends-on: ${v}`);
    }
    for (const v of related) {
      trailerLines.push(`Related: ${v}`);
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

  private mergeBodySummaries(sortedAtoms: readonly LoreAtom[]): string {
    const summaries: string[] = [];
    for (const atom of sortedAtoms) {
      if (atom.body.trim()) {
        summaries.push(atom.body.trim());
      }
    }
    return summaries.join('\n\n');
  }

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

  private filterExternal(
    values: string[],
    internalIds: Set<LoreId>,
  ): string[] {
    return values.filter((v) => !internalIds.has(v));
  }

  private mergeConfidence(
    atoms: readonly LoreAtom[],
  ): ConfidenceLevel | null {
    return this.pickMostConservative(
      atoms.map((a) => a.trailers.Confidence),
      CONFIDENCE_ORDER,
    );
  }

  private mergeScopeRisk(
    atoms: readonly LoreAtom[],
  ): ScopeRiskLevel | null {
    return this.pickLeastConservative(
      atoms.map((a) => a.trailers['Scope-risk']),
      SCOPE_RISK_ORDER,
    );
  }

  private mergeReversibility(
    atoms: readonly LoreAtom[],
  ): ReversibilityLevel | null {
    return this.pickLeastConservative(
      atoms.map((a) => a.trailers.Reversibility),
      REVERSIBILITY_ORDER,
    );
  }

  /**
   * Pick the lowest value in the order (most conservative / least confident).
   * For Confidence: low < medium < high, so pick lowest index.
   */
  private pickMostConservative<T extends string>(
    values: readonly (T | null)[],
    order: readonly T[],
  ): T | null {
    let lowestIndex = -1;
    let result: T | null = null;

    for (const val of values) {
      if (val === null) continue;
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
   * Pick the highest value in the order (least conservative / widest scope).
   * For Scope-risk: narrow < moderate < wide, so pick highest index.
   * For Reversibility: clean < migration-needed < irreversible, so pick highest index.
   */
  private pickLeastConservative<T extends string>(
    values: readonly (T | null)[],
    order: readonly T[],
  ): T | null {
    let highestIndex = -1;
    let result: T | null = null;

    for (const val of values) {
      if (val === null) continue;
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
