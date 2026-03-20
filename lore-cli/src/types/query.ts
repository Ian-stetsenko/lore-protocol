import type { LoreAtom, ConfidenceLevel, ScopeRiskLevel, ReversibilityLevel, TrailerKey } from './domain.js';

export type TargetType = 'file' | 'line-range' | 'directory' | 'glob';

export interface QueryTarget {
  readonly raw: string;
  readonly type: TargetType;
  readonly filePath: string;
  readonly lineStart: number | null;
  readonly lineEnd: number | null;
}

export interface PathQueryOptions {
  readonly scope: string | null;
  readonly follow: boolean;
  readonly all: boolean;
  readonly author: string | null;
  readonly limit: number | null;
  readonly since: string | null;
}

export interface SearchOptions {
  readonly confidence: ConfidenceLevel | null;
  readonly scopeRisk: ScopeRiskLevel | null;
  readonly reversibility: ReversibilityLevel | null;
  readonly has: TrailerKey | null;
  readonly author: string | null;
  readonly scope: string | null;
  readonly text: string | null;
  readonly since: string | null;
  readonly until: string | null;
  readonly limit: number | null;
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
