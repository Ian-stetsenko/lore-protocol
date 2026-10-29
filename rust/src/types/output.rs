//! Shapes handed to output formatters.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::domain::{LoreAtom, SupersessionStatus, TrailerKey};
use super::query::QueryResult;

/// Which trailers a query command displays.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VisibleTrailers {
    All,
    Only(Vec<TrailerKey>),
}

impl VisibleTrailers {
    pub fn shows(&self, key: TrailerKey) -> bool {
        match self {
            VisibleTrailers::All => true,
            VisibleTrailers::Only(keys) => keys.contains(&key),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct FormattableQueryResult {
    pub result: QueryResult,
    pub supersession_map: HashMap<String, SupersessionStatus>,
    pub visible_trailers: VisibleTrailers,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
}

impl Severity {
    pub fn as_str(self) -> &'static str {
        match self {
            Severity::Error => "error",
            Severity::Warning => "warning",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationIssue {
    pub severity: Severity,
    pub rule: String,
    pub message: String,
}

impl ValidationIssue {
    pub fn error(rule: &str, message: impl Into<String>) -> Self {
        ValidationIssue {
            severity: Severity::Error,
            rule: rule.to_owned(),
            message: message.into(),
        }
    }

    pub fn warning(rule: &str, message: impl Into<String>) -> Self {
        ValidationIssue {
            severity: Severity::Warning,
            rule: rule.to_owned(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommitValidationResult {
    pub commit: String,
    pub lore_id: Option<String>,
    pub valid: bool,
    pub issues: Vec<ValidationIssue>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ValidationSummary {
    pub errors: usize,
    pub warnings: usize,
    pub commits_checked: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormattableValidationResult {
    pub valid: bool,
    pub summary: ValidationSummary,
    pub results: Vec<CommitValidationResult>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum StaleSignal {
    Age,
    Drift,
    LowConfidence,
    ExpiredHint,
    OrphanedDep,
}

impl StaleSignal {
    pub fn as_str(self) -> &'static str {
        match self {
            StaleSignal::Age => "age",
            StaleSignal::Drift => "drift",
            StaleSignal::LowConfidence => "low-confidence",
            StaleSignal::ExpiredHint => "expired-hint",
            StaleSignal::OrphanedDep => "orphaned-dep",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaleReason {
    pub signal: StaleSignal,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StaleAtomReport {
    pub atom: LoreAtom,
    pub reasons: Vec<StaleReason>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FormattableStalenessResult {
    pub atoms: Vec<StaleAtomReport>,
}

/// One reference edge discovered by `lore trace`.
#[derive(Debug, Clone, PartialEq)]
pub struct TraceEdge {
    pub from: String,
    pub to: String,
    /// One of the reference keys: `Related`, `Supersedes`, `Depends-on`.
    pub relationship: TrailerKey,
    pub target_atom: Option<LoreAtom>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FormattableTraceResult {
    pub root: LoreAtom,
    pub edges: Vec<TraceEdge>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DoctorStatus {
    Ok,
    Error,
    Warning,
    Info,
}

impl DoctorStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            DoctorStatus::Ok => "ok",
            DoctorStatus::Error => "error",
            DoctorStatus::Warning => "warning",
            DoctorStatus::Info => "info",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DoctorCheck {
    pub name: String,
    pub status: DoctorStatus,
    pub message: String,
    pub details: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct DoctorSummary {
    pub errors: usize,
    pub warnings: usize,
    pub info: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormattableDoctorResult {
    pub checks: Vec<DoctorCheck>,
    pub summary: DoctorSummary,
}
