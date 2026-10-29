//! Real git interaction layer built on `std::process::Command`.
//!
//! Adapter: wraps the volatile git CLI behind the stable
//! [`GitClient`](crate::interfaces::GitClient) port. All git format strings
//! live here; the repository layer never builds them.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::LazyLock;

use regex::Regex;

use crate::interfaces::git_client::{
    BlameLine, CommitOptions, CommitResult, GitClient, LogOptions, RawCommit,
};
use crate::util::{LoreError, Result};

/// Field separator: ASCII Unit Separator (0x1F). Delimits fields within a
/// single commit record. The git format string spells it `%x1F`.
const FIELD_SEP: char = '\x1F';

/// Record separator: ASCII Record Separator (0x1E). Delimits commit records
/// in `git log` output. The git format string spells it `%x1E`.
const RECORD_SEP: char = '\x1E';

/// Git log format using git's `%xNN` hex escapes.
/// Fields: hash, ISO date, author email, subject, body, trailers.
const LOG_FORMAT: &str = "%H%x1F%aI%x1F%ae%x1F%s%x1F%b%x1F%(trailers:only,unfold)%x1E";

/// Git-level pre-filter for Lore commits ([`LogOptions::lore_only`]).
/// `--grep` is line-oriented, so the pattern anchors on a trailer-looking
/// line. Whitespace after the colon is optional because git accepts and
/// normalises `Lore-id:abcd1234`; the parser stays authoritative and still
/// rejects commits where the line sits in the body rather than the trailer
/// block. Must not be combined with other `--grep` patterns (git ORs them).
const LORE_ONLY_ARGS: [&str; 2] = [
    "--extended-regexp",
    "--grep=^Lore-id:[[:space:]]*[0-9a-f]{8}",
];

/// Blame porcelain header: a 40-hex commit hash at the start of a block.
static BLAME_HASH_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([0-9a-f]{40})\s").expect("valid regex"));

/// `[branch abc1234] subject` line printed by `git commit`.
static COMMIT_HASH_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[[\w/-]+\s+([0-9a-f]+)\]").expect("valid regex"));

/// Start of a commit block in default-format `git log` output.
static COMMIT_BLOCK_START: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^commit [0-9a-f]{40}").expect("valid regex"));
static COMMIT_LINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^commit ([0-9a-f]{40})").expect("valid regex"));
static AUTHOR_LINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^Author:\s+.*<(.+?)>").expect("valid regex"));
static DATE_LINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^Date:\s+(.+)$").expect("valid regex"));
static PARAGRAPH_BREAK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\n\n+").expect("valid regex"));
static TRAILER_LINE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[A-Za-z][A-Za-z0-9-]*:\s+").expect("valid regex"));

/// [`GitClient`] implementation that spawns the `git` binary.
#[derive(Debug, Clone, Default)]
pub struct ProcessGitClient {
    cwd: Option<PathBuf>,
}

impl ProcessGitClient {
    /// Create a client running git in `cwd`; `None` uses the process's
    /// current directory.
    pub fn new(cwd: Option<PathBuf>) -> Self {
        ProcessGitClient { cwd }
    }

    /// Run `git <args>` and return stdout. Non-zero exit or spawn failure
    /// becomes `LoreError::Git("git <first-arg> failed: <stderr>")`.
    fn exec(&self, args: &[&str]) -> Result<String> {
        let first = args.first().copied().unwrap_or("");
        let mut cmd = Command::new("git");
        cmd.args(args).stdin(Stdio::null());
        if let Some(cwd) = &self.cwd {
            cmd.current_dir(cwd);
        }

        let output = cmd
            .output()
            .map_err(|e| LoreError::git(format!("git {first} failed: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let detail = if stderr.trim().is_empty() {
                output.status.to_string()
            } else {
                stderr.into_owned()
            };
            return Err(LoreError::git(format!("git {first} failed: {detail}")));
        }

        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    /// Attach each commit's changed files in bulk.
    ///
    /// One extra `git log --name-only` pass over the same range replaces one
    /// `git diff-tree` spawn per commit, which dominates query time on large
    /// lore corpora and on platforms with expensive process spawns.
    ///
    /// `--full-diff` keeps the whole file list when the query carries a
    /// pathspec; `--no-renames` matches diff-tree plumbing, which lists both
    /// sides of a rename; merge commits list no files either way.
    ///
    /// The `-L` flag does not support `--format`, so there the already-parsed
    /// hashes are queried via `--no-walk` instead.
    fn with_files_changed(
        &self,
        mut commits: Vec<RawCommit>,
        args: &[&str],
        has_l_flag: bool,
    ) -> Result<Vec<RawCommit>> {
        if commits.is_empty() {
            return Ok(commits);
        }

        let mut name_args: Vec<&str> = vec!["log", "--name-only", "--no-renames"];
        if has_l_flag {
            name_args.extend(["--format=%x1E%H", "--no-walk"]);
            name_args.extend(commits.iter().map(|c| c.hash.as_str()));
        } else {
            name_args.extend(["--full-diff", "--format=%x1E%H"]);
            name_args.extend_from_slice(args);
        }

        let stdout = self.exec(&name_args)?;
        let mut files_by_hash = Self::parse_files_changed_output(&stdout);

        for commit in &mut commits {
            commit.files_changed = files_by_hash.remove(&commit.hash).unwrap_or_default();
        }
        Ok(commits)
    }

    /// Parse `git log --name-only --format=%x1E%H` output into a
    /// hash -> files map. Each record is `<hash>\n\n<file per line>`;
    /// commits without a diff (merges) emit only the hash line.
    pub(crate) fn parse_files_changed_output(stdout: &str) -> HashMap<String, Vec<String>> {
        let mut map = HashMap::new();
        if stdout.trim().is_empty() {
            return map;
        }

        for chunk in stdout.split(RECORD_SEP) {
            if chunk.trim().is_empty() {
                continue;
            }
            match chunk.find("\n\n") {
                None => {
                    map.insert(chunk.trim().to_owned(), Vec::new());
                }
                Some(idx) => {
                    let hash = chunk[..idx].trim().to_owned();
                    let files = chunk[idx + 2..]
                        .split('\n')
                        .filter(|l| !l.is_empty())
                        .map(str::to_owned)
                        .collect();
                    map.insert(hash, files);
                }
            }
        }

        map
    }

    /// Parse the formatted (`LOG_FORMAT`) log output. Records are separated
    /// by 0x1E, fields within a record by 0x1F. Records with fewer than six
    /// fields are skipped.
    pub(crate) fn parse_log_output(stdout: &str) -> Vec<RawCommit> {
        if stdout.trim().is_empty() {
            return Vec::new();
        }

        stdout
            .split(RECORD_SEP)
            .filter(|r| !r.trim().is_empty())
            .filter_map(|record| {
                let fields: Vec<&str> = record.split(FIELD_SEP).collect();
                if fields.len() < 6 {
                    return None;
                }
                Some(RawCommit {
                    hash: fields[0].trim().to_owned(),
                    date: fields[1].trim().to_owned(),
                    author: fields[2].trim().to_owned(),
                    subject: fields[3].trim().to_owned(),
                    body: fields[4].trim().to_owned(),
                    trailers: fields[5].trim().to_owned(),
                    files_changed: Vec::new(),
                })
            })
            .collect()
    }

    /// Parse default-format `git log -L` output (the `-L` flag does not
    /// support `--format`). Each block starts with `commit <hash>`.
    pub(crate) fn parse_l_flag_output(stdout: &str) -> Vec<RawCommit> {
        if stdout.trim().is_empty() {
            return Vec::new();
        }

        let starts: Vec<usize> = COMMIT_BLOCK_START
            .find_iter(stdout)
            .map(|m| m.start())
            .collect();
        let mut commits = Vec::new();

        for (i, &start) in starts.iter().enumerate() {
            let end = starts.get(i + 1).copied().unwrap_or(stdout.len());
            let block = &stdout[start..end];
            if block.trim().is_empty() {
                continue;
            }

            let Some(commit_match) = COMMIT_LINE.captures(block) else {
                continue;
            };
            let hash = commit_match[1].to_owned();

            let author = AUTHOR_LINE
                .captures(block)
                .map(|c| c[1].to_owned())
                .unwrap_or_default();
            let date = DATE_LINE
                .captures(block)
                .map(|c| c[1].trim().to_owned())
                .unwrap_or_default();

            let mut subject = String::new();
            let mut body = String::new();
            let mut trailers = String::new();

            if let Some(header_end) = block.find("\n\n") {
                let message_start = header_end + 2;
                let message_end = block
                    .find("\ndiff --git")
                    .unwrap_or(block.len())
                    .max(message_start);
                let raw_message = block[message_start..message_end].trim();

                // Undo the 4-space indent git applies to log messages.
                let dedented: String = raw_message
                    .split('\n')
                    .map(|l| l.strip_prefix("    ").unwrap_or(l))
                    .collect::<Vec<_>>()
                    .join("\n");

                subject = dedented.split('\n').next().unwrap_or("").to_owned();

                let paragraphs: Vec<&str> = PARAGRAPH_BREAK.split(&dedented).collect();
                if paragraphs.len() > 1 {
                    let last = paragraphs[paragraphs.len() - 1];
                    let has_trailers = last.split('\n').any(|l| TRAILER_LINE.is_match(l));
                    if has_trailers {
                        trailers = last.to_owned();
                        body = paragraphs[1..paragraphs.len() - 1].join("\n\n");
                    } else {
                        body = paragraphs[1..].join("\n\n");
                    }
                }
            }

            commits.push(RawCommit {
                hash,
                date,
                author,
                subject,
                body,
                trailers,
                files_changed: Vec::new(),
            });
        }

        commits
    }

    /// Parse `git blame --porcelain` output. A header line
    /// `<hash> <orig-line> <final-line> [<num-lines>]` opens a block; the
    /// tab-prefixed line that follows is the content.
    pub(crate) fn parse_blame_output(stdout: &str) -> Vec<BlameLine> {
        if stdout.trim().is_empty() {
            return Vec::new();
        }

        let mut results = Vec::new();
        let mut current_hash: Option<String> = None;
        let mut current_line_number: Option<u32> = None;

        for line in stdout.split('\n') {
            if let Some(caps) = BLAME_HASH_PATTERN.captures(line) {
                current_hash = Some(caps[1].to_owned());
                // Deviation from TS: an unparsable final-line field yields
                // `None` (the block is skipped) rather than `NaN`.
                current_line_number = line
                    .split_whitespace()
                    .nth(2)
                    .and_then(|n| n.parse::<u32>().ok());
                continue;
            }

            if let Some(content) = line.strip_prefix('\t') {
                if let (Some(hash), Some(line_number)) =
                    (current_hash.take(), current_line_number.take())
                {
                    results.push(BlameLine {
                        commit_hash: hash,
                        line_number,
                        content: content.to_owned(),
                    });
                }
            }
        }

        results
    }
}

impl GitClient for ProcessGitClient {
    fn log(&self, args: &[String], options: LogOptions) -> Result<Vec<RawCommit>> {
        let mut effective_args: Vec<&str> = Vec::with_capacity(args.len() + 2);
        if options.lore_only {
            effective_args.extend(LORE_ONLY_ARGS);
        }
        effective_args.extend(args.iter().map(String::as_str));

        let has_l_flag = effective_args.iter().any(|a| a.starts_with("-L"));

        let format_arg = format!("--format={LOG_FORMAT}");
        let mut base_args: Vec<&str> = vec!["log"];
        if !has_l_flag {
            base_args.push(&format_arg);
        }
        base_args.extend_from_slice(&effective_args);

        let stdout = self.exec(&base_args)?;

        let commits = if has_l_flag {
            Self::parse_l_flag_output(&stdout)
        } else {
            Self::parse_log_output(&stdout)
        };

        self.with_files_changed(commits, &effective_args, has_l_flag)
    }

    fn blame(&self, file: &str, line_start: u32, line_end: Option<u32>) -> Result<Vec<BlameLine>> {
        let line_range = match line_end {
            None => format!("{line_start},"),
            Some(end) => format!("{line_start},{end}"),
        };

        let stdout = self.exec(&["blame", "--porcelain", "-L", &line_range, file])?;
        Ok(Self::parse_blame_output(&stdout))
    }

    fn commit(&self, message: &str, options: CommitOptions) -> Result<CommitResult> {
        let mut args: Vec<&str> = vec!["commit"];
        if options.amend {
            args.push("--amend");
        }
        if options.no_edit {
            args.push("--no-edit");
        } else {
            args.extend(["-m", message]);
        }
        let stdout = self.exec(&args)?;

        // Git prints something like: [main abc1234] commit message
        let hash = COMMIT_HASH_PATTERN
            .captures(&stdout)
            .map(|c| c[1].to_owned())
            .unwrap_or_default();

        Ok(CommitResult {
            hash,
            success: true,
        })
    }

    fn has_staged_changes(&self) -> bool {
        self.exec(&["diff", "--cached", "--name-only"])
            .map(|out| !out.trim().is_empty())
            .unwrap_or(false)
    }

    fn repo_root(&self) -> Result<String> {
        let stdout = self.exec(&["rev-parse", "--show-toplevel"])?;
        Ok(stdout.trim().to_owned())
    }

    fn is_inside_repo(&self) -> bool {
        self.exec(&["rev-parse", "--is-inside-work-tree"]).is_ok()
    }

    fn files_changed(&self, commit_hash: &str) -> Result<Vec<String>> {
        let stdout = self.exec(&[
            "diff-tree",
            "--no-commit-id",
            "--name-only",
            "-r",
            commit_hash,
        ])?;
        Ok(stdout
            .trim()
            .split('\n')
            .filter(|l| !l.is_empty())
            .map(str::to_owned)
            .collect())
    }

    fn count_commits_since(&self, path: &str, since_commit_hash: &str) -> Result<usize> {
        // Paths stored in atoms are repository-relative (as git reports them),
        // while this client may run from a subdirectory. The `:(top)` pathspec
        // magic anchors the path at the repository root regardless of cwd.
        let range = format!("{since_commit_hash}..HEAD");
        let pathspec = format!(":(top){path}");
        let stdout = self.exec(&["rev-list", "--count", &range, "--", &pathspec])?;
        let count = stdout.trim();
        // Deviation from TS: a non-numeric count is a git error rather than NaN.
        count.parse::<usize>().map_err(|_| {
            LoreError::git(format!(
                "git rev-list failed: unexpected count output {count:?}"
            ))
        })
    }

    fn resolve_ref(&self, reference: &str) -> Result<String> {
        let stdout = self.exec(&["rev-parse", reference])?;
        Ok(stdout.trim().to_owned())
    }

    fn head_message(&self) -> Result<String> {
        let stdout = self.exec(&["log", "-1", "--format=%B"])?;
        Ok(stdout.trim_end().to_owned())
    }
}

#[cfg(test)]
mod tests;
