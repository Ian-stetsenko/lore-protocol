import type { IGitClient, RawCommit } from '../interfaces/git-client.js';
import type { QueryTarget, PathQueryOptions } from '../types/query.js';
import type { LoreAtom, LoreId, LoreTrailers } from '../types/domain.js';
import type { TrailerParser } from '../services/trailer-parser.js';
import { PathResolver } from '../services/path-resolver.js';
import { LORE_ID_PATTERN, REFERENCE_TRAILER_KEYS } from '../util/constants.js';

/**
 * Retrieves LoreAtoms from git history.
 * The central query engine for all Lore-related git log queries.
 *
 * GRASP: Pure Fabrication -- persistence access abstracted from domain.
 * SOLID: DIP -- depends on IGitClient interface, not child_process.
 */
export class AtomRepository {
  private readonly pathResolver: PathResolver;

  constructor(
    private readonly gitClient: IGitClient,
    private readonly trailerParser: TrailerParser,
  ) {
    this.pathResolver = new PathResolver();
  }

  /**
   * Find atoms that touched the given target path/file/directory.
   * Uses PathResolver to convert the target into git log arguments,
   * then filters results by the provided options.
   */
  async findByTarget(target: QueryTarget, options: PathQueryOptions): Promise<LoreAtom[]> {
    const pathArgs = this.pathResolver.toGitLogArgs(target);
    const logArgs = this.buildLogArgs(options);
    const allArgs = [...logArgs, '--', ...pathArgs];
    const rawCommits = await this.gitClient.log(allArgs);
    const atoms = await this.parseRawCommits(rawCommits);
    return this.applyFilters(atoms, options);
  }

  /**
   * Find an atom by its Lore-id.
   * Searches all Lore commits for a matching Lore-id trailer value.
   */
  async findByLoreId(loreId: LoreId): Promise<LoreAtom | null> {
    if (!LORE_ID_PATTERN.test(loreId)) {
      return null;
    }

    const logArgs = this.buildBaseLogArgs();
    const rawCommits = await this.gitClient.log(logArgs);
    const atoms = await this.parseRawCommits(rawCommits);

    return atoms.find((atom) => atom.loreId === loreId) ?? null;
  }

  /**
   * Find all Lore atoms, optionally filtered by date range and limit.
   */
  async findAll(options: { since?: string; until?: string; limit?: number } = {}): Promise<LoreAtom[]> {
    const args = this.buildBaseLogArgs();

    if (options.since) {
      args.push(`--since=${options.since}`);
    }
    if (options.until) {
      args.push(`--until=${options.until}`);
    }
    if (options.limit !== undefined && options.limit > 0) {
      args.push(`--max-count=${options.limit}`);
    }

    const rawCommits = await this.gitClient.log(args);
    return this.parseRawCommits(rawCommits);
  }

  /**
   * Find atoms matching a conventional commit scope.
   * Parses the subject line to extract scope from `type(scope): description`.
   */
  async findByScope(scope: string, options: PathQueryOptions): Promise<LoreAtom[]> {
    const logArgs = this.buildLogArgs(options);
    const rawCommits = await this.gitClient.log(logArgs);
    const atoms = await this.parseRawCommits(rawCommits);

    const scopeFiltered = atoms.filter((atom) => {
      const extractedScope = this.extractScope(atom.intent);
      return extractedScope !== null && extractedScope.toLowerCase() === scope.toLowerCase();
    });

    return this.applyFilters(scopeFiltered, options);
  }

  /**
   * Transitively resolve follow links (Related, Supersedes, Depends-on)
   * from the given atoms using BFS up to maxDepth.
   */
  async resolveFollowLinks(atoms: readonly LoreAtom[], maxDepth: number): Promise<LoreAtom[]> {
    if (maxDepth <= 0 || atoms.length === 0) {
      return [...atoms];
    }

    const collected = new Map<string, LoreAtom>();
    for (const atom of atoms) {
      collected.set(atom.loreId, atom);
    }

    const queue: Array<{ loreId: LoreId; depth: number }> = [];

    // Seed the BFS with all reference IDs from the initial atoms
    for (const atom of atoms) {
      const refIds = this.extractReferenceIds(atom.trailers);
      for (const refId of refIds) {
        if (!collected.has(refId)) {
          queue.push({ loreId: refId, depth: 1 });
        }
      }
    }

    while (queue.length > 0) {
      const entry = queue.shift()!;
      if (entry.depth > maxDepth) {
        continue;
      }
      if (collected.has(entry.loreId)) {
        continue;
      }

      const resolved = await this.findByLoreId(entry.loreId);
      if (resolved === null) {
        continue;
      }

      collected.set(resolved.loreId, resolved);

      if (entry.depth < maxDepth) {
        const nextRefIds = this.extractReferenceIds(resolved.trailers);
        for (const refId of nextRefIds) {
          if (!collected.has(refId)) {
            queue.push({ loreId: refId, depth: entry.depth + 1 });
          }
        }
      }
    }

    return Array.from(collected.values());
  }

  /**
   * Build the base git log format arguments.
   * Uses NUL-separated fields for reliable parsing.
   */
  private buildBaseLogArgs(): string[] {
    return [
      '--format=%H%x00%aI%x00%ae%x00%s%x00%b%x00%(trailers:only,unfold)%x00',
    ];
  }

  /**
   * Build git log arguments including optional filters from PathQueryOptions.
   */
  private buildLogArgs(options: PathQueryOptions): string[] {
    const args = this.buildBaseLogArgs();

    if (options.since) {
      args.push(`--since=${options.since}`);
    }
    if (options.limit !== null && options.limit > 0) {
      args.push(`--max-count=${options.limit}`);
    }
    if (options.author) {
      args.push(`--author=${options.author}`);
    }

    return args;
  }

  /**
   * Parse an array of RawCommit into LoreAtom[], filtering out non-Lore commits.
   */
  private async parseRawCommits(rawCommits: readonly RawCommit[]): Promise<LoreAtom[]> {
    const atoms: LoreAtom[] = [];

    for (const raw of rawCommits) {
      if (!this.trailerParser.containsLoreTrailers(raw.trailers)) {
        continue;
      }

      const trailers = this.trailerParser.parse(raw.trailers, []);
      if (!LORE_ID_PATTERN.test(trailers['Lore-id'])) {
        continue;
      }

      const filesChanged = await this.gitClient.getFilesChanged(raw.hash);

      const atom: LoreAtom = {
        loreId: trailers['Lore-id'],
        commitHash: raw.hash,
        date: new Date(raw.date),
        author: raw.author,
        intent: raw.subject,
        body: raw.body,
        trailers,
        filesChanged,
      };

      atoms.push(atom);
    }

    return atoms;
  }

  /**
   * Apply post-query filters (author, since) that weren't handled at the git level.
   * Note: author and since are also passed to git log, but this provides a second
   * layer of filtering for edge cases.
   */
  private applyFilters(atoms: LoreAtom[], options: PathQueryOptions): LoreAtom[] {
    let result = atoms;

    if (options.author) {
      const authorLower = options.author.toLowerCase();
      result = result.filter(
        (atom) => atom.author.toLowerCase().includes(authorLower),
      );
    }

    if (options.since) {
      const sinceDate = new Date(options.since);
      if (!isNaN(sinceDate.getTime())) {
        result = result.filter((atom) => atom.date >= sinceDate);
      }
    }

    if (options.limit !== null && options.limit > 0) {
      result = result.slice(0, options.limit);
    }

    return result;
  }

  /**
   * Extract the scope from a conventional commit subject line.
   * Pattern: `type(scope): description`
   * Returns null if no scope is found.
   */
  private extractScope(subject: string): string | null {
    const match = subject.match(/^[a-zA-Z]+\(([^)]+)\)/);
    return match ? match[1] : null;
  }

  /**
   * Extract all referenced Lore-ids from the reference trailers
   * (Supersedes, Depends-on, Related).
   */
  private extractReferenceIds(trailers: LoreTrailers): LoreId[] {
    const ids: LoreId[] = [];

    for (const key of REFERENCE_TRAILER_KEYS) {
      const values = trailers[key] as readonly LoreId[];
      for (const id of values) {
        if (LORE_ID_PATTERN.test(id)) {
          ids.push(id);
        }
      }
    }

    return ids;
  }
}
