//! Builders for atoms, trailers and raw commits used across tests.

use std::cell::RefCell;
use std::collections::VecDeque;

use chrono::{DateTime, Utc};

use crate::interfaces::git_client::RawCommit;
use crate::interfaces::lore_id_generator::LoreIdGenerator;
use crate::types::custom_trailer_collection::CustomTrailerCollection;
use crate::types::domain::{
    ConfidenceLevel, LoreAtom, LoreId, LoreTrailers, ReversibilityLevel, ScopeRiskLevel,
};

/// Parse an RFC 3339 timestamp (e.g. `2025-01-15T10:00:00Z`) into UTC.
pub fn date(s: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(s)
        .unwrap_or_else(|e| panic!("bad test date {s:?}: {e}"))
        .with_timezone(&Utc)
}

/// Default trailers: Lore-id `a1b2c3d4`, nothing else set.
pub fn trailers() -> LoreTrailers {
    LoreTrailers {
        lore_id: "a1b2c3d4".to_owned(),
        ..LoreTrailers::default()
    }
}

/// Default atom: `a1b2c3d4`, `abc1234567890`, 2025-01-15T10:00:00Z,
/// `alice@example.com`, `feat(auth): add login flow`, files `src/auth.ts`.
pub fn atom() -> AtomBuilder {
    AtomBuilder::default()
}

/// Default raw commit with a Lore-id trailer block.
pub fn raw_commit() -> RawCommitBuilder {
    RawCommitBuilder::default()
}

#[derive(Debug, Clone)]
pub struct AtomBuilder {
    atom: LoreAtom,
}

impl Default for AtomBuilder {
    fn default() -> Self {
        AtomBuilder {
            atom: LoreAtom {
                lore_id: "a1b2c3d4".to_owned(),
                commit_hash: "abc1234567890".to_owned(),
                date: date("2025-01-15T10:00:00Z"),
                author: "alice@example.com".to_owned(),
                intent: "feat(auth): add login flow".to_owned(),
                body: String::new(),
                trailers: trailers(),
                files_changed: vec!["src/auth.ts".to_owned()],
            },
        }
    }
}

impl AtomBuilder {
    /// Sets both the atom id and the `Lore-id` trailer.
    pub fn id(mut self, id: &str) -> Self {
        self.atom.lore_id = id.to_owned();
        self.atom.trailers.lore_id = id.to_owned();
        self
    }

    pub fn hash(mut self, hash: &str) -> Self {
        self.atom.commit_hash = hash.to_owned();
        self
    }

    pub fn date(mut self, rfc3339: &str) -> Self {
        self.atom.date = date(rfc3339);
        self
    }

    pub fn at(mut self, when: DateTime<Utc>) -> Self {
        self.atom.date = when;
        self
    }

    pub fn author(mut self, author: &str) -> Self {
        self.atom.author = author.to_owned();
        self
    }

    pub fn intent(mut self, intent: &str) -> Self {
        self.atom.intent = intent.to_owned();
        self
    }

    pub fn body(mut self, body: &str) -> Self {
        self.atom.body = body.to_owned();
        self
    }

    pub fn files(mut self, files: &[&str]) -> Self {
        self.atom.files_changed = files.iter().map(|f| f.to_string()).collect();
        self
    }

    /// Replace the whole trailer set (the `Lore-id` inside is kept in sync
    /// with the atom id only if you set it yourself).
    pub fn trailers(mut self, trailers: LoreTrailers) -> Self {
        self.atom.trailers = trailers;
        self
    }

    pub fn constraint(mut self, values: &[&str]) -> Self {
        self.atom.trailers.constraint = strings(values);
        self
    }

    pub fn rejected(mut self, values: &[&str]) -> Self {
        self.atom.trailers.rejected = strings(values);
        self
    }

    pub fn directive(mut self, values: &[&str]) -> Self {
        self.atom.trailers.directive = strings(values);
        self
    }

    pub fn tested(mut self, values: &[&str]) -> Self {
        self.atom.trailers.tested = strings(values);
        self
    }

    pub fn not_tested(mut self, values: &[&str]) -> Self {
        self.atom.trailers.not_tested = strings(values);
        self
    }

    pub fn supersedes(mut self, values: &[&str]) -> Self {
        self.atom.trailers.supersedes = strings(values);
        self
    }

    pub fn depends_on(mut self, values: &[&str]) -> Self {
        self.atom.trailers.depends_on = strings(values);
        self
    }

    pub fn related(mut self, values: &[&str]) -> Self {
        self.atom.trailers.related = strings(values);
        self
    }

    pub fn confidence(mut self, level: ConfidenceLevel) -> Self {
        self.atom.trailers.confidence = Some(level);
        self
    }

    pub fn scope_risk(mut self, level: ScopeRiskLevel) -> Self {
        self.atom.trailers.scope_risk = Some(level);
        self
    }

    pub fn reversibility(mut self, level: ReversibilityLevel) -> Self {
        self.atom.trailers.reversibility = Some(level);
        self
    }

    pub fn custom(mut self, custom: CustomTrailerCollection) -> Self {
        self.atom.trailers.custom = custom;
        self
    }

    pub fn build(self) -> LoreAtom {
        self.atom
    }
}

impl From<AtomBuilder> for LoreAtom {
    fn from(b: AtomBuilder) -> Self {
        b.build()
    }
}

#[derive(Debug, Clone)]
pub struct RawCommitBuilder {
    commit: RawCommit,
}

impl Default for RawCommitBuilder {
    fn default() -> Self {
        RawCommitBuilder {
            commit: RawCommit {
                hash: "abc1234567890abcdef1234567890abcdef12345".to_owned(),
                date: "2025-01-15T10:00:00+00:00".to_owned(),
                author: "alice@example.com".to_owned(),
                subject: "feat(auth): add login flow".to_owned(),
                body: String::new(),
                trailers: "Lore-id: a1b2c3d4".to_owned(),
                files_changed: vec!["src/auth.ts".to_owned()],
            },
        }
    }
}

impl RawCommitBuilder {
    pub fn hash(mut self, hash: &str) -> Self {
        self.commit.hash = hash.to_owned();
        self
    }

    pub fn date(mut self, date: &str) -> Self {
        self.commit.date = date.to_owned();
        self
    }

    pub fn author(mut self, author: &str) -> Self {
        self.commit.author = author.to_owned();
        self
    }

    pub fn subject(mut self, subject: &str) -> Self {
        self.commit.subject = subject.to_owned();
        self
    }

    pub fn body(mut self, body: &str) -> Self {
        self.commit.body = body.to_owned();
        self
    }

    /// Raw trailer block, one `Key: value` per line.
    pub fn trailers(mut self, trailers: &str) -> Self {
        self.commit.trailers = trailers.to_owned();
        self
    }

    pub fn files(mut self, files: &[&str]) -> Self {
        self.commit.files_changed = strings(files);
        self
    }

    pub fn build(self) -> RawCommit {
        self.commit
    }
}

impl From<RawCommitBuilder> for RawCommit {
    fn from(b: RawCommitBuilder) -> Self {
        b.build()
    }
}

/// Deterministic id generator: hands out the queued ids in order, then
/// repeats the last one (or `deadbeef` when none were queued).
pub struct FixedLoreIdGenerator {
    ids: RefCell<VecDeque<LoreId>>,
    last: RefCell<LoreId>,
}

impl FixedLoreIdGenerator {
    pub fn new(ids: &[&str]) -> Self {
        FixedLoreIdGenerator {
            ids: RefCell::new(ids.iter().map(|s| s.to_string()).collect()),
            last: RefCell::new("deadbeef".to_owned()),
        }
    }

    pub fn single(id: &str) -> Self {
        FixedLoreIdGenerator::new(&[id])
    }
}

impl LoreIdGenerator for FixedLoreIdGenerator {
    fn generate(&self) -> LoreId {
        match self.ids.borrow_mut().pop_front() {
            Some(id) => {
                *self.last.borrow_mut() = id.clone();
                id
            }
            None => self.last.borrow().clone(),
        }
    }
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| v.to_string()).collect()
}
