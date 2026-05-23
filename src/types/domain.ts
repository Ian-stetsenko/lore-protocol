import { CORE_TRAILER_DEFINITIONS, STALE_SIGNALS } from '../util/core-definitions.js';

/** 8-character hex string identifying a Lore atom. */
export type LoreId = string;

/** The set of recognized trailer keys. */
export type TrailerKey = keyof typeof CORE_TRAILER_DEFINITIONS;

/** Trailers that accept multiple values (arrays). */
export type ArrayTrailerKey = {
  [K in TrailerKey]: (typeof CORE_TRAILER_DEFINITIONS)[K]['multivalue'] extends true ? K : never;
}[TrailerKey];

/** Trailers that accept a single enum value. */
export type EnumTrailerKey = {
  [K in TrailerKey]: (typeof CORE_TRAILER_DEFINITIONS)[K]['multivalue'] extends false
    ? (typeof CORE_TRAILER_DEFINITIONS)[K]['validation'] extends 'values'
      ? K
      : never
    : never;
}[TrailerKey];

export type ConfidenceLevel = keyof NonNullable<typeof CORE_TRAILER_DEFINITIONS.Confidence['values']>;
export type ScopeRiskLevel = keyof NonNullable<typeof CORE_TRAILER_DEFINITIONS['Scope-risk']['values']>;
export type ReversibilityLevel = keyof NonNullable<typeof CORE_TRAILER_DEFINITIONS.Reversibility['values']>;

/**
 * The structured trailer collection for a Lore atom.
 * Strictly flat and uniform: every key maps to a readonly string array.
 */
export type LoreTrailers = Record<string, readonly string[]>;

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

/** The set of signals that indicate an atom may be stale. */
export type StaleSignal = (typeof STALE_SIGNALS)[number];
