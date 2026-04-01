import type { IOutputFormatter, ErrorMessage } from '../interfaces/output-formatter.js';
import type {
  FormattableQueryResult,
  FormattableValidationResult,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableDoctorResult,
  FormattableMetricsResult,
} from '../types/output.js';
import type { LoreAtom, LoreTrailers } from '../types/domain.js';

export class JsonFormatter implements IOutputFormatter {
  formatQueryResult(data: FormattableQueryResult): string {
    const { result, supersessionMap, visibleTrailers } = data;

    const results = result.atoms.map((atom) => {
      const supersession = supersessionMap.get(atom.loreId);
      return {
        lore_id: atom.loreId,
        commit: atom.commitHash,
        date: atom.date.toISOString(),
        author: atom.author,
        intent: atom.intent,
        body: atom.body,
        trailers: this.serializeTrailers(atom.trailers, visibleTrailers),
        files_changed: [...atom.filesChanged],
        superseded: supersession?.superseded ?? false,
        superseded_by: supersession?.supersededBy ?? null,
      };
    });

    return JSON.stringify(
      {
        lore_version: '1.0',
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
        lore_version: '1.0',
        valid: data.valid,
        summary: {
          errors: data.summary.errors,
          warnings: data.summary.warnings,
          commits_checked: data.summary.commitsChecked,
        },
        results: data.results.map((r) => ({
          commit: r.commit,
          lore_id: r.loreId,
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
        lore_version: '1.0',
        stale_atoms: data.atoms.map((report) => ({
          lore_id: report.atom.loreId,
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
        lore_version: '1.0',
        root: {
          lore_id: data.root.loreId,
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
                lore_id: edge.targetAtom.loreId,
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
        lore_version: '1.0',
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

  formatMetricsResult(data: FormattableMetricsResult): string {
    return JSON.stringify(
      {
        lore_version: '1.0',
        period: {
          since: data.period.since,
          analyzed_at: data.period.analyzedAt,
        },
        adoption: {
          total_commits: data.adoption.totalCommits,
          lore_commits: data.adoption.loreCommits,
          adoption_rate: data.adoption.adoptionRate,
        },
        decision_density: {
          unique_files_touched: data.decisionDensity.uniqueFilesTouched,
          files_with_atoms: data.decisionDensity.filesWithAtoms,
          atoms_per_file: data.decisionDensity.atomsPerFile,
          blind_spot_files: [...data.decisionDensity.blindSpotFiles],
          blind_spot_count: data.decisionDensity.blindSpotCount,
        },
        trailer_coverage: {
          total_atoms: data.trailerCoverage.totalAtoms,
          trailers: data.trailerCoverage.trailers.map((t) => ({
            trailer: t.trailer,
            count: t.count,
            percentage: t.percentage,
          })),
        },
        staleness: {
          total_active: data.staleness.totalActive,
          stale_count: data.staleness.staleCount,
          staleness_rate: data.staleness.stalenessRate,
        },
        supersession_depth: {
          total_chains: data.supersessionDepth.totalChains,
          average_depth: data.supersessionDepth.averageDepth,
          max_depth: data.supersessionDepth.maxDepth,
        },
        constraint_coverage: {
          total_repo_files: data.constraintCoverage.totalRepoFiles,
          files_with_constraint: data.constraintCoverage.filesWithConstraint,
          coverage_rate: data.constraintCoverage.coverageRate,
        },
        rejection_library: {
          unique_rejections: data.rejectionLibrary.uniqueRejections,
          total_rejection_entries: data.rejectionLibrary.totalRejectionEntries,
        },
        author_breakdown: {
          agent_lore_commits: data.authorBreakdown.agentLoreCommits,
          human_lore_commits: data.authorBreakdown.humanLoreCommits,
          agent_adoption_rate: data.authorBreakdown.agentAdoptionRate,
          human_adoption_rate: data.authorBreakdown.humanAdoptionRate,
        },
        benchmarking_guide: 'Automatic metrics: adoption rate, trailer coverage, staleness rate, constraint spread. Manual metrics to track: re-proposed rejections, review cycles, time-to-correct, onboarding time. Export for tracking: lore metrics --json > metrics-$(date +%Y-%m-%d).json',
      },
      null,
      2,
    );
  }

  formatSuccess(message: string, data?: Record<string, unknown>): string {
    return JSON.stringify(
      {
        lore_version: '1.0',
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
        lore_version: '1.0',
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

  private serializeTrailers(
    trailers: LoreTrailers,
    visibleTrailers: readonly string[] | 'all',
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    const shouldShow = (key: string): boolean => {
      if (visibleTrailers === 'all') return true;
      return visibleTrailers.includes(key);
    };

    result['lore_id'] = trailers['Lore-id'];

    if (shouldShow('Constraint') && trailers.Constraint.length > 0) {
      result['constraint'] = [...trailers.Constraint];
    }
    if (shouldShow('Rejected') && trailers.Rejected.length > 0) {
      result['rejected'] = [...trailers.Rejected];
    }
    if (shouldShow('Confidence') && trailers.Confidence !== null) {
      result['confidence'] = trailers.Confidence;
    }
    if (shouldShow('Scope-risk') && trailers['Scope-risk'] !== null) {
      result['scope_risk'] = trailers['Scope-risk'];
    }
    if (shouldShow('Reversibility') && trailers.Reversibility !== null) {
      result['reversibility'] = trailers.Reversibility;
    }
    if (shouldShow('Directive') && trailers.Directive.length > 0) {
      result['directive'] = [...trailers.Directive];
    }
    if (shouldShow('Tested') && trailers.Tested.length > 0) {
      result['tested'] = [...trailers.Tested];
    }
    if (shouldShow('Not-tested') && trailers['Not-tested'].length > 0) {
      result['not_tested'] = [...trailers['Not-tested']];
    }
    if (shouldShow('Supersedes') && trailers.Supersedes.length > 0) {
      result['supersedes'] = [...trailers.Supersedes];
    }
    if (shouldShow('Depends-on') && trailers['Depends-on'].length > 0) {
      result['depends_on'] = [...trailers['Depends-on']];
    }
    if (shouldShow('Related') && trailers.Related.length > 0) {
      result['related'] = [...trailers.Related];
    }

    // Include custom trailers
    for (const [key, values] of trailers.custom) {
      if (values.length > 0) {
        result[key.toLowerCase().replace(/-/g, '_')] = [...values];
      }
    }

    return result;
  }
}
