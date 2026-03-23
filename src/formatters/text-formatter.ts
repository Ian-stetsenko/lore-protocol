import chalk, { Chalk, type ChalkInstance } from 'chalk';

import type { IOutputFormatter, ErrorMessage } from '../interfaces/output-formatter.js';
import type {
  FormattableQueryResult,
  FormattableValidationResult,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableDoctorResult,
  FormattableMetricsResult,
} from '../types/output.js';
import type { LoreAtom, TrailerKey } from '../types/domain.js';

export class TextFormatter implements IOutputFormatter {
  private readonly c: ChalkInstance;

  constructor(options: { color: boolean }) {
    this.c = new Chalk({ level: options.color ? (chalk.level || 1) : 0 });
  }

  formatQueryResult(data: FormattableQueryResult): string {
    const { result, supersessionMap, visibleTrailers } = data;
    const lines: string[] = [];

    if (result.atoms.length === 0) {
      lines.push(this.c.dim('No lore atoms found.'));
      return lines.join('\n');
    }

    for (const atom of result.atoms) {
      const supersession = supersessionMap.get(atom.loreId);
      const isSuperseded = supersession?.superseded ?? false;

      const header = this.formatAtomHeader(atom, isSuperseded);
      lines.push(header);

      if (isSuperseded && supersession?.supersededBy) {
        lines.push(this.c.dim(`  (superseded by ${supersession.supersededBy})`));
      }

      if (atom.body) {
        lines.push(`  ${this.c.dim(atom.body)}`);
      }

      const trailerLines = this.formatTrailers(atom, visibleTrailers);
      for (const tl of trailerLines) {
        lines.push(`  ${tl}`);
      }

      lines.push('');
    }

    lines.push(
      this.c.dim(
        `${result.meta.filteredAtoms} of ${result.meta.totalAtoms} atoms shown`,
      ),
    );

    return lines.join('\n');
  }

  formatValidationResult(data: FormattableValidationResult): string {
    const lines: string[] = [];

    for (const commitResult of data.results) {
      const icon = commitResult.valid
        ? this.c.green('\u2713')
        : this.c.red('\u2717');
      const label = commitResult.loreId ?? commitResult.commit.slice(0, 8);
      lines.push(`${icon} ${label}`);

      for (const issue of commitResult.issues) {
        const severity =
          issue.severity === 'error'
            ? this.c.red('\u2717')
            : this.c.yellow('\u26A0');
        lines.push(`  ${severity} [${issue.rule}] ${issue.message}`);
      }
    }

    lines.push('');
    const summaryParts: string[] = [
      `${data.summary.commitsChecked} commits checked`,
    ];
    if (data.summary.errors > 0) {
      summaryParts.push(this.c.red(`${data.summary.errors} errors`));
    }
    if (data.summary.warnings > 0) {
      summaryParts.push(this.c.yellow(`${data.summary.warnings} warnings`));
    }
    if (data.summary.errors === 0 && data.summary.warnings === 0) {
      summaryParts.push(this.c.green('all valid'));
    }
    lines.push(summaryParts.join(', '));

    return lines.join('\n');
  }

  formatStalenessResult(data: FormattableStalenessResult): string {
    const lines: string[] = [];

    if (data.atoms.length === 0) {
      lines.push(this.c.green('No stale atoms found.'));
      return lines.join('\n');
    }

    for (const report of data.atoms) {
      const dateStr = this.formatDate(report.atom.date);
      lines.push(
        this.c.yellow('STALE') +
          `  ${this.c.bold(report.atom.loreId)} (${dateStr})`,
      );
      lines.push(`  ${this.c.dim(report.atom.intent)}`);
      for (const reason of report.reasons) {
        lines.push(`  ${this.c.yellow('\u26A0')} ${reason.description}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  formatTraceResult(data: FormattableTraceResult): string {
    const lines: string[] = [];

    lines.push(
      `${this.c.bold(data.root.loreId)} ${this.c.dim(data.root.intent)}`,
    );

    const edgeCount = data.edges.length;
    for (let i = 0; i < edgeCount; i++) {
      const edge = data.edges[i];
      const isLast = i === edgeCount - 1;
      const connector = isLast ? '\u2514\u2500\u2500' : '\u251C\u2500\u2500';
      const relLabel = this.c.dim(`[${edge.relationship}]`);

      if (edge.targetAtom) {
        lines.push(
          `${connector} ${relLabel} ${this.c.bold(edge.to)} ${this.c.dim(edge.targetAtom.intent)}`,
        );
      } else {
        lines.push(
          `${connector} ${relLabel} ${this.c.bold(edge.to)} ${this.c.dim('(unresolved)')}`,
        );
      }
    }

    return lines.join('\n');
  }

  formatDoctorResult(data: FormattableDoctorResult): string {
    const lines: string[] = [];

    for (const check of data.checks) {
      let statusLabel: string;
      switch (check.status) {
        case 'ok':
          statusLabel = this.c.green('OK');
          break;
        case 'warning':
          statusLabel = this.c.yellow('WARNING');
          break;
        case 'error':
          statusLabel = this.c.red('ERROR');
          break;
        case 'info':
          statusLabel = this.c.blue('INFO');
          break;
      }
      lines.push(`${statusLabel}  ${check.name}: ${check.message}`);

      for (const detail of check.details) {
        lines.push(`  ${this.c.dim(detail)}`);
      }
    }

    lines.push('');
    const summaryParts: string[] = [];
    if (data.summary.errors > 0) {
      summaryParts.push(this.c.red(`${data.summary.errors} errors`));
    }
    if (data.summary.warnings > 0) {
      summaryParts.push(this.c.yellow(`${data.summary.warnings} warnings`));
    }
    if (data.summary.info > 0) {
      summaryParts.push(this.c.blue(`${data.summary.info} info`));
    }
    if (summaryParts.length === 0) {
      summaryParts.push(this.c.green('all checks passed'));
    }
    lines.push(summaryParts.join(', '));

    return lines.join('\n');
  }

  formatMetricsResult(data: FormattableMetricsResult): string {
    const lines: string[] = [];
    const BAR_WIDTH = 30;

    // Header
    const period = data.period.since ? `since ${data.period.since}` : 'all time';
    lines.push(this.c.bold('LORE METRICS DASHBOARD'));
    lines.push(this.c.dim(`Period: ${period}  |  Analyzed: ${data.period.analyzedAt.slice(0, 10)}`));
    lines.push('');

    // 1. Adoption
    lines.push(this.c.bold.underline('Adoption'));
    lines.push(`  Lore commits:    ${this.alignRight(data.adoption.loreCommits, 6)} / ${data.adoption.totalCommits}`);
    lines.push(`  Adoption rate:   ${this.progressBar(data.adoption.adoptionRate, BAR_WIDTH)} ${this.formatPercent(data.adoption.adoptionRate)}`);
    lines.push('');

    // 2. Decision Density
    lines.push(this.c.bold.underline('Decision Density'));
    lines.push(`  Files touched:   ${this.alignRight(data.decisionDensity.uniqueFilesTouched, 6)}`);
    lines.push(`  Files with atoms:${this.alignRight(data.decisionDensity.filesWithAtoms, 6)}`);
    lines.push(`  Atoms per file:  ${this.alignRight(data.decisionDensity.atomsPerFile, 6)}`);
    lines.push(`  Blind spots:     ${this.alignRight(data.decisionDensity.blindSpotCount, 6)}`);
    if (data.decisionDensity.blindSpotFiles.length > 0) {
      for (const file of data.decisionDensity.blindSpotFiles) {
        lines.push(`    ${this.c.dim(file)}`);
      }
      if (data.decisionDensity.blindSpotCount > data.decisionDensity.blindSpotFiles.length) {
        lines.push(`    ${this.c.dim(`... and ${data.decisionDensity.blindSpotCount - data.decisionDensity.blindSpotFiles.length} more`)}`);
      }
    }
    lines.push('');

    // 3. Trailer Coverage
    lines.push(this.c.bold.underline('Trailer Coverage'));
    lines.push(`  Total atoms:     ${this.alignRight(data.trailerCoverage.totalAtoms, 6)}`);
    for (const t of data.trailerCoverage.trailers) {
      if (t.count > 0) {
        const label = `  ${t.trailer}:`;
        const padded = label.padEnd(20);
        lines.push(`${padded}${this.alignRight(t.count, 5)}  ${this.progressBar(t.percentage / 100, BAR_WIDTH)} ${this.formatPercent(t.percentage / 100)}`);
      }
    }
    lines.push('');

    // 4. Staleness
    lines.push(this.c.bold.underline('Staleness'));
    lines.push(`  Active atoms:    ${this.alignRight(data.staleness.totalActive, 6)}`);
    lines.push(`  Stale:           ${this.alignRight(data.staleness.staleCount, 6)}`);
    lines.push(`  Staleness rate:  ${this.progressBar(data.staleness.stalenessRate, BAR_WIDTH)} ${this.formatPercent(data.staleness.stalenessRate)}`);
    lines.push('');

    // 5. Supersession Depth
    lines.push(this.c.bold.underline('Supersession Depth'));
    lines.push(`  Chains:          ${this.alignRight(data.supersessionDepth.totalChains, 6)}`);
    lines.push(`  Average depth:   ${this.alignRight(data.supersessionDepth.averageDepth, 6)}`);
    lines.push(`  Max depth:       ${this.alignRight(data.supersessionDepth.maxDepth, 6)}`);
    lines.push('');

    // 6. Constraint Coverage
    lines.push(this.c.bold.underline('Constraint Coverage'));
    lines.push(`  Repo files:      ${this.alignRight(data.constraintCoverage.totalRepoFiles, 6)}`);
    lines.push(`  With constraints:${this.alignRight(data.constraintCoverage.filesWithConstraint, 6)}`);
    lines.push(`  Coverage rate:   ${this.progressBar(data.constraintCoverage.coverageRate, BAR_WIDTH)} ${this.formatPercent(data.constraintCoverage.coverageRate)}`);
    lines.push('');

    // 7. Rejection Library
    lines.push(this.c.bold.underline('Rejection Library'));
    lines.push(`  Unique rejections:${this.alignRight(data.rejectionLibrary.uniqueRejections, 5)}`);
    lines.push(`  Total entries:   ${this.alignRight(data.rejectionLibrary.totalRejectionEntries, 6)}`);
    lines.push('');

    // 8. Author Breakdown
    lines.push(this.c.bold.underline('Author Breakdown'));
    lines.push(`  Agent commits:   ${this.alignRight(data.authorBreakdown.agentCommits, 6)}  adoption: ${this.formatPercent(data.authorBreakdown.agentAdoptionRate)}`);
    lines.push(`  Human commits:   ${this.alignRight(data.authorBreakdown.humanCommits, 6)}  adoption: ${this.formatPercent(data.authorBreakdown.humanAdoptionRate)}`);
    lines.push('');

    // Benchmarking Guide
    lines.push(this.c.bold('\u2500'.repeat(60)));
    lines.push(this.c.bold('BENCHMARKING GUIDE'));
    lines.push('');
    lines.push(this.c.bold('Automatic metrics (above):'));
    lines.push('  Adoption rate     How many commits carry Lore context.');
    lines.push('  Trailer coverage  Which trailers teams actually use.');
    lines.push('  Staleness rate    How much recorded knowledge has drifted.');
    lines.push('  Constraint spread How much of the codebase has explicit constraints.');
    lines.push('');
    lines.push(this.c.bold('Manual metrics to track alongside:'));
    lines.push('  Re-proposed rejections  How often rejected alternatives resurface.');
    lines.push('  Review cycles           PR round-trips before merge (check your git host).');
    lines.push('  Time-to-correct         Days between introducing a bug and fixing it.');
    lines.push('  Onboarding time         Time for new contributors to make first meaningful PR.');
    lines.push('');
    lines.push(this.c.bold('Before / after comparison:'));
    lines.push('  1. Run `lore metrics --since <start>` to capture a baseline.');
    lines.push('  2. After adopting Lore for a sprint/month, run again.');
    lines.push('  3. Compare adoption rate, staleness, and constraint coverage.');
    lines.push('');
    lines.push(this.c.bold('Export for tracking:'));
    lines.push('  lore metrics --json > metrics-$(date +%Y-%m-%d).json');

    return lines.join('\n');
  }

  formatSuccess(message: string, _data?: Record<string, unknown>): string {
    return this.c.green(message);
  }

  formatError(code: number, messages: readonly ErrorMessage[]): string {
    const lines: string[] = [];

    for (const msg of messages) {
      const prefix =
        msg.severity === 'error'
          ? this.c.red('error')
          : this.c.yellow('warning');
      const field = msg.field ? ` [${msg.field}]` : '';
      lines.push(`${prefix}${field}: ${msg.message}`);
    }

    if (code !== 0) {
      lines.push(this.c.dim(`(exit code ${code})`));
    }

    return lines.join('\n');
  }

  private formatAtomHeader(atom: LoreAtom, superseded: boolean): string {
    const dateStr = this.formatDate(atom.date);
    const header = `\u2500\u2500 ${atom.loreId} (${dateStr}, ${atom.author}) `;
    const rule = '\u2500'.repeat(Math.max(0, 60 - header.length));
    const fullHeader = header + rule;

    if (superseded) {
      return this.c.dim.strikethrough(fullHeader);
    }
    return this.c.bold(fullHeader);
  }

  private formatTrailers(
    atom: LoreAtom,
    visibleTrailers: readonly TrailerKey[] | 'all',
  ): string[] {
    const lines: string[] = [];
    const trailers = atom.trailers;

    const shouldShow = (key: TrailerKey): boolean => {
      if (visibleTrailers === 'all') return true;
      return visibleTrailers.includes(key);
    };

    if (shouldShow('Constraint') && trailers.Constraint.length > 0) {
      for (const v of trailers.Constraint) {
        lines.push(`${this.c.cyan('Constraint:')} ${v}`);
      }
    }
    if (shouldShow('Rejected') && trailers.Rejected.length > 0) {
      for (const v of trailers.Rejected) {
        lines.push(`${this.c.magenta('Rejected:')} ${v}`);
      }
    }
    if (shouldShow('Confidence') && trailers.Confidence !== null) {
      lines.push(`${this.c.cyan('Confidence:')} ${trailers.Confidence}`);
    }
    if (shouldShow('Scope-risk') && trailers['Scope-risk'] !== null) {
      lines.push(`${this.c.cyan('Scope-risk:')} ${trailers['Scope-risk']}`);
    }
    if (shouldShow('Reversibility') && trailers.Reversibility !== null) {
      lines.push(
        `${this.c.cyan('Reversibility:')} ${trailers.Reversibility}`,
      );
    }
    if (shouldShow('Directive') && trailers.Directive.length > 0) {
      for (const v of trailers.Directive) {
        lines.push(`${this.c.yellow('Directive:')} ${v}`);
      }
    }
    if (shouldShow('Tested') && trailers.Tested.length > 0) {
      for (const v of trailers.Tested) {
        lines.push(`${this.c.green('Tested:')} ${v}`);
      }
    }
    if (shouldShow('Not-tested') && trailers['Not-tested'].length > 0) {
      for (const v of trailers['Not-tested']) {
        lines.push(`${this.c.red('Not-tested:')} ${v}`);
      }
    }
    if (shouldShow('Supersedes') && trailers.Supersedes.length > 0) {
      for (const v of trailers.Supersedes) {
        lines.push(`${this.c.dim('Supersedes:')} ${v}`);
      }
    }
    if (shouldShow('Depends-on') && trailers['Depends-on'].length > 0) {
      for (const v of trailers['Depends-on']) {
        lines.push(`${this.c.dim('Depends-on:')} ${v}`);
      }
    }
    if (shouldShow('Related') && trailers.Related.length > 0) {
      for (const v of trailers.Related) {
        lines.push(`${this.c.dim('Related:')} ${v}`);
      }
    }

    return lines;
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private progressBar(ratio: number, width: number): string {
    const clamped = Math.max(0, Math.min(1, ratio));
    const filled = Math.round(clamped * width);
    const empty = width - filled;
    return this.c.green('\u2588'.repeat(filled)) + this.c.dim('\u2591'.repeat(empty));
  }

  private formatPercent(ratio: number): string {
    return `${(ratio * 100).toFixed(1)}%`;
  }

  private alignRight(value: number | string, width: number): string {
    return String(value).padStart(width);
  }
}
