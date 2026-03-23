import type { IGitClient } from '../interfaces/git-client.js';
import type { LoreConfig } from '../types/config.js';
import type { LoreAtom, SupersessionStatus } from '../types/domain.js';
import type { StaleAtomReport, StaleReason } from '../types/output.js';
import { LORE_ID_PATTERN, STALE_SIGNAL } from '../util/constants.js';

/**
 * Multi-signal staleness detection for Lore atoms.
 *
 * GRASP: Information Expert -- knows staleness rules.
 * SOLID: DIP -- depends on IGitClient for drift calculation.
 *
 * Staleness signals:
 * 1. Age: atom date older than configured threshold
 * 2. Drift: file has had too many commits since the atom
 * 3. Low confidence: atom has Confidence: low
 * 4. Expired hints: Directive values with [until:YYYY-MM] or [until:YYYY-MM-DD] past due
 * 5. Orphaned dependency: Depends-on references a superseded atom
 */
export class StalenessDetector {
  constructor(
    private readonly gitClient: IGitClient,
    private readonly config: LoreConfig,
  ) {}

  /**
   * Analyze atoms for staleness. Returns reports only for atoms
   * that have at least one staleness signal.
   */
  async analyze(
    atoms: readonly LoreAtom[],
    supersessionMap: Map<string, SupersessionStatus>,
  ): Promise<StaleAtomReport[]> {
    const reports: StaleAtomReport[] = [];
    const now = new Date();
    const maxAge = this.parseDuration(this.config.stale.olderThan);

    for (const atom of atoms) {
      const reasons: StaleReason[] = [];

      // Signal 1: Age
      this.checkAge(atom, now, maxAge, reasons);

      // Signal 2: Drift
      await this.checkDrift(atom, reasons);

      // Signal 3: Low confidence
      this.checkLowConfidence(atom, reasons);

      // Signal 4: Expired hints
      this.checkExpiredHints(atom, now, reasons);

      // Signal 5: Orphaned dependency
      this.checkOrphanedDependency(atom, supersessionMap, reasons);

      if (reasons.length > 0) {
        reports.push({ atom, reasons });
      }
    }

    return reports;
  }

  /**
   * Check if an atom is older than the configured age threshold.
   */
  private checkAge(
    atom: LoreAtom,
    now: Date,
    maxAgeMs: number,
    reasons: StaleReason[],
  ): void {
    const ageMs = now.getTime() - atom.date.getTime();
    if (ageMs > maxAgeMs) {
      const ageDescription = this.formatAge(ageMs);
      reasons.push({
        signal: STALE_SIGNAL.AGE,
        description: `Atom is ${ageDescription} old (threshold: ${this.config.stale.olderThan})`,
      });
    }
  }

  /**
   * Check if files touched by the atom have drifted beyond the configured threshold.
   * Drift is measured as the number of commits to a file since the atom's commit.
   */
  private async checkDrift(
    atom: LoreAtom,
    reasons: StaleReason[],
  ): Promise<void> {
    for (const filePath of atom.filesChanged) {
      try {
        const commitsSince = await this.gitClient.countCommitsSince(
          filePath,
          atom.commitHash,
        );
        if (commitsSince > this.config.stale.driftThreshold) {
          reasons.push({
            signal: STALE_SIGNAL.DRIFT,
            description: `${filePath} has ${commitsSince} commits since this atom (threshold: ${this.config.stale.driftThreshold})`,
          });
        }
      } catch {
        // File may have been deleted or renamed; skip drift check for it
      }
    }
  }

  /**
   * Check if the atom has low confidence.
   */
  private checkLowConfidence(atom: LoreAtom, reasons: StaleReason[]): void {
    if (atom.trailers.Confidence === 'low') {
      reasons.push({
        signal: STALE_SIGNAL.LOW_CONFIDENCE,
        description: 'Atom is marked as Confidence: low',
      });
    }
  }

  /**
   * Check if any Directive values contain expired [until:...] hints.
   * Supports formats: [until:YYYY-MM] and [until:YYYY-MM-DD]
   */
  private checkExpiredHints(
    atom: LoreAtom,
    now: Date,
    reasons: StaleReason[],
  ): void {
    const untilPattern = /\[until:(\d{4}-\d{2}(?:-\d{2})?)\]/g;

    for (const directive of atom.trailers.Directive) {
      let match: RegExpExecArray | null;
      // Reset lastIndex for each directive
      untilPattern.lastIndex = 0;

      while ((match = untilPattern.exec(directive)) !== null) {
        const dateStr = match[1];
        const expiryDate = this.parseUntilDate(dateStr);

        if (expiryDate !== null && now > expiryDate) {
          reasons.push({
            signal: STALE_SIGNAL.EXPIRED_HINT,
            description: `Directive "${directive}" has expired [until:${dateStr}]`,
          });
        }
      }
    }
  }

  /**
   * Check if the atom depends on a superseded atom.
   */
  private checkOrphanedDependency(
    atom: LoreAtom,
    supersessionMap: Map<string, SupersessionStatus>,
    reasons: StaleReason[],
  ): void {
    for (const depId of atom.trailers['Depends-on']) {
      if (!LORE_ID_PATTERN.test(depId)) {
        continue;
      }

      const depStatus = supersessionMap.get(depId);
      if (depStatus && depStatus.superseded) {
        reasons.push({
          signal: STALE_SIGNAL.ORPHANED_DEP,
          description: `Depends on ${depId} which is superseded by ${depStatus.supersededBy}`,
        });
      }
    }
  }

  /**
   * Parse a duration string like "6m", "1y", "30d" into milliseconds.
   * Supports: d (days), w (weeks), m (months), y (years).
   */
  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)(d|w|m|y)$/);
    if (!match) {
      // Default to 6 months if unparseable
      return 6 * 30 * 24 * 60 * 60 * 1000;
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];
    const msPerDay = 24 * 60 * 60 * 1000;

    switch (unit) {
      case 'd':
        return value * msPerDay;
      case 'w':
        return value * 7 * msPerDay;
      case 'm':
        return value * 30 * msPerDay;
      case 'y':
        return value * 365 * msPerDay;
      default:
        return 6 * 30 * msPerDay;
    }
  }

  /**
   * Format an age in milliseconds to a human-readable string.
   */
  private formatAge(ageMs: number): string {
    const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    if (days >= 365) {
      const years = Math.floor(days / 365);
      return `${years} year${years === 1 ? '' : 's'}`;
    }
    if (days >= 30) {
      const months = Math.floor(days / 30);
      return `${months} month${months === 1 ? '' : 's'}`;
    }
    if (days >= 7) {
      const weeks = Math.floor(days / 7);
      return `${weeks} week${weeks === 1 ? '' : 's'}`;
    }
    return `${days} day${days === 1 ? '' : 's'}`;
  }

  /**
   * Parse an [until:...] date string.
   * Supports YYYY-MM (treated as end of month) and YYYY-MM-DD.
   */
  private parseUntilDate(dateStr: string): Date | null {
    // YYYY-MM format: treat as end of that month
    const monthMatch = dateStr.match(/^(\d{4})-(\d{2})$/);
    if (monthMatch) {
      const year = parseInt(monthMatch[1], 10);
      const month = parseInt(monthMatch[2], 10);
      // Create date at start of next month (end of specified month)
      const date = new Date(year, month, 1);
      if (isNaN(date.getTime())) {
        return null;
      }
      return date;
    }

    // YYYY-MM-DD format
    const dayMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dayMatch) {
      const year = parseInt(dayMatch[1], 10);
      const month = parseInt(dayMatch[2], 10) - 1;
      const day = parseInt(dayMatch[3], 10);
      const date = new Date(year, month, day, 23, 59, 59, 999);
      if (isNaN(date.getTime())) {
        return null;
      }
      return date;
    }

    return null;
  }
}
