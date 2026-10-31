import type { IGitClient, RawCommit } from '../interfaces/git-client.js';
import type { PathQueryOptions } from '../types/query.js';
import type { LoreAtom, LoreId, LoreTrailers } from '../types/domain.js';
import type { TrailerParser } from '../services/trailer-parser.js';
import { LORE_ID_PATTERN, REFERENCE_TRAILER_KEYS } from '../util/constants.js';

/**
 * Retrieves LoreAtoms from git history.
 * The central query engine for all Lore-related git log queries.
 *
 * GRASP: Pure Fabrication -- persistence access abstracted from domain.
 * SOLID: DIP -- depends on IGitClient interface, not child_process.
 */
export class AtomRepository {
  constructor(
    private readonly gitClient: IGitClient,
    private readonly trailerParser: TrailerParser,
    private readonly customTrailerKeys: readonly string[] = [],
  ) {}

  /**
   * Lazily built Lore-id -> atom index: HEAD-reachable atoms first, then an
   * --all pass that fills ids living only off the current branch.
   */
  private loreIndex: Promise<ReadonlyMap<LoreId, LoreAtom>> | null = null;

  /**
   * Find atoms that touched the given target path/file/directory.
   * Accepts pre-resolved git log args (from PathResolver) so that
   * path resolution is the caller's responsibility (DIP).
   */
  async findByTarget(gitLogArgs: readonly string[], options: PathQueryOptions): Promise<LoreAtom[]> {
    const logArgs = this.buildLogArgs(options);
    const allArgs = [...logArgs, ...gitLogArgs];
    const rawCommits = await this.gitClient.log(allArgs, { loreOnly: true });
    const atoms = await this.parseRawCommits(rawCommits);
    return this.applyFilters(atoms, options);
  }

  /**
   * Find an atom by its Lore-id.
   * Uses git log --grep to efficiently search for the specific trailer value
   * instead of fetching entire history.
   *
   * The HEAD-reachable history is searched first and --all is consulted only
   * on a miss, so a future-dated commit on a side branch can never shadow
   * the current branch's atom (issue #57).
   */
  async findByLoreId(loreId: LoreId): Promise<LoreAtom | null> {
    if (!LORE_ID_PATTERN.test(loreId)) {
      return null;
    }

    // Anchored on a trailer line; whitespace after the colon is optional
    // because git accepts and normalises `Lore-id:<id>`. loreId is validated
    // hex above, so no regex escaping is needed. Not combined with loreOnly:
    // git ORs multiple --grep patterns, which would widen this to a full scan.
    const grepArgs = ['--extended-regexp', `--grep=^Lore-id:[[:space:]]*${loreId}`];

    // Pass 1: commits reachable from HEAD (no --all). An unborn HEAD (fresh
    // `git init`) makes this pass fail while --all succeeds and returns
    // nothing; treat that as a miss so fresh-repo behavior is unchanged.
    let headMatch: LoreAtom | undefined;
    try {
      const headCommits = await this.gitClient.log(grepArgs);
      headMatch = (await this.parseRawCommits(headCommits)).find(
        (atom) => atom.loreId === loreId,
      );
    } catch {
      // Fall through to the --all pass, which surfaces real git failures.
    }
    if (headMatch) {
      return headMatch;
    }

    // Pass 2 (miss): every ref, for Lore-ids that only exist off the branch.
    const allCommits = await this.gitClient.log(['--all', ...grepArgs]);
    const allAtoms = await this.parseRawCommits(allCommits);
    return allAtoms.find((atom) => atom.loreId === loreId) ?? null;
  }

  /**
   * Build (once per instance) an index of every atom by Lore-id from a
   * `git log` pass over HEAD followed by a `git log --all` pass.
   * Reference-heavy traversals (trace BFS, follow-link resolution, reference
   * validation) look up ids against this index instead of running one
   * full-history `git log --grep` per id, which is minutes on large corpora
   * (hundreds of greps per traversal).
   *
   * HEAD-reachable atoms are inserted first and the --all pass only fills
   * ids that are still missing, so lookups stay consistent with
   * findByLoreId: a side branch can never shadow the current branch
   * (issue #57). Within each pass, newest-first insertion with first-wins
   * keeps the same atom a grep-based findByLoreId returns.
   */
  async getLoreIdIndex(): Promise<ReadonlyMap<LoreId, LoreAtom>> {
    this.loreIndex ??= (async () => {
      // HEAD pass seeds every id reachable from the current branch. On an
      // unborn HEAD it fails while --all succeeds; skip it then, so the
      // index over a fresh repository stays empty as before.
      let headCommits: readonly RawCommit[] = [];
      try {
        headCommits = await this.gitClient.log([], { loreOnly: true });
      } catch {
        // --all pass below is the authority; real git failures throw there.
      }
      // --all pass contributes only ids the HEAD pass missed.
      const allCommits = await this.gitClient.log(['--all'], { loreOnly: true });
      const atoms = await this.parseRawCommits([...headCommits, ...allCommits]);
      const index = new Map<LoreId, LoreAtom>();
      for (const atom of atoms) {
        if (!index.has(atom.loreId)) {
          index.set(atom.loreId, atom);
        }
      }
      return index;
    })();
    return this.loreIndex;
  }

  /**
   * Find a single atom by its git commit hash.
   * Fetches the commit via `git log -1 <hash>` and parses it.
   * Returns null if the commit has no valid Lore trailers.
   */
  async findByCommitHash(hash: string): Promise<LoreAtom | null> {
    const rawCommits = await this.gitClient.log(['-1', hash]);
    const atoms = await this.parseRawCommits(rawCommits);
    return atoms.length > 0 ? atoms[0] : null;
  }

  /**
   * Find atoms within a git revision range (e.g., "main..HEAD").
   * Passes the range directly to git log.
   */
  async findByRange(range: string): Promise<LoreAtom[]> {
    const rawCommits = await this.gitClient.log([range]);
    return this.parseRawCommits(rawCommits);
  }

  /**
   * Find all Lore atoms, optionally filtered by date range and limit.
   * allRefs widens the scan from the current branch to every ref (--all);
   * used by doctor for opt-in cross-ref duplicate detection.
   */
  async findAll(
    options: { since?: string; until?: string; maxCommits?: number; allRefs?: boolean } = {},
  ): Promise<LoreAtom[]> {
    const args = this.buildBaseLogArgs();
    if (options.allRefs) {
      args.push('--all');
    }

    if (options.since) {
      args.push(`--since=${options.since}`);
    }
    if (options.until) {
      args.push(`--until=${options.until}`);
    }
    if (options.maxCommits !== undefined && options.maxCommits > 0) {
      args.push(`--max-count=${options.maxCommits}`);
    }

    const rawCommits = await this.gitClient.log(args, { loreOnly: true });
    return this.parseRawCommits(rawCommits);
  }

  /**
   * Find atoms matching a conventional commit scope.
   * Parses the subject line to extract scope from `type(scope): description`.
   */
  async findByScope(scope: string, options: PathQueryOptions): Promise<LoreAtom[]> {
    const logArgs = this.buildLogArgs(options);
    const rawCommits = await this.gitClient.log(logArgs, { loreOnly: true });
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

    // Lazily built on the first unresolved reference (see getLoreIdIndex)
    let index: ReadonlyMap<LoreId, LoreAtom> | null = null;

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

      // One shared index replaces one full-history grep per visited id
      index ??= await this.getLoreIdIndex();

      const resolved = index.get(entry.loreId) ?? null;
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
    return [];
  }

  /**
   * Build git log arguments including optional filters from PathQueryOptions.
   */
  private buildLogArgs(options: PathQueryOptions): string[] {
    const args = this.buildBaseLogArgs();

    if (options.since) {
      args.push(`--since=${options.since}`);
    }
    if (options.maxCommits !== null && options.maxCommits > 0) {
      args.push(`--max-count=${options.maxCommits}`);
    }
    if (options.author) {
      args.push(`--author=${options.author}`);
    }

    return args;
  }

  /**
   * Parse an array of RawCommit into LoreAtom[], filtering out non-Lore commits.
   * Changed files come from each RawCommit (collected in bulk by GitClient.log);
   * no per-commit git calls remain here.
   */
  private async parseRawCommits(rawCommits: readonly RawCommit[]): Promise<LoreAtom[]> {
    const atoms: LoreAtom[] = [];

    for (const raw of rawCommits) {
      if (!this.trailerParser.containsLoreTrailers(raw.trailers)) {
        continue;
      }

      const trailers = this.trailerParser.parse(raw.trailers, this.customTrailerKeys);
      if (!LORE_ID_PATTERN.test(trailers['Lore-id'])) {
        continue;
      }

      atoms.push(this.buildAtom(raw, trailers, raw.filesChanged));
    }

    return atoms;
  }

  /**
   * Construct a LoreAtom from its constituent parts.
   * Single source of truth for RawCommit -> LoreAtom mapping.
   * GRASP: Creator -- AtomRepository owns the data needed to create atoms.
   */
  private buildAtom(raw: RawCommit, trailers: LoreTrailers, filesChanged: readonly string[]): LoreAtom {
    return {
      loreId: trailers['Lore-id'],
      commitHash: raw.hash,
      date: new Date(raw.date),
      author: raw.author,
      intent: raw.subject,
      body: this.stripTrailersFromBody(raw.body, raw.trailers),
      trailers,
      filesChanged,
    };
  }

  /**
   * Strip the trailer block from the body text.
   * Git's %b includes trailers; %(trailers) gives them separately.
   * We remove the trailer text from the body to avoid duplication.
   */
  private stripTrailersFromBody(body: string, trailersRaw: string): string {
    if (!trailersRaw.trim()) return body;

    // The trailers appear as the last paragraph of the body.
    // Find and remove them by looking for the trailer lines at the end.
    const trailerLines = trailersRaw.trim().split('\n');
    if (trailerLines.length === 0) return body;

    // Try to find the first trailer line in the body and strip from there
    const firstTrailerLine = trailerLines[0].trim();
    const idx = body.lastIndexOf(firstTrailerLine);
    if (idx >= 0) {
      return body.slice(0, idx).trim();
    }

    return body;
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
