import chalk, { Chalk, type ChalkInstance } from 'chalk';

import type { IOutputFormatter, ErrorMessage } from '../interfaces/output-formatter.js';
import type {
  FormattableQueryResult,
  FormattableValidationResult,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableDoctorResult,
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
}
