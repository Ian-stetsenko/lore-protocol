import type {
  FormattableQueryResult,
  FormattableValidationResult,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableDoctorResult,
  FormattableMetricsResult,
} from '../types/output.js';

export interface ErrorMessage {
  readonly severity: 'error' | 'warning';
  readonly field?: string;
  readonly message: string;
}

export interface IOutputFormatter {
  formatQueryResult(data: FormattableQueryResult): string;
  formatValidationResult(data: FormattableValidationResult): string;
  formatStalenessResult(data: FormattableStalenessResult): string;
  formatTraceResult(data: FormattableTraceResult): string;
  formatDoctorResult(data: FormattableDoctorResult): string;
  formatMetricsResult(data: FormattableMetricsResult): string;
  formatSuccess(message: string, data?: Record<string, unknown>): string;
  formatError(code: number, messages: readonly ErrorMessage[]): string;
}
