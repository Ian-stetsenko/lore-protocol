import type { LoreAtom, SupersessionStatus, TrailerKey } from './domain.js';
import type { QueryResult } from './query.js';

export interface FormattableQueryResult {
  readonly result: QueryResult;
  readonly supersessionMap: ReadonlyMap<string, SupersessionStatus>;
  readonly visibleTrailers: readonly TrailerKey[] | 'all';
}

export interface FormattableValidationResult {
  readonly valid: boolean;
  readonly summary: { errors: number; warnings: number; commitsChecked: number };
  readonly results: readonly CommitValidationResult[];
}

export interface CommitValidationResult {
  readonly commit: string;
  readonly loreId: string | null;
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

export interface ValidationIssue {
  readonly severity: 'error' | 'warning';
  readonly rule: string;
  readonly message: string;
}

export interface FormattableStalenessResult {
  readonly atoms: readonly StaleAtomReport[];
}

import type { StaleSignal } from '../util/constants.js';

export interface StaleReason {
  readonly signal: StaleSignal;
  readonly description: string;
}

export interface StaleAtomReport {
  readonly atom: LoreAtom;
  readonly reasons: readonly StaleReason[];
}

export interface FormattableTraceResult {
  readonly root: LoreAtom;
  readonly edges: readonly TraceEdge[];
}

export interface TraceEdge {
  readonly from: string;
  readonly to: string;
  readonly relationship: 'Related' | 'Supersedes' | 'Depends-on';
  readonly targetAtom: LoreAtom | null;
}

export interface FormattableDoctorResult {
  readonly checks: readonly DoctorCheck[];
  readonly summary: { errors: number; warnings: number; info: number };
}

export interface DoctorCheck {
  readonly name: string;
  readonly status: 'ok' | 'error' | 'warning' | 'info';
  readonly message: string;
  readonly details: readonly string[];
}
