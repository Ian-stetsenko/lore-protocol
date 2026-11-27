export interface RawCommit {
  readonly hash: string;
  readonly date: string;
  readonly author: string;
  readonly subject: string;
  readonly body: string;
  readonly trailers: string;
  /** Files changed in this commit, collected in bulk by GitClient.log. */
  readonly filesChanged: readonly string[];
}

export interface BlameLine {
  readonly commitHash: string;
  readonly lineNumber: number;
  readonly content: string;
}

export interface CommitResult {
  readonly hash: string;
  readonly success: boolean;
}

export interface CommitOptions {
  readonly amend?: boolean;
  readonly noEdit?: boolean;
}

export interface LogOptions {
  /**
   * Pre-filter at the git level to commits that carry a Lore-id trailer line.
   * Lets git skip non-Lore history natively (million-commit repositories stay
   * usable); the trailer parser remains the authority on what is an atom.
   */
  readonly loreOnly?: boolean;
  /**
   * Push a conventional-commit scope pre-filter to the git layer as a
   * case-insensitive `--grep=\\(<scope>\\)` ANDed with the Lore-id pre-filter
   * via --all-match. Coarse by design (substring over the whole message);
   * the parser-level scope filter stays authoritative. It cannot drop an
   * atom with an ASCII single-line subject; wrapped multi-line subjects and
   * non-ASCII case folding are the documented residuals. Callers must not pass
   * their own --grep in args alongside this (git would AND it under
   * --all-match, silently narrowing their query); author patterns in args
   * also become case-insensitive while this is set, which matches the
   * parser-level author refinement; and the Lore-id pre-filter itself
   * case-folds while this is set (over-match only; the trailer parser stays
   * authoritative).
   */
  readonly scope?: string;
}

export interface IGitClient {
  log(args: readonly string[], options?: LogOptions): Promise<readonly RawCommit[]>;
  blame(file: string, lineStart: number, lineEnd: number): Promise<readonly BlameLine[]>;
  commit(message: string, options?: CommitOptions): Promise<CommitResult>;
  hasStagedChanges(): Promise<boolean>;
  getRepoRoot(): Promise<string>;
  isInsideRepo(): Promise<boolean>;
  getFilesChanged(commitHash: string): Promise<readonly string[]>;
  countCommitsSince(path: string, sinceCommitHash: string): Promise<number>;
  resolveRef(ref: string): Promise<string>;
  getHeadMessage(): Promise<string>;
}
