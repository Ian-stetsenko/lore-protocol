import chalk, { Chalk, type ChalkInstance } from 'chalk';

import type { IOutputFormatter, ErrorMessage } from '../interfaces/output-formatter.js';
import type {
  FormattableQueryResult,
  FormattableValidationResult,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableDoctorResult,
  FormattableConfigResult,
  FormattableTrailerDefinition,
} from '../types/output.js';
import type { LoreAtom, LoreTrailers } from '../types/domain.js';
import { LORE_ID_KEY, LORE_TRAILER_KEYS } from '../util/constants.js';

/**
 * Strategy implementation for human-readable terminal output.
 * Uses chalk for semantic coloring and box-drawing characters for structure.
 *
 * SOLID: SRP -- only responsible for human-readable text formatting.
 */
export class TextFormatter implements IOutputFormatter {
  private readonly c: ChalkInstance;

  constructor(options: { color: boolean }) {
    this.c = new Chalk({ level: options.color ? (chalk.level || 1) : 0 });
  }

  formatQueryResult(data: FormattableQueryResult): string {
    const { result, supersessionMap, visibleTrailers, trailerDefinitions } = data;
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

      const trailerLines = this.formatTrailers(atom, visibleTrailers, trailerDefinitions);
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

  formatConfig(data: FormattableConfigResult): string {
    const lines: string[] = [];
    lines.push(this.c.bold(`Lore Protocol v${data.loreVersion}`));
    lines.push(this.c.dim(`Permissive mode: ${data.permissive ? 'on' : 'off'}`));
    lines.push('');
    lines.push(this.c.bold('--- Trailer Schema ---'));
    lines.push('');

    const sortedKeys = Object.keys(data.trailers).sort();

    if (data.filters.showCore) {
      lines.push(this.c.bold('Standard Trailers'));
      for (const key of sortedKeys) {
        if (this.isCoreKey(key)) {
          lines.push(this.formatTrailerDefinition(key, data.trailers[key]));
        }
      }
      lines.push('');
    }

    if (data.filters.showCustom) {
      const customKeys = sortedKeys.filter(k => !this.isCoreKey(k));
      if (customKeys.length > 0) {
        lines.push(this.c.bold('Custom Trailers'));
        for (const key of customKeys) {
          lines.push(this.formatTrailerDefinition(key, data.trailers[key]));
        }
        lines.push('');
      }
    }

    return lines.join('\n').trimEnd();
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

  private isCoreKey(key: string): boolean {
    // This is a minimal heuristic for the UI to group trailers.
    // In a fully dynamic world, we might add an 'isCore' property to FormattableTrailerDefinition.
    return (LORE_TRAILER_KEYS as readonly string[]).includes(key);
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
    visibleTrailers: readonly string[] | 'all',
    trailerDefinitions: Record<string, FormattableTrailerDefinition>,
  ): string[] {
    const lines: string[] = [];
    const trailers = atom.trailers;

    const shouldShow = (key: string): boolean => {
      if (visibleTrailers === 'all') return true;
      return visibleTrailers.includes(key);
    };

    // Process all trailers uniformly from the flat object
    for (const key of Object.keys(trailers)) {
      if (key === LORE_ID_KEY) continue;
      if (!shouldShow(key)) continue;

      const values = trailers[key];
      if (!values || values.length === 0) continue;

      // Determine color from injected metadata
      const def = trailerDefinitions[key];
      const colorName = def?.ui?.color || 'cyan';
      const color = (this.c as any)[colorName] || this.c.cyan;

      for (const v of values) {
        lines.push(`${color(`${key}:`)} ${v}`);
      }
    }

    return lines;
  }

  private formatTrailerDefinition(key: string, def: FormattableTrailerDefinition): string {
    const lines: string[] = [];
    const label = def.required ? this.c.bold(key) : key;
    const type = def.multivalue ? 'array' : 'string';
    const validation = def.validation !== 'none' ? ` (${def.validation})` : '';

    lines.push(`- ${this.c.cyan(label)} [${type}]${validation}`);
    lines.push(`  ${this.c.dim(def.description)}`);

    if (def.validation === 'values' && def.values) {
      const valueLabels = Object.entries(def.values).map(([k, v]) => (v.description ? `${k}: ${v.description}` : k));
      lines.push(`  Values: ${valueLabels.join(', ')}`);
    } else if (def.validation === 'pattern' && def.pattern) {
      lines.push(`  Pattern: ${def.pattern}`);
    }

    if (def.directives && def.directives.length > 0) {
      for (const d of def.directives) {
        lines.push(`  ${this.c.yellow('\u26A0')} ${d}`);
      }
    }

    return lines.join('\n');
  }

  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
