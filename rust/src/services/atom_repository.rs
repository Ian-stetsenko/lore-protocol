//! Retrieves [`LoreAtom`]s from git history.
//!
//! The central query engine for all Lore-related `git log` queries. It owns
//! the `RawCommit` -> `LoreAtom` mapping and the post-query filters, but
//! never the git format string (that belongs to the `GitClient`).

use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::rc::Rc;
use std::sync::LazyLock;

use chrono::{DateTime, NaiveDate, Utc};
use regex::Regex;

use crate::interfaces::git_client::{GitClient, LogOptions, RawCommit};
use crate::types::domain::{LoreAtom, LoreId, LoreTrailers, TrailerKey};
use crate::types::query::PathQueryOptions;
use crate::util::constants::is_valid_lore_id;
use crate::util::Result;

use super::trailer_parser::TrailerParser;

/// Conventional-commit scope: `type(scope): description`.
static SCOPE_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-zA-Z]+\(([^)]+)\)").expect("valid regex"));

/// Git's default author-date format as printed by a bare `git log -L`
/// (e.g. `Mon Oct 29 13:20:00 2026 +0100`).
const GIT_DEFAULT_DATE_FORMAT: &str = "%a %b %e %H:%M:%S %Y %z";

/// Options for [`AtomRepository::find_all`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FindAllOptions {
    /// Passed through as `--since=<value>` (git parses it).
    pub since: Option<String>,
    /// Passed through as `--until=<value>` (git parses it).
    pub until: Option<String>,
    /// Passed through as `--max-count=<n>`; only applied when `> 0`.
    pub max_commits: Option<usize>,
}

/// Query engine over git history for Lore atoms.
pub struct AtomRepository<'a> {
    git: &'a dyn GitClient,
    parser: &'a TrailerParser,
    custom_trailer_keys: Vec<String>,
    /// Lazily built Lore-id -> atom index over the whole history (`--all`).
    lore_index: RefCell<Option<Rc<HashMap<LoreId, LoreAtom>>>>,
}

impl<'a> AtomRepository<'a> {
    /// Create a repository over `git`, parsing trailers with `parser`.
    /// `custom_trailer_keys` is forwarded to the parser (empty = accept all
    /// unknown keys as custom trailers).
    pub fn new(
        git: &'a dyn GitClient,
        parser: &'a TrailerParser,
        custom_trailer_keys: Vec<String>,
    ) -> Self {
        AtomRepository {
            git,
            parser,
            custom_trailer_keys,
            lore_index: RefCell::new(None),
        }
    }

    /// Find atoms that touched the given target path/file/directory.
    ///
    /// Accepts pre-resolved `git log` args (from the path resolver) so that
    /// path resolution stays the caller's responsibility. Filter options
    /// (`since`, `max_commits`, `author`) are prepended as git arguments and
    /// then re-applied at the application level.
    pub fn find_by_target(
        &self,
        git_log_args: &[String],
        options: &PathQueryOptions,
    ) -> Result<Vec<LoreAtom>> {
        let mut all_args = self.build_log_args(options);
        all_args.extend(git_log_args.iter().cloned());
        let raw = self.git.log(&all_args, LogOptions::LORE_ONLY)?;
        let atoms = self.parse_raw_commits(&raw);
        Ok(self.apply_filters(atoms, options))
    }

    /// Find an atom by its Lore-id.
    ///
    /// Uses `git log --grep` anchored on the trailer line so git searches
    /// for the specific value instead of walking the whole history. The
    /// grep is deliberately not combined with `lore_only`: git ORs multiple
    /// `--grep` patterns, which would widen this back to a full scan.
    pub fn find_by_lore_id(&self, lore_id: &str) -> Result<Option<LoreAtom>> {
        if !is_valid_lore_id(lore_id) {
            return Ok(None);
        }

        // Whitespace after the colon is optional because git accepts and
        // normalises `Lore-id:<id>`. The id is validated hex above, so no
        // regex escaping is needed.
        let args = vec![
            "--all".to_owned(),
            "--extended-regexp".to_owned(),
            format!("--grep=^Lore-id:[[:space:]]*{lore_id}"),
        ];
        let raw = self.git.log(&args, LogOptions::default())?;
        let atoms = self.parse_raw_commits(&raw);
        Ok(atoms.into_iter().find(|atom| atom.lore_id == lore_id))
    }

    /// Build (once per instance) an index of every atom by Lore-id from a
    /// single `git log --all` pass.
    ///
    /// Reference-heavy traversals (trace BFS, follow-link resolution,
    /// reference validation) look ids up here instead of running one
    /// full-history grep per id. Newest-first insertion with first-wins
    /// keeps the same atom a grep-based [`Self::find_by_lore_id`] returns.
    ///
    /// Deviation from TS: the TypeScript implementation caches the promise
    /// and therefore also caches a *rejected* build (every later call fails
    /// the same way). Here only a successful build is cached; a failed git
    /// call is retried on the next request.
    pub fn lore_id_index(&self) -> Result<Rc<HashMap<LoreId, LoreAtom>>> {
        if let Some(index) = self.lore_index.borrow().as_ref() {
            return Ok(Rc::clone(index));
        }

        let raw = self.git.log(&["--all".to_owned()], LogOptions::LORE_ONLY)?;
        let atoms = self.parse_raw_commits(&raw);

        let mut index: HashMap<LoreId, LoreAtom> = HashMap::new();
        for atom in atoms {
            index.entry(atom.lore_id.clone()).or_insert(atom);
        }

        let index = Rc::new(index);
        *self.lore_index.borrow_mut() = Some(Rc::clone(&index));
        Ok(index)
    }

    /// Find a single atom by its git commit hash (`git log -1 <hash>`).
    /// `None` if the commit has no valid Lore trailers.
    pub fn find_by_commit_hash(&self, hash: &str) -> Result<Option<LoreAtom>> {
        let args = vec!["-1".to_owned(), hash.to_owned()];
        let raw = self.git.log(&args, LogOptions::default())?;
        Ok(self.parse_raw_commits(&raw).into_iter().next())
    }

    /// Find atoms within a git revision range (e.g. `main..HEAD`), passed
    /// directly to `git log`.
    pub fn find_by_range(&self, range: &str) -> Result<Vec<LoreAtom>> {
        let raw = self.git.log(&[range.to_owned()], LogOptions::default())?;
        Ok(self.parse_raw_commits(&raw))
    }

    /// Find all Lore atoms, optionally filtered by date range and count.
    pub fn find_all(&self, options: &FindAllOptions) -> Result<Vec<LoreAtom>> {
        let mut args = self.build_base_log_args();

        if let Some(since) = non_empty(options.since.as_deref()) {
            args.push(format!("--since={since}"));
        }
        if let Some(until) = non_empty(options.until.as_deref()) {
            args.push(format!("--until={until}"));
        }
        if let Some(max) = options.max_commits.filter(|m| *m > 0) {
            args.push(format!("--max-count={max}"));
        }

        let raw = self.git.log(&args, LogOptions::LORE_ONLY)?;
        Ok(self.parse_raw_commits(&raw))
    }

    /// Find atoms whose subject carries a conventional-commit scope
    /// (`type(scope): description`) equal to `scope`, case-insensitively.
    pub fn find_by_scope(&self, scope: &str, options: &PathQueryOptions) -> Result<Vec<LoreAtom>> {
        let args = self.build_log_args(options);
        let raw = self.git.log(&args, LogOptions::LORE_ONLY)?;
        let atoms = self.parse_raw_commits(&raw);

        let wanted = scope.to_lowercase();
        let scope_filtered: Vec<LoreAtom> = atoms
            .into_iter()
            .filter(|atom| {
                Self::extract_scope(&atom.intent)
                    .map(|s| s.to_lowercase() == wanted)
                    .unwrap_or(false)
            })
            .collect();

        Ok(self.apply_filters(scope_filtered, options))
    }

    /// Transitively resolve follow links (`Related`, `Supersedes`,
    /// `Depends-on`) from `atoms` using BFS up to `max_depth`.
    ///
    /// The result keeps the input atoms first (in order), followed by the
    /// resolved atoms in discovery order; each Lore-id appears once.
    pub fn resolve_follow_links(
        &self,
        atoms: &[LoreAtom],
        max_depth: usize,
    ) -> Result<Vec<LoreAtom>> {
        if max_depth == 0 || atoms.is_empty() {
            return Ok(atoms.to_vec());
        }

        // Insertion-ordered "map": ids for membership, atoms for output.
        let mut collected_ids: std::collections::HashSet<LoreId> =
            atoms.iter().map(|a| a.lore_id.clone()).collect();
        let mut collected: Vec<LoreAtom> = atoms.to_vec();

        let mut queue: VecDeque<(LoreId, usize)> = VecDeque::new();

        // Lazily built on the first unresolved reference.
        let mut index: Option<Rc<HashMap<LoreId, LoreAtom>>> = None;

        // Seed the BFS with all reference ids from the initial atoms.
        for atom in atoms {
            for ref_id in Self::extract_reference_ids(&atom.trailers) {
                if !collected_ids.contains(&ref_id) {
                    queue.push_back((ref_id, 1));
                }
            }
        }

        while let Some((lore_id, depth)) = queue.pop_front() {
            if depth > max_depth {
                continue;
            }
            if collected_ids.contains(&lore_id) {
                continue;
            }

            // One shared index replaces one full-history grep per visited id.
            let idx = match index.as_ref() {
                Some(idx) => Rc::clone(idx),
                None => {
                    let built = self.lore_id_index()?;
                    index = Some(Rc::clone(&built));
                    built
                }
            };

            let Some(resolved) = idx.get(&lore_id) else {
                continue;
            };

            collected_ids.insert(resolved.lore_id.clone());
            collected.push(resolved.clone());

            if depth < max_depth {
                for ref_id in Self::extract_reference_ids(&resolved.trailers) {
                    if !collected_ids.contains(&ref_id) {
                        queue.push_back((ref_id, depth + 1));
                    }
                }
            }
        }

        Ok(collected)
    }

    /// Parse the author date string git printed for a commit.
    ///
    /// Accepts RFC 3339 (`%aI`, the formatted log) and git's default date
    /// format (`Mon Oct 29 13:20:00 2026 +0100`, printed by `-L` output).
    /// Anything else falls back to the Unix epoch (1970-01-01T00:00:00Z);
    /// JS produced an `Invalid Date` there, which has no chrono equivalent.
    pub fn parse_git_date(raw: &str) -> DateTime<Utc> {
        let raw = raw.trim();
        if let Ok(dt) = DateTime::parse_from_rfc3339(raw) {
            return dt.with_timezone(&Utc);
        }
        if let Ok(dt) = DateTime::parse_from_str(raw, GIT_DEFAULT_DATE_FORMAT) {
            return dt.with_timezone(&Utc);
        }
        DateTime::<Utc>::UNIX_EPOCH
    }

    /// Base `git log` arguments. The format string is applied by the
    /// `GitClient`, so nothing is added here.
    fn build_base_log_args(&self) -> Vec<String> {
        Vec::new()
    }

    /// `git log` arguments including optional filters from the query options.
    fn build_log_args(&self, options: &PathQueryOptions) -> Vec<String> {
        let mut args = self.build_base_log_args();

        if let Some(since) = non_empty(options.since.as_deref()) {
            args.push(format!("--since={since}"));
        }
        if let Some(max) = options.max_commits.filter(|m| *m > 0) {
            args.push(format!("--max-count={max}"));
        }
        if let Some(author) = non_empty(options.author.as_deref()) {
            args.push(format!("--author={author}"));
        }

        args
    }

    /// Parse raw commits into atoms, dropping non-Lore commits. Changed
    /// files come from each `RawCommit` (collected in bulk by the git
    /// client); no per-commit git calls happen here.
    fn parse_raw_commits(&self, raw_commits: &[RawCommit]) -> Vec<LoreAtom> {
        let mut atoms = Vec::new();

        for raw in raw_commits {
            if !self.parser.contains_lore_trailers(&raw.trailers) {
                continue;
            }

            let trailers = self.parser.parse(&raw.trailers, &self.custom_trailer_keys);
            if !is_valid_lore_id(&trailers.lore_id) {
                continue;
            }

            atoms.push(Self::build_atom(raw, trailers));
        }

        atoms
    }

    /// Single source of truth for the `RawCommit` -> `LoreAtom` mapping.
    fn build_atom(raw: &RawCommit, trailers: LoreTrailers) -> LoreAtom {
        LoreAtom {
            lore_id: trailers.lore_id.clone(),
            commit_hash: raw.hash.clone(),
            date: Self::parse_git_date(&raw.date),
            author: raw.author.clone(),
            intent: raw.subject.clone(),
            body: Self::strip_trailers_from_body(&raw.body, &raw.trailers),
            trailers,
            files_changed: raw.files_changed.clone(),
        }
    }

    /// Strip the trailer block from the body text.
    ///
    /// Git's `%b` includes the trailers while `%(trailers)` yields them
    /// separately; the last occurrence of the first trailer line marks where
    /// the body is cut (then trimmed), exactly as the TypeScript does.
    fn strip_trailers_from_body(body: &str, trailers_raw: &str) -> String {
        let trimmed = trailers_raw.trim();
        if trimmed.is_empty() {
            return body.to_owned();
        }

        let first_trailer_line = trimmed.split('\n').next().unwrap_or("").trim();
        match body.rfind(first_trailer_line) {
            Some(idx) => body[..idx].trim().to_owned(),
            None => body.to_owned(),
        }
    }

    /// Second-layer post-query filters (`author`, `since`). Both are also
    /// passed to `git log`; this covers edge cases git's own matching misses.
    fn apply_filters(&self, atoms: Vec<LoreAtom>, options: &PathQueryOptions) -> Vec<LoreAtom> {
        let mut result = atoms;

        if let Some(author) = non_empty(options.author.as_deref()) {
            let author_lower = author.to_lowercase();
            result.retain(|atom| atom.author.to_lowercase().contains(&author_lower));
        }

        if let Some(since) = non_empty(options.since.as_deref()) {
            // JS did `new Date(options.since)` and skipped the filter when the
            // result was NaN. Relative forms such as `1 week ago` are handled
            // by git itself, so they skip this layer here too.
            if let Some(since_date) = parse_since(since) {
                result.retain(|atom| atom.date >= since_date);
            }
        }

        result
    }

    /// Scope from a conventional-commit subject line (`type(scope): ...`).
    fn extract_scope(subject: &str) -> Option<&str> {
        SCOPE_PATTERN
            .captures(subject)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str())
    }

    /// Every well-formed Lore-id referenced from `Supersedes`,
    /// `Depends-on` and `Related`, in that order.
    fn extract_reference_ids(trailers: &LoreTrailers) -> Vec<LoreId> {
        let mut ids = Vec::new();
        for key in TrailerKey::REFERENCE {
            if let Some(values) = trailers.array_values(key) {
                for id in values {
                    if is_valid_lore_id(id) {
                        ids.push(id.clone());
                    }
                }
            }
        }
        ids
    }
}

/// `Some(s)` only when `s` is present and non-empty (JS truthiness).
fn non_empty(s: Option<&str>) -> Option<&str> {
    s.filter(|s| !s.is_empty())
}

/// Parse a `--since` value for the post-query filter: RFC 3339, or
/// `YYYY-MM-DD` as UTC midnight (what JS `new Date('YYYY-MM-DD')` yields).
/// Anything else returns `None`, which skips the filter.
fn parse_since(value: &str) -> Option<DateTime<Utc>> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(value) {
        return Some(dt.with_timezone(&Utc));
    }
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .ok()
        .and_then(|d| d.and_hms_opt(0, 0, 0))
        .map(|naive| naive.and_utc())
}

#[cfg(test)]
mod tests;
