/** 8-character hex string identifying a Lore atom. */
export type LoreId = string;

/** The set of recognized trailer keys. */
export type TrailerKey =
  | 'Lore-id'
  | 'Constraint'
  | 'Rejected'
  | 'Confidence'
  | 'Scope-risk'
  | 'Reversibility'
  | 'Directive'
  | 'Tested'
  | 'Not-tested'
  | 'Supersedes'
  | 'Depends-on'
  | 'Related';

/** Trailers that accept multiple values (arrays). */
export type ArrayTrailerKey =
  | 'Constraint'
  | 'Rejected'
  | 'Directive'
  | 'Tested'
  | 'Not-tested'
  | 'Supersedes'
  | 'Depends-on'
  | 'Related';

/** Trailers that accept a single enum value. */
export type EnumTrailerKey = 'Confidence' | 'Scope-risk' | 'Reversibility';

export type ConfidenceLevel = 'low' | 'medium' | 'high';
export type ScopeRiskLevel = 'narrow' | 'moderate' | 'wide';
export type ReversibilityLevel = 'clean' | 'migration-needed' | 'irreversible';

export interface LoreTrailers {
  readonly 'Lore-id': LoreId;
  readonly Constraint: readonly string[];
  readonly Rejected: readonly string[];
  readonly Confidence: ConfidenceLevel | null;
  readonly 'Scope-risk': ScopeRiskLevel | null;
  readonly Reversibility: ReversibilityLevel | null;
  readonly Directive: readonly string[];
  readonly Tested: readonly string[];
  readonly 'Not-tested': readonly string[];
  readonly Supersedes: readonly LoreId[];
  readonly 'Depends-on': readonly LoreId[];
  readonly Related: readonly LoreId[];
  readonly custom: ReadonlyMap<string, readonly string[]>;
}

export interface LoreAtom {
  readonly loreId: LoreId;
  readonly commitHash: string;
  readonly date: Date;
  readonly author: string;
  readonly intent: string;
  readonly body: string;
  readonly trailers: LoreTrailers;
  readonly filesChanged: readonly string[];
}

export interface SupersessionStatus {
  readonly superseded: boolean;
  readonly supersededBy: LoreId | null;
}
