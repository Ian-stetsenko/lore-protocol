//! Query input and result shapes.

use chrono::{DateTime, Utc};

use super::domain::LoreAtom;

/// How a CLI target argument was classified.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TargetType {
    File,
    LineRange,
    Directory,
    Glob,
}

impl TargetType {
    pub fn as_str(self) -> &'static str {
        match self {
            TargetType::File => "file",
            TargetType::LineRange => "line-range",
            TargetType::Directory => "directory",
            TargetType::Glob => "glob",
        }
    }
}

/// A parsed CLI target such as `src/auth.ts`, `src/`, `*.ts` or `file.ts:45-80`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryTarget {
    pub raw: String,
    pub target_type: TargetType,
    pub file_path: String,
    pub line_start: Option<u32>,
    pub line_end: Option<u32>,
}

/// Options shared by the path-scoped query commands.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PathQueryOptions {
    pub scope: Option<String>,
    pub follow: bool,
    pub all: bool,
    pub author: Option<String>,
    /// Result-level cap applied by the command layer after querying.
    /// Not used by the repository.
    pub limit: Option<usize>,
    pub max_commits: Option<usize>,
    pub since: Option<String>,
}

/// Options for `lore search`.
///
/// Enum filters and `has` are kept as raw strings: an unrecognised value is
/// a valid filter that simply matches nothing, mirroring the CLI contract.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SearchOptions {
    pub confidence: Option<String>,
    pub scope_risk: Option<String>,
    pub reversibility: Option<String>,
    pub has: Option<String>,
    pub author: Option<String>,
    pub scope: Option<String>,
    pub text: Option<String>,
    pub since: Option<String>,
    pub until: Option<String>,
    pub limit: Option<usize>,
    pub max_commits: Option<usize>,
}

/// Target classification carried on a query result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResultTargetType {
    Target(TargetType),
    Search,
    Global,
}

impl ResultTargetType {
    pub fn as_str(self) -> &'static str {
        match self {
            ResultTargetType::Target(t) => t.as_str(),
            ResultTargetType::Search => "search",
            ResultTargetType::Global => "global",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct QueryResult {
    pub command: String,
    pub target: String,
    pub target_type: ResultTargetType,
    pub atoms: Vec<LoreAtom>,
    pub meta: QueryMeta,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct QueryMeta {
    pub total_atoms: usize,
    pub filtered_atoms: usize,
    pub oldest: Option<DateTime<Utc>>,
    pub newest: Option<DateTime<Utc>>,
}
