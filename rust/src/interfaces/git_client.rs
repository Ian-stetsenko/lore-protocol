//! Port for all git interaction.

use crate::util::Result;

/// One commit as returned by `git log`, before Lore parsing.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RawCommit {
    pub hash: String,
    /// Author date string exactly as git printed it (ISO 8601 for the
    /// formatted log, git's default format for `-L` output).
    pub date: String,
    /// Author email.
    pub author: String,
    pub subject: String,
    pub body: String,
    /// Raw trailer block (`%(trailers:only,unfold)`).
    pub trailers: String,
    /// Files changed in this commit, collected in bulk by `GitClient::log`.
    pub files_changed: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlameLine {
    pub commit_hash: String,
    pub line_number: u32,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitResult {
    pub hash: String,
    pub success: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CommitOptions {
    pub amend: bool,
    pub no_edit: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LogOptions {
    /// Pre-filter at the git level to commits that carry a Lore-id trailer
    /// line. Lets git skip non-Lore history natively; the trailer parser
    /// remains the authority on what is an atom.
    pub lore_only: bool,
    /// Push a conventional-commit scope pre-filter to the git layer as a
    /// case-insensitive `--grep=\(<scope>\)` ANDed with the Lore-id
    /// pre-filter via `--all-match`. Coarse by design (substring over the
    /// whole message); the parser-level scope filter stays authoritative. It
    /// cannot drop an atom with an ASCII single-line subject; wrapped
    /// multi-line subjects and non-ASCII case folding are the documented
    /// residuals.
    ///
    /// Callers must not pass their own `--grep` in args alongside this (git
    /// would AND it under `--all-match`, silently narrowing their query).
    /// Author patterns in args also become case-insensitive while this is
    /// set, matching the parser-level author refinement, and the Lore-id
    /// pre-filter itself case-folds (over-match only; the trailer parser
    /// stays authoritative). An empty scope is ignored.
    pub scope: Option<String>,
}

impl LogOptions {
    pub const LORE_ONLY: LogOptions = LogOptions {
        lore_only: true,
        scope: None,
    };

    /// Lore-only discovery narrowed by a conventional-commit scope grep.
    pub fn lore_only_in_scope(scope: &str) -> Self {
        LogOptions {
            lore_only: true,
            scope: Some(scope.to_owned()),
        }
    }
}

/// Stable interface over the git CLI. All git access goes through this trait.
pub trait GitClient {
    /// Run `git log` with the given extra arguments and return parsed commits.
    fn log(&self, args: &[String], options: LogOptions) -> Result<Vec<RawCommit>>;

    /// `git blame --porcelain -L start,end file`. `line_end == None` means
    /// "to end of file".
    fn blame(&self, file: &str, line_start: u32, line_end: Option<u32>) -> Result<Vec<BlameLine>>;

    fn commit(&self, message: &str, options: CommitOptions) -> Result<CommitResult>;

    /// `false` on any failure.
    fn has_staged_changes(&self) -> bool;

    fn repo_root(&self) -> Result<String>;

    /// `false` on any failure.
    fn is_inside_repo(&self) -> bool;

    fn files_changed(&self, commit_hash: &str) -> Result<Vec<String>>;

    /// Number of commits touching `path` (repository-relative) after `since_commit_hash`.
    fn count_commits_since(&self, path: &str, since_commit_hash: &str) -> Result<usize>;

    fn resolve_ref(&self, reference: &str) -> Result<String>;

    /// Full message (`%B`) of HEAD, trailing whitespace trimmed.
    fn head_message(&self) -> Result<String>;
}
