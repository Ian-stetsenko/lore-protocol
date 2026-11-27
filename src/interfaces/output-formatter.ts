import type {
  FormattableQueryResult,
  FormattableValidationResult,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableDoctorResult,
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
  formatSuccess(message: string, data?: Record<string, unknown>): string;
  formatError(code: number, messages: readonly ErrorMessage[]): string;
  /**
   * Format advisory warnings for a command that still succeeds.
   * Returns an empty string when there is nothing to print on stderr;
   * callers print the result only when it is non-empty.
   */
  formatWarnings(messages: readonly ErrorMessage[]): string;
}
