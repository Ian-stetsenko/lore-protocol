import type { IGitClient, RawCommit } from '../interfaces/git-client.js';
import type { QueryOptions, DiscoveryOptions } from '../types/query.js';
import type { LoreAtom, LoreId, LoreTrailers } from '../types/domain.js';
import type { TrailerParser } from '../services/trailer-parser.js';
import type { SearchFilter, FilterOptions } from '../services/search-filter.js';
import {
  LORE_ID_PATTERN,
  REFERENCE_TRAILER_KEYS,
  GIT_FILES_CHANGED_BATCH_SIZE,
} from '../util/constants.js';
import { escapeRegex } from '../util/regex.js';

/**
 * Internal extension of QueryOptions that includes pre-resolved dates.
 * This ensures the Authoritative Pass in SearchFilter is deterministic.
 */
interface ResolvedQueryOptions extends QueryOptions, FilterOptions {}

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
    private readonly searchFilter: SearchFilter,
    private readonly customTrailerKeys: readonly string[] = [],
  ) {}

  /**
   * Find atoms that touched the given target path/file/directory.
   * Accepts pre-resolved git log args (from PathResolver) so that
   * path resolution is the caller's responsibility (DIP).
   */
  async findByTarget(gitLogArgs: readonly string[], options: QueryOptions): Promise<LoreAtom[]> {
    const resolved = await this.resolveQueryDates(options);
    const logArgs = this.buildLogArgs(resolved);
    const allArgs = [...logArgs, ...gitLogArgs];
    const rawCommits = await this.gitClient.log(allArgs);
    const atoms = await this.parseRawCommits(rawCommits);
    return this.searchFilter.applyFilters(atoms, resolved);
  }

  /**
   * Find an atom by its Lore-id.
   * Uses git log --grep to efficiently search for the specific trailer value
   * instead of fetching entire history.
   */
  async findByLoreId(loreId: LoreId): Promise<LoreAtom | null> {
    if (!LORE_ID_PATTERN.test(loreId)) {
      return null;
    }

    const logArgs = [
      '--all',
      '--extended-regexp',
      '--regexp-ignore-case',
      '--all-match',
      `--grep=^Lore-id: ${escapeRegex(loreId)}`,
    ];
    const rawCommits = await this.gitClient.log(logArgs);
    const atoms = await this.parseRawCommits(rawCommits);

    // Authoritative Final Pass: Ensure the parsed ID actually matches the target.
    // This protects against "cross-talk" where the target ID appeared in the
    // commit body, but the actual trailer block contains a different valid ID.
    return atoms.find((atom) => atom.loreId === loreId) ?? null;
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
   * Find Lore atoms across the entire repository.
   *
   * Uses "Atom Discovery Mode" to push filters (Lore-id, author, scope) down to
   * the Git layer for optimized performance on large repositories.
   */
  async findAll(options: DiscoveryOptions = {}): Promise<LoreAtom[]> {
    const queryOptions = this.makeDefaultOptions(options);
    const resolved = await this.resolveQueryDates(queryOptions);
    const args = this.buildLogArgs(resolved);
    const rawCommits = await this.gitClient.log(args);
    const atoms = await this.parseRawCommits(rawCommits);
    return this.searchFilter.applyFilters(atoms, resolved);
  }

  /**
   * Resolve symbolic dates (relative, refs, ISO) into absolute JS Date objects.
   */
  private async resolveQueryDates(options: QueryOptions): Promise<ResolvedQueryOptions> {
    const sinceDate = options.since ? await this.gitClient.resolveDate(options.since) : null;
    const untilDate = options.until ? await this.gitClient.resolveDate(options.until) : null;

    return {
      ...options,
      sinceDate,
      untilDate,
    };
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
   * Build git log arguments including optional filters from DiscoveryOptions.
   * Uses optimized coarse discovery by pushing filters to the Git layer.
   *
   * IMPORTANT: Git's `--grep` matches against the entire commit message.
   * These patterns are designed for speed but may produce false positives if
   * the text appears in the body or non-Lore trailers. The
   * `searchFilter.applyFilters` method must always perform a second
   * authoritative pass for precision.
   *
   * This method adds `--all-match`, `--extended-regexp`, and a mandatory
   * Lore-id grep pattern. Any additional `--grep` patterns added by callers will
   * be joined with AND semantics.
   */
  private buildLogArgs(options: ResolvedQueryOptions): string[] {
    const args: string[] = [];

    if (options.sinceDate) {
      args.push(`--since=${options.sinceDate.toISOString()}`);
    }

    if (options.untilDate) {
      args.push(`--until=${options.untilDate.toISOString()}`);
    }

    if (options.maxCommits !== null && options.maxCommits !== undefined && options.maxCommits > 0) {
      args.push(`--max-count=${options.maxCommits}`);
    }

    // Atom Discovery Mode:
    // We always include a check for a valid Lore-id so Git only returns valid atoms.
    // This allows us to skip non-Lore commits (merges, chores, etc.) at the Git layer.
    args.push('--grep=^Lore-id: [0-9a-f]{8}');
    args.push('--extended-regexp');
    args.push('--regexp-ignore-case');

    // Use --all-match to ensure the Lore-id AND any other filters match (Lore semantics)
    args.push('--all-match');

    if (options.author) {
      args.push(`--author=${escapeRegex(options.author)}`);
    }

    if (options.scope) {
      // Improved precision: Match conventional commit type prefix and start of line.
      // Note: Git matches anywhere; searchFilter.applyFilters ensures we only match the intent line.
      args.push(`--grep=^[a-zA-Z]+\\(${escapeRegex(options.scope)}\\)`);
    }

    if (options.has) {
      // Push trailer existence check to Git layer. Matches any line starting with key.
      args.push(`--grep=^${escapeRegex(options.has)}: `);
    }

    if (options.confidence) {
      args.push(`--grep=^Confidence: ${escapeRegex(options.confidence)}`);
    }

    if (options.scopeRisk) {
      args.push(`--grep=^Scope-risk: ${escapeRegex(options.scopeRisk)}`);
    }

    if (options.reversibility) {
      args.push(`--grep=^Reversibility: ${escapeRegex(options.reversibility)}`);
    }

    if (options.text) {
      // Push coarse full-text search to Git.
      // Note: We use the raw text for a broad match; SearchFilter
      // provides the authoritative precision pass.
      args.push(`--grep=${escapeRegex(options.text)}`);
    }

    return args;
  }

  /**
   * Parse an array of RawCommit into LoreAtom[], filtering out non-Lore commits.
   *
   * This is the Authoritative Structural Pass. It verifies that commits found
   * during the coarse Discovery Phase actually contain valid Lore trailers.
   *
   * It handles several "False Positive" scenarios from Git's --grep:
   * 1. Body Matches: Git matches any line; we ensure trailers are in the trailer block.
   * 2. Case Discrepancy: Git grep is case-insensitive; we enforce strict hex casing.
   * 3. Structural Validity: We ensure the Lore-id follows the precise 8-char format.
   */
  private async parseRawCommits(rawCommits: readonly RawCommit[]): Promise<LoreAtom[]> {
    // First pass: filter to Lore commits and parse trailers (synchronous work)
    const loreCommits: Array<{ raw: RawCommit; trailers: LoreTrailers }> = [];

    for (const raw of rawCommits) {
      // 1. Structural Pass: Does the trailer block contain Lore keys?
      if (!this.trailerParser.containsLoreTrailers(raw.trailers)) {
        continue;
      }

      // 2. Strict Pass: Parse and validate the Lore-id precisely.
      const trailers = this.trailerParser.parse(raw.trailers, this.customTrailerKeys);
      if (!LORE_ID_PATTERN.test(trailers['Lore-id'])) {
        continue;
      }

      loreCommits.push({ raw, trailers });
    }

    // Second pass: batch getFilesChanged calls with concurrency limit.
    // Results accumulate in insertion order, maintaining 1:1 alignment with loreCommits.
    const filesPerCommit: (readonly string[])[] = [];
    for (let i = 0; i < loreCommits.length; i += GIT_FILES_CHANGED_BATCH_SIZE) {
      const batch = loreCommits.slice(i, i + GIT_FILES_CHANGED_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(({ raw }) => this.gitClient.getFilesChanged(raw.hash)),
      );
      filesPerCommit.push(...batchResults);
    }

    // Build atoms by pairing parsed trailers with their file lists
    const atoms: LoreAtom[] = loreCommits.map(({ raw, trailers }, index) =>
      this.buildAtom(raw, trailers, filesPerCommit[index]),
    );

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
   * Create a complete QueryOptions object from partial overrides.
   */
  private makeDefaultOptions(overrides: DiscoveryOptions = {}): QueryOptions {
    return {
      scope: null,
      followLinks: false,
      includeSuperseded: false,
      author: null,
      has: null,
      confidence: null,
      scopeRisk: null,
      reversibility: null,
      text: null,
      limit: null,
      maxCommits: null,
      since: null,
      until: null,
      ...overrides,
    };
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
