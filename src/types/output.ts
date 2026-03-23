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

export interface FormattableMetricsResult {
  readonly period: MetricsPeriod;
  readonly adoption: AdoptionMetrics;
  readonly decisionDensity: DecisionDensityMetrics;
  readonly trailerCoverage: TrailerCoverageMetrics;
  readonly staleness: StalenessMetrics;
  readonly supersessionDepth: SupersessionDepthMetrics;
  readonly constraintCoverage: ConstraintCoverageMetrics;
  readonly rejectionLibrary: RejectionLibraryMetrics;
  readonly authorBreakdown: AuthorBreakdownMetrics;
}

export interface MetricsPeriod {
  readonly since: string | null;
  readonly analyzedAt: string;
}

export interface AdoptionMetrics {
  readonly totalCommits: number;
  readonly loreCommits: number;
  readonly adoptionRate: number;
}

export interface DecisionDensityMetrics {
  readonly uniqueFilesTouched: number;
  readonly filesWithAtoms: number;
  readonly atomsPerFile: number;
  readonly blindSpotFiles: readonly string[];
  readonly blindSpotCount: number;
}

export interface TrailerCoverageMetrics {
  readonly totalAtoms: number;
  readonly trailers: readonly TrailerUsage[];
}

export interface TrailerUsage {
  readonly trailer: string;
  readonly count: number;
  readonly percentage: number;
}

export interface StalenessMetrics {
  readonly totalActive: number;
  readonly staleCount: number;
  readonly stalenessRate: number;
}

export interface SupersessionDepthMetrics {
  readonly totalChains: number;
  readonly averageDepth: number;
  readonly maxDepth: number;
}

export interface ConstraintCoverageMetrics {
  readonly totalRepoFiles: number;
  readonly filesWithConstraint: number;
  readonly coverageRate: number;
}

export interface RejectionLibraryMetrics {
  readonly uniqueRejections: number;
  readonly totalRejectionEntries: number;
}

export interface AuthorBreakdownMetrics {
  readonly agentCommits: number;
  readonly humanCommits: number;
  readonly agentAdoptionRate: number;
  readonly humanAdoptionRate: number;
}

export interface DoctorCheck {
  readonly name: string;
  readonly status: 'ok' | 'error' | 'warning' | 'info';
  readonly message: string;
  readonly details: readonly string[];
}
