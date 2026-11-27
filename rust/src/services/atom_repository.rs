//! Retrieves [`LoreAtom`]s from git history.
//!
//! The central query engine for all Lore-related `git log` queries. It owns
//! the `RawCommit` -> `LoreAtom` mapping and the post-query filters, but
//! never the git format string (that belongs to the `GitClient`).

use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::LazyLock;

use chrono::{DateTime, NaiveDate, Utc};
use indexmap::IndexMap;
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
    /// Widen the scan from the current branch to every ref (`--all`); used
    /// by doctor for opt-in cross-ref duplicate detection.
    pub all_refs: bool,
}

/// Most near-match candidates suggested for an unresolvable Lore-id.
const MAX_NEAR_MATCHES: usize = 3;

/// Largest Hamming distance at which an indexed id counts as a near match.
const MAX_NEAR_MATCH_DISTANCE: usize = 2;

/// Lore-id -> atom index in insertion order: HEAD-reachable atoms first
/// (newest first), then atoms that live only off the current branch.
pub type LoreIdIndex = IndexMap<LoreId, LoreAtom>;

/// Query engine over git history for Lore atoms.
pub struct AtomRepository<'a> {
    git: &'a dyn GitClient,
    parser: &'a TrailerParser,
    custom_trailer_keys: Vec<String>,
    /// Lazily built Lore-id -> atom index: HEAD-reachable atoms first, then
    /// an `--all` pass that fills ids living only off the current branch.
    lore_index: RefCell<Option<Rc<LoreIdIndex>>>,
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
    ///
    /// The HEAD-reachable history is searched first and `--all` is consulted
    /// only on a miss, so a future-dated commit on a side branch can never
    /// shadow the current branch's atom (issue #57).
    pub fn find_by_lore_id(&self, lore_id: &str) -> Result<Option<LoreAtom>> {
        if !is_valid_lore_id(lore_id) {
            return Ok(None);
        }

        // Whitespace after the colon is optional because git accepts and
        // normalises `Lore-id:<id>`. The id is validated hex above, so no
        // regex escaping is needed.
        let grep_args = vec![
            "--extended-regexp".to_owned(),
            format!("--grep=^Lore-id:[[:space:]]*{lore_id}"),
        ];

        // Pass 1: commits reachable from HEAD. An unborn HEAD (fresh
        // `git init`) makes this pass fail while `--all` succeeds and returns
        // nothing, so any failure here counts as a miss.
        if let Ok(raw) = self.git.log(&grep_args, LogOptions::default()) {
            if let Some(atom) = self.find_parsed(&raw, lore_id) {
                return Ok(Some(atom));
            }
        }

        // Pass 2 (miss): every ref. Real git failures surface here.
        let all_args: Vec<String> = std::iter::once("--all".to_owned())
            .chain(grep_args)
            .collect();
        let raw = self.git.log(&all_args, LogOptions::default())?;
        Ok(self.find_parsed(&raw, lore_id))
    }

    /// The first atom parsed from `raw` that carries `lore_id`.
    fn find_parsed(&self, raw: &[RawCommit], lore_id: &str) -> Option<LoreAtom> {
        self.parse_raw_commits(raw)
            .into_iter()
            .find(|atom| atom.lore_id == lore_id)
    }

    /// Build (once per instance) an index of every atom by Lore-id from a
    /// `git log` pass over the pinned HEAD commit followed by a
    /// `git log --all --not <head-hash>` delta pass (plain `--all` when HEAD
    /// cannot be resolved or the first pass fails).
    ///
    /// Reference-heavy traversals (trace BFS, follow-link resolution,
    /// reference validation) look ids up here instead of running one
    /// full-history grep per id. HEAD-reachable atoms are inserted first and
    /// the `--all` pass only fills ids that are still missing, so lookups
    /// stay consistent with [`Self::find_by_lore_id`]: a side branch can never
    /// shadow the current branch (issue #57). Within each pass, newest-first
    /// insertion with first-wins keeps the atom a grep-based lookup returns.
    ///
    /// Only a successful build is cached; after a failed build the next call
    /// rebuilds instead of returning the same error.
    pub fn lore_id_index(&self) -> Result<Rc<LoreIdIndex>> {
        if let Some(index) = self.lore_index.borrow().as_ref() {
            return Ok(Rc::clone(index));
        }

        let atoms = self.parse_raw_commits(&self.walk_index_commits()?);

        let mut index = LoreIdIndex::new();
        for atom in atoms {
            index.entry(atom.lore_id.clone()).or_insert(atom);
        }

        let index = Rc::new(index);
        *self.lore_index.borrow_mut() = Some(Rc::clone(&index));
        Ok(index)
    }

    /// Raw commits for the Lore-id index: the pinned HEAD history first,
    /// then the `--all` delta.
    ///
    /// HEAD is resolved once and exactly that commit is walked, so the pin
    /// always equals what the first pass walked: under concurrent branch
    /// movement no walked history is dropped from the delta and no new
    /// history is hidden from it.
    fn walk_index_commits(&self) -> Result<Vec<RawCommit>> {
        // Unborn HEAD on a fresh repository: nothing to walk or exclude.
        let mut pin = self.git.resolve_ref("HEAD").ok();

        let mut commits = Vec::new();
        if let Some(head) = &pin {
            match self
                .git
                .log(std::slice::from_ref(head), LogOptions::LORE_ONLY)
            {
                Ok(head_commits) => commits = head_commits,
                // Walk failed: give the exclusion up and let --all cover HEAD.
                Err(_) => pin = None,
            }
        }

        // The delta pass contributes only ids the HEAD pass missed and is
        // the authority: real git failures surface here.
        let delta_args: Vec<String> = match pin {
            Some(head) => vec!["--all".to_owned(), "--not".to_owned(), head],
            None => vec!["--all".to_owned()],
        };
        commits.extend(self.git.log(&delta_args, LogOptions::LORE_ONLY)?);
        Ok(commits)
    }

    /// Resolve a batch of reference Lore-ids against the shared all-refs
    /// index ([`Self::lore_id_index`]): one entry per requested id, mapped to
    /// its atom or to `None` when the id resolves on no ref. Semantics match
    /// trace lookups: an id that exists only on a non-HEAD ref resolves
    /// through the delta pass.
    ///
    /// Pattern-invalid ids are left out (they can never match an indexed
    /// atom). When no valid id remains the index is never built, so commits
    /// without references pay no git cost.
    pub fn resolve_reference_ids(
        &self,
        ids: &[LoreId],
    ) -> Result<IndexMap<LoreId, Option<LoreAtom>>> {
        let valid_ids: Vec<&LoreId> = ids.iter().filter(|id| is_valid_lore_id(id)).collect();
        let mut resolved = IndexMap::new();
        if valid_ids.is_empty() {
            return Ok(resolved);
        }

        let index = self.lore_id_index()?;
        for id in valid_ids {
            resolved.insert(id.clone(), index.get(id).cloned());
        }
        Ok(resolved)
    }

    /// Near-match candidates for an unresolvable Lore-id: indexed ids at
    /// Hamming distance at most 2, nearest first, ties in index order (HEAD
    /// atoms were inserted first), capped at three.
    ///
    /// Empty when `id` is not pattern-valid or the index holds no atoms.
    pub fn find_near_match_ids(&self, id: &str) -> Result<Vec<LoreId>> {
        if !is_valid_lore_id(id) {
            return Ok(Vec::new());
        }

        let index = self.lore_id_index()?;
        let mut candidates: Vec<(usize, &LoreId)> = index
            .keys()
            .filter_map(|candidate| {
                let distance = hamming_distance(id, candidate);
                (distance <= MAX_NEAR_MATCH_DISTANCE).then_some((distance, candidate))
            })
            .collect();
        // Stable: equal distances keep index iteration order.
        candidates.sort_by_key(|(distance, _)| *distance);
        Ok(candidates
            .into_iter()
            .take(MAX_NEAR_MATCHES)
            .map(|(_, candidate)| candidate.clone())
            .collect())
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
        if options.all_refs {
            args.push("--all".to_owned());
        }

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
        // Git-level scope pushdown (coarse "(scope)" substring grep); the
        // exact conventional-commit scope filter below stays authoritative.
        let raw = self.git.log(&args, LogOptions::lore_only_in_scope(scope))?;
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
        let mut index: Option<Rc<LoreIdIndex>> = None;

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

/// Character-level Hamming distance between two pattern-validated Lore-ids
/// (always the same length).
fn hamming_distance(a: &str, b: &str) -> usize {
    a.chars().zip(b.chars()).filter(|(x, y)| x != y).count()
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
