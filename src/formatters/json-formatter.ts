import type { IOutputFormatter, ErrorMessage } from '../interfaces/output-formatter.js';
import type {
  FormattableQueryResult,
  FormattableValidationResult,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableDoctorResult,
  FormattableConfigResult,
} from '../types/output.js';
import type { LoreTrailers } from '../types/domain.js';
import { LORE_ID_KEY, LORE_ID_JSON_KEY, LORE_VERSION_JSON_KEY } from '../util/constants.js';

/**
 * Strategy implementation for JSON output.
 * Produces machine-readable structured data.
 *
 * SOLID: SRP -- only responsible for JSON formatting.
 */
export class JsonFormatter implements IOutputFormatter {
  formatQueryResult(data: FormattableQueryResult): string {
    const { result, supersessionMap, visibleTrailers, trailerDefinitions } = data;

    const results = result.atoms.map((atom) => {
      const supersession = supersessionMap.get(atom.loreId);
      return {
        [LORE_ID_JSON_KEY]: atom.loreId,
        commit: atom.commitHash,
        date: atom.date.toISOString(),
        author: atom.author,
        intent: atom.intent,
        body: atom.body,
        trailers: this.serializeTrailers(atom.trailers, visibleTrailers, trailerDefinitions),
        files_changed: [...atom.filesChanged],
        superseded: supersession?.superseded ?? false,
        superseded_by: supersession?.supersededBy ?? null,
      };
    });

    return JSON.stringify(
      {
        [LORE_VERSION_JSON_KEY]: '1.0',
        command: result.command,
        target: result.target,
        target_type: result.targetType,
        meta: {
          total_atoms: result.meta.totalAtoms,
          filtered_atoms: result.meta.filteredAtoms,
          oldest: result.meta.oldest?.toISOString() ?? null,
          newest: result.meta.newest?.toISOString() ?? null,
        },
        results,
      },
      null,
      2,
    );
  }

  formatValidationResult(data: FormattableValidationResult): string {
    return JSON.stringify(
      {
        [LORE_VERSION_JSON_KEY]: '1.0',
        valid: data.valid,
        summary: {
          errors: data.summary.errors,
          warnings: data.summary.warnings,
          commits_checked: data.summary.commitsChecked,
        },
        results: data.results.map((r) => ({
          commit: r.commit,
          [LORE_ID_JSON_KEY]: r.loreId,
          valid: r.valid,
          issues: r.issues.map((issue) => ({
            severity: issue.severity,
            rule: issue.rule,
            message: issue.message,
          })),
        })),
      },
      null,
      2,
    );
  }

  formatStalenessResult(data: FormattableStalenessResult): string {
    return JSON.stringify(
      {
        [LORE_VERSION_JSON_KEY]: '1.0',
        stale_atoms: data.atoms.map((report) => ({
          [LORE_ID_JSON_KEY]: report.atom.loreId,
          commit: report.atom.commitHash,
          date: report.atom.date.toISOString(),
          author: report.atom.author,
          intent: report.atom.intent,
          reasons: report.reasons.map((r) => ({
            signal: r.signal,
            description: r.description,
          })),
        })),
      },
      null,
      2,
    );
  }

  formatTraceResult(data: FormattableTraceResult): string {
    return JSON.stringify(
      {
        [LORE_VERSION_JSON_KEY]: '1.0',
        root: {
          [LORE_ID_JSON_KEY]: data.root.loreId,
          commit: data.root.commitHash,
          date: data.root.date.toISOString(),
          author: data.root.author,
          intent: data.root.intent,
        },
        edges: data.edges.map((edge) => ({
          from: edge.from,
          to: edge.to,
          relationship: edge.relationship,
          resolved: edge.targetAtom !== null,
          target_atom: edge.targetAtom
            ? {
                [LORE_ID_JSON_KEY]: edge.targetAtom.loreId,
                commit: edge.targetAtom.commitHash,
                date: edge.targetAtom.date.toISOString(),
                author: edge.targetAtom.author,
                intent: edge.targetAtom.intent,
              }
            : null,
        })),
      },
      null,
      2,
    );
  }

  formatDoctorResult(data: FormattableDoctorResult): string {
    return JSON.stringify(
      {
        [LORE_VERSION_JSON_KEY]: '1.0',
        checks: data.checks.map((check) => ({
          name: check.name,
          status: check.status,
          message: check.message,
          details: [...check.details],
        })),
        summary: {
          errors: data.summary.errors,
          warnings: data.summary.warnings,
          info: data.summary.info,
        },
      },
      null,
      2,
    );
  }

  formatSuccess(message: string, data?: Record<string, unknown>): string {
    return JSON.stringify(
      {
        [LORE_VERSION_JSON_KEY]: '1.0',
        success: true,
        message,
        ...(data ?? {}),
      },
      null,
      2,
    );
  }

  formatError(code: number, messages: readonly ErrorMessage[]): string {
    return JSON.stringify(
      {
        [LORE_VERSION_JSON_KEY]: '1.0',
        error: true,
        code,
        messages: messages.map((msg) => ({
          severity: msg.severity,
          field: msg.field ?? null,
          message: msg.message,
        })),
      },
      null,
      2,
    );
  }

  formatConfig(data: FormattableConfigResult): string {
    const cleanTrailers: Record<string, any> = {};

    for (const [key, def] of Object.entries(data.trailers)) {
      // In JSON config output, we show what's requested via filters
      // (The filters are applied at the command layer before calling formatter)
      
      const { ui, ...clean } = def;
      const stripped: any = { ...clean };
      
      // Strip empty/default fields to reduce programmatic noise
      if (stripped.directives && stripped.directives.length === 0) delete stripped.directives;
      if (stripped.required === false) delete stripped.required;
      if (stripped.validation === 'none') delete stripped.validation;

      cleanTrailers[key] = stripped;
    }

    return JSON.stringify({
      [LORE_VERSION_JSON_KEY]: data.loreVersion,
      permissive: data.permissive,
      trailers: cleanTrailers
    }, null, 2);
  }

  /**
   * Transforms trailers into a flat JSON-friendly record.
   */
  private serializeTrailers(
    trailers: LoreTrailers,
    visibleTrailers: readonly string[] | 'all',
    trailerDefinitions: Record<string, any>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    const shouldShow = (key: string): boolean => {
      if (visibleTrailers === 'all') return true;
      return visibleTrailers.includes(key);
    };

    // Special case: LORE_ID_KEY is ALWAYS included in JSON, matching 'main'
    result[LORE_ID_JSON_KEY] = trailers[LORE_ID_KEY]?.[0] ?? null;

    for (const key of Object.keys(trailers)) {
      if (key === LORE_ID_KEY) continue;
      if (!shouldShow(key)) continue;

      const values = trailers[key];
      if (!values || values.length === 0) continue;

      const jsonKey = key.toLowerCase().replace(/-/g, '_');
      
      // Scalar vs Array normalization based on INJECTED metadata
      // This achieves commonality: custom trailers with multivalue: false are now coerced.
      const def = trailerDefinitions[key];
      const isScalar = def && !def.multivalue;
      
      result[jsonKey] = isScalar ? values[0] : [...values];
    }

    return result;
  }
}
