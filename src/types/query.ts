import type { LoreAtom, ConfidenceLevel, ScopeRiskLevel, ReversibilityLevel, TrailerKey } from './domain.js';

export type TargetType = 'file' | 'line-range' | 'directory' | 'glob';

export interface QueryTarget {
  readonly raw: string;
  readonly type: TargetType;
  readonly filePath: string;
  readonly lineStart: number | null;
  readonly lineEnd: number | null;
}

export interface DiscoveryOptions {
  /** Filter by conventional commit scope. */
  readonly scope?: string | null;
  /** Filter by author email (partial match supported). */
  readonly author?: string | null;
  /** Filter by presence of a specific trailer key. */
  readonly has?: TrailerKey | null;
  /** Filter by confidence level. */
  readonly confidence?: ConfidenceLevel | null;
  /** Filter by scope-risk level. */
  readonly scopeRisk?: ScopeRiskLevel | null;
  /** Filter by reversibility level. */
  readonly reversibility?: ReversibilityLevel | null;
  /** Full-text search across intent, body, and trailer values. */
  readonly text?: string | null;
  readonly since?: string | null;
  readonly until?: string | null;
  readonly maxCommits?: number | null;
}

/**
 * Unified options for any Lore query (path-based or search-based).
 */
export interface QueryOptions extends DiscoveryOptions {
  /** Result-level cap applied by the command layer (after querying). */
  readonly limit?: number | null;

  /** Include superseded entries in the result. */
  readonly includeSuperseded?: boolean;

  /** Transitively follow Related/Supersedes/Depends-on links (Path queries only). */
  readonly followLinks?: boolean;
}

export interface QueryResult {
  readonly command: string;
  readonly target: string;
  readonly targetType: TargetType | 'search' | 'global';
  readonly atoms: readonly LoreAtom[];
  readonly meta: QueryMeta;
}

export interface QueryMeta {
  readonly totalAtoms: number;
  readonly filteredAtoms: number;
  readonly oldest: Date | null;
  readonly newest: Date | null;
}
