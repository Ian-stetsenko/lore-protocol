import type { LoreAtom, SupersessionStatus } from '../types/domain.js';
import type {
  FormattableMetricsResult,
  AdoptionMetrics,
  DecisionDensityMetrics,
  TrailerCoverageMetrics,
  TrailerUsage,
  StalenessMetrics,
  SupersessionDepthMetrics,
  ConstraintCoverageMetrics,
  RejectionLibraryMetrics,
  AuthorBreakdownMetrics,
} from '../types/output.js';
import { MAX_BLIND_SPOT_DISPLAY } from '../util/constants.js';

/**
 * Patterns used to identify agent/bot commit authors.
 * Best-effort heuristics -- extend as new agents emerge.
 */
const AGENT_AUTHOR_PATTERNS: readonly string[] = [
  'noreply@anthropic',
  'noreply@github',
  'copilot',
  'devin',
  'cursor',
  'codeium',
  'windsurf',
  'claude',
];

/**
 * Input data required by MetricsCollector.
 * All I/O is performed by the caller; the collector is pure computation.
 */
export interface MetricsInput {
  readonly atoms: readonly LoreAtom[];
  readonly supersessionMap: ReadonlyMap<string, SupersessionStatus>;
  readonly staleAtomIds: ReadonlySet<string>;
  readonly totalCommitCount: number;
  readonly allRepoFiles: readonly string[];
  readonly since: string | null;
}

/**
 * Stateless service that computes all 8 metric categories from pre-fetched data.
 *
 * GRASP: Pure Fabrication -- no domain identity, exists solely to aggregate metrics.
 * SOLID: SRP -- only metric computation, no I/O.
 */
export class MetricsCollector {
  collectAll(input: MetricsInput): FormattableMetricsResult {
    return {
      period: {
        since: input.since,
        analyzedAt: new Date().toISOString(),
      },
      adoption: this.computeAdoption(input),
      decisionDensity: this.computeDecisionDensity(input),
      trailerCoverage: this.computeTrailerCoverage(input),
      staleness: this.computeStaleness(input),
      supersessionDepth: this.computeSupersessionDepth(input),
      constraintCoverage: this.computeConstraintCoverage(input),
      rejectionLibrary: this.computeRejectionLibrary(input),
      authorBreakdown: this.computeAuthorBreakdown(input),
    };
  }

  private computeAdoption(input: MetricsInput): AdoptionMetrics {
    const totalCommits = input.totalCommitCount;
    const loreCommits = input.atoms.length;
    const adoptionRate = totalCommits > 0 ? loreCommits / totalCommits : 0;

    return { totalCommits, loreCommits, adoptionRate };
  }

  private computeDecisionDensity(input: MetricsInput): DecisionDensityMetrics {
    const fileAtomCounts = new Map<string, number>();

    for (const atom of input.atoms) {
      for (const file of atom.filesChanged) {
        fileAtomCounts.set(file, (fileAtomCounts.get(file) ?? 0) + 1);
      }
    }

    const uniqueFilesTouched = fileAtomCounts.size;
    const filesWithAtoms = uniqueFilesTouched;
    const totalAtomFileRefs = Array.from(fileAtomCounts.values()).reduce((sum, c) => sum + c, 0);
    const atomsPerFile = uniqueFilesTouched > 0 ? totalAtomFileRefs / uniqueFilesTouched : 0;

    // Blind spots: repo files not touched by any atom
    const filesWithAtomsSet = new Set(fileAtomCounts.keys());
    const allBlindSpots = input.allRepoFiles.filter(f => !filesWithAtomsSet.has(f));
    const blindSpotCount = allBlindSpots.length;
    const blindSpotFiles = allBlindSpots.slice(0, MAX_BLIND_SPOT_DISPLAY);

    return {
      uniqueFilesTouched,
      filesWithAtoms,
      atomsPerFile: Math.round(atomsPerFile * 100) / 100,
      blindSpotFiles,
      blindSpotCount,
    };
  }

  private computeTrailerCoverage(input: MetricsInput): TrailerCoverageMetrics {
    const totalAtoms = input.atoms.length;
    const trailerKeys: readonly { key: string; check: (atom: LoreAtom) => boolean }[] = [
      { key: 'Constraint', check: (a) => a.trailers.Constraint.length > 0 },
      { key: 'Rejected', check: (a) => a.trailers.Rejected.length > 0 },
      { key: 'Confidence', check: (a) => a.trailers.Confidence !== null },
      { key: 'Scope-risk', check: (a) => a.trailers['Scope-risk'] !== null },
      { key: 'Reversibility', check: (a) => a.trailers.Reversibility !== null },
      { key: 'Directive', check: (a) => a.trailers.Directive.length > 0 },
      { key: 'Tested', check: (a) => a.trailers.Tested.length > 0 },
      { key: 'Not-tested', check: (a) => a.trailers['Not-tested'].length > 0 },
      { key: 'Supersedes', check: (a) => a.trailers.Supersedes.length > 0 },
      { key: 'Depends-on', check: (a) => a.trailers['Depends-on'].length > 0 },
      { key: 'Related', check: (a) => a.trailers.Related.length > 0 },
    ];

    const trailers: TrailerUsage[] = trailerKeys.map(({ key, check }) => {
      const count = input.atoms.filter(check).length;
      return {
        trailer: key,
        count,
        percentage: totalAtoms > 0 ? Math.round((count / totalAtoms) * 10000) / 100 : 0,
      };
    });

    return { totalAtoms, trailers };
  }

  private computeStaleness(input: MetricsInput): StalenessMetrics {
    // Count active atoms (not superseded)
    const activeAtoms = input.atoms.filter(atom => {
      const status = input.supersessionMap.get(atom.loreId);
      return status === undefined || !status.superseded;
    });

    const totalActive = activeAtoms.length;
    const staleCount = activeAtoms.filter(atom => input.staleAtomIds.has(atom.loreId)).length;
    const stalenessRate = totalActive > 0 ? staleCount / totalActive : 0;

    return { totalActive, staleCount, stalenessRate };
  }

  private computeSupersessionDepth(input: MetricsInput): SupersessionDepthMetrics {
    // Build a graph of supersession chains: for each superseded atom, find its chain depth
    const supersededBy = new Map<string, string>();
    for (const [id, status] of input.supersessionMap) {
      if (status.superseded && status.supersededBy !== null) {
        supersededBy.set(id, status.supersededBy);
      }
    }

    if (supersededBy.size === 0) {
      return { totalChains: 0, averageDepth: 0, maxDepth: 0 };
    }

    // Find chain roots: atoms that supersede others but are NOT themselves superseded
    const chainRoots = new Set<string>();
    for (const [, superseder] of supersededBy) {
      if (!supersededBy.has(superseder)) {
        chainRoots.add(superseder);
      }
    }

    // For each root, walk down to find depth
    // Build reverse map: superseder -> list of superseded
    const supersedes = new Map<string, string[]>();
    for (const [superseded, superseder] of supersededBy) {
      const existing = supersedes.get(superseder) ?? [];
      existing.push(superseded);
      supersedes.set(superseder, existing);
    }

    const depths: number[] = [];
    for (const root of chainRoots) {
      const maxBranchDepth = this.walkChainDepth(root, supersedes, new Set<string>());
      if (maxBranchDepth > 0) {
        depths.push(maxBranchDepth);
      }
    }

    const totalChains = depths.length;
    const maxDepth = depths.length > 0 ? Math.max(...depths) : 0;
    const averageDepth = depths.length > 0
      ? Math.round((depths.reduce((s, d) => s + d, 0) / depths.length) * 100) / 100
      : 0;

    return { totalChains, averageDepth, maxDepth };
  }

  private walkChainDepth(
    nodeId: string,
    supersedes: ReadonlyMap<string, string[]>,
    visited: Set<string>,
  ): number {
    if (visited.has(nodeId)) return 0;
    visited.add(nodeId);

    const children = supersedes.get(nodeId);
    if (!children || children.length === 0) return 0;

    let maxChildDepth = 0;
    for (const child of children) {
      const childDepth = this.walkChainDepth(child, supersedes, visited);
      maxChildDepth = Math.max(maxChildDepth, childDepth);
    }

    return 1 + maxChildDepth;
  }

  private computeConstraintCoverage(input: MetricsInput): ConstraintCoverageMetrics {
    const totalRepoFiles = input.allRepoFiles.length;

    // Files that appear in atoms with at least one Constraint trailer
    const filesWithConstraint = new Set<string>();
    for (const atom of input.atoms) {
      if (atom.trailers.Constraint.length > 0) {
        for (const file of atom.filesChanged) {
          filesWithConstraint.add(file);
        }
      }
    }

    const coverageRate = totalRepoFiles > 0 ? filesWithConstraint.size / totalRepoFiles : 0;

    return {
      totalRepoFiles,
      filesWithConstraint: filesWithConstraint.size,
      coverageRate,
    };
  }

  private computeRejectionLibrary(input: MetricsInput): RejectionLibraryMetrics {
    const uniqueRejections = new Set<string>();
    let totalRejectionEntries = 0;

    for (const atom of input.atoms) {
      for (const rejection of atom.trailers.Rejected) {
        totalRejectionEntries++;
        // Normalize: lowercase and trim for dedup
        const normalized = rejection.trim().toLowerCase();
        uniqueRejections.add(normalized);
      }
    }

    return {
      uniqueRejections: uniqueRejections.size,
      totalRejectionEntries,
    };
  }

  private computeAuthorBreakdown(input: MetricsInput): AuthorBreakdownMetrics {
    let agentLoreCommits = 0;
    let humanLoreCommits = 0;
    let agentTotalEstimate = 0;
    let humanTotalEstimate = 0;

    // Count Lore atoms by author type
    for (const atom of input.atoms) {
      if (this.isAgentAuthor(atom.author)) {
        agentLoreCommits++;
      } else {
        humanLoreCommits++;
      }
    }

    // Estimate total agent vs. human commits based on the ratio in Lore commits.
    // Without full commit history author data, we use the Lore atom breakdown
    // as a proxy and scale to total commits.
    const totalLore = input.atoms.length;
    const totalCommits = input.totalCommitCount;

    if (totalLore > 0 && totalCommits > 0) {
      const agentRatio = agentLoreCommits / totalLore;
      agentTotalEstimate = Math.round(agentRatio * totalCommits);
      humanTotalEstimate = totalCommits - agentTotalEstimate;
    } else {
      agentTotalEstimate = 0;
      humanTotalEstimate = totalCommits;
    }

    const agentAdoptionRate = agentTotalEstimate > 0 ? agentLoreCommits / agentTotalEstimate : 0;
    const humanAdoptionRate = humanTotalEstimate > 0 ? humanLoreCommits / humanTotalEstimate : 0;

    return {
      agentLoreCommits,
      humanLoreCommits,
      agentAdoptionRate,
      humanAdoptionRate,
    };
  }

  private isAgentAuthor(author: string): boolean {
    const lower = author.toLowerCase();
    return AGENT_AUTHOR_PATTERNS.some(pattern => lower.includes(pattern));
  }
}
