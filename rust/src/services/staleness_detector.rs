//! Multi-signal staleness detection for Lore atoms.
//!
//! Signals:
//! 1. Age: atom date older than the configured threshold.
//! 2. Drift: a touched file has had too many commits since the atom.
//! 3. Low confidence: `Confidence: low`.
//! 4. Expired hints: `Directive` values with a past `[until:YYYY-MM]` or
//!    `[until:YYYY-MM-DD]`.
//! 5. Orphaned dependency: `Depends-on` references a superseded atom.

use std::collections::HashMap;
use std::sync::LazyLock;

use chrono::{DateTime, Duration, Local, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Utc};
use regex::Regex;

use crate::interfaces::git_client::GitClient;
use crate::types::config::LoreConfig;
use crate::types::domain::{ConfidenceLevel, LoreAtom, SupersessionStatus};
use crate::types::output::{StaleAtomReport, StaleReason, StaleSignal};
use crate::util::constants::is_valid_lore_id;

static UNTIL_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\[until:(\d{4}-\d{2}(?:-\d{2})?)\]").expect("valid regex"));
static DURATION_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\d+)(d|w|m|y)$").expect("valid regex"));
static MONTH_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\d{4})-(\d{2})$").expect("valid regex"));
static DAY_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\d{4})-(\d{2})-(\d{2})$").expect("valid regex"));

const MS_PER_DAY: i64 = 24 * 60 * 60 * 1000;
/// Fallback when `stale.older_than` cannot be parsed: six 30-day months.
const DEFAULT_MAX_AGE_MS: i64 = 6 * 30 * MS_PER_DAY;

/// Detects stale atoms using the signals listed in the module docs.
pub struct StalenessDetector<'a> {
    git: &'a dyn GitClient,
    config: &'a LoreConfig,
}

impl<'a> StalenessDetector<'a> {
    pub fn new(git: &'a dyn GitClient, config: &'a LoreConfig) -> Self {
        StalenessDetector { git, config }
    }

    /// Analyze atoms against the current time. Returns a report only for
    /// atoms with at least one staleness signal.
    pub fn analyze(
        &self,
        atoms: &[LoreAtom],
        supersession_map: &HashMap<String, SupersessionStatus>,
    ) -> Vec<StaleAtomReport> {
        self.analyze_at(atoms, supersession_map, Utc::now())
    }

    /// [`Self::analyze`] with an explicit "now", for deterministic tests.
    pub fn analyze_at(
        &self,
        atoms: &[LoreAtom],
        supersession_map: &HashMap<String, SupersessionStatus>,
        now: DateTime<Utc>,
    ) -> Vec<StaleAtomReport> {
        let max_age_ms = parse_duration(&self.config.stale.older_than);
        let mut reports = Vec::new();

        for atom in atoms {
            let mut reasons: Vec<StaleReason> = Vec::new();

            self.check_age(atom, now, max_age_ms, &mut reasons);
            self.check_drift(atom, &mut reasons);
            Self::check_low_confidence(atom, &mut reasons);
            Self::check_expired_hints(atom, now, &mut reasons);
            Self::check_orphaned_dependency(atom, supersession_map, &mut reasons);

            if !reasons.is_empty() {
                reports.push(StaleAtomReport {
                    atom: atom.clone(),
                    reasons,
                });
            }
        }

        reports
    }

    fn check_age(
        &self,
        atom: &LoreAtom,
        now: DateTime<Utc>,
        max_age_ms: i64,
        reasons: &mut Vec<StaleReason>,
    ) {
        let age_ms = (now - atom.date).num_milliseconds();
        if age_ms > max_age_ms {
            reasons.push(StaleReason {
                signal: StaleSignal::Age,
                description: format!(
                    "Atom is {} old (threshold: {})",
                    format_age(age_ms),
                    self.config.stale.older_than
                ),
            });
        }
    }

    /// Drift is the number of commits to a file since the atom's commit.
    /// Git errors (deleted or renamed files) skip that file silently.
    fn check_drift(&self, atom: &LoreAtom, reasons: &mut Vec<StaleReason>) {
        let threshold = self.config.stale.drift_threshold;
        for file_path in &atom.files_changed {
            let Ok(commits_since) = self.git.count_commits_since(file_path, &atom.commit_hash)
            else {
                continue;
            };
            if commits_since > threshold {
                reasons.push(StaleReason {
                    signal: StaleSignal::Drift,
                    description: format!(
                        "{file_path} has {commits_since} commits since this atom (threshold: {threshold})"
                    ),
                });
            }
        }
    }

    fn check_low_confidence(atom: &LoreAtom, reasons: &mut Vec<StaleReason>) {
        if atom.trailers.confidence == Some(ConfidenceLevel::Low) {
            reasons.push(StaleReason {
                signal: StaleSignal::LowConfidence,
                description: "Atom is marked as Confidence: low".to_owned(),
            });
        }
    }

    fn check_expired_hints(atom: &LoreAtom, now: DateTime<Utc>, reasons: &mut Vec<StaleReason>) {
        for directive in &atom.trailers.directive {
            for caps in UNTIL_PATTERN.captures_iter(directive) {
                let date_str = &caps[1];
                let Some(expiry) = parse_until_date(date_str) else {
                    continue;
                };
                if now > expiry {
                    reasons.push(StaleReason {
                        signal: StaleSignal::ExpiredHint,
                        description: format!(
                            "Directive \"{directive}\" has expired [until:{date_str}]"
                        ),
                    });
                }
            }
        }
    }

    fn check_orphaned_dependency(
        atom: &LoreAtom,
        supersession_map: &HashMap<String, SupersessionStatus>,
        reasons: &mut Vec<StaleReason>,
    ) {
        for dep_id in &atom.trailers.depends_on {
            if !is_valid_lore_id(dep_id) {
                continue;
            }
            let Some(status) = supersession_map.get(dep_id) else {
                continue;
            };
            if status.superseded {
                // JS interpolated a `null` supersededBy as the text "null".
                let by = status.superseded_by.as_deref().unwrap_or("null");
                reasons.push(StaleReason {
                    signal: StaleSignal::OrphanedDep,
                    description: format!("Depends on {dep_id} which is superseded by {by}"),
                });
            }
        }
    }
}

/// Parse a duration such as `6m`, `1y`, `30d`, `2w` into milliseconds.
/// Months are 30 days, years 365 days. Unparseable input (including a
/// number too large to represent) defaults to six months.
fn parse_duration(duration: &str) -> i64 {
    let Some(caps) = DURATION_PATTERN.captures(duration) else {
        return DEFAULT_MAX_AGE_MS;
    };
    let Ok(value) = caps[1].parse::<i64>() else {
        return DEFAULT_MAX_AGE_MS;
    };
    let days_per_unit = match &caps[2] {
        "d" => 1,
        "w" => 7,
        "m" => 30,
        "y" => 365,
        _ => return DEFAULT_MAX_AGE_MS,
    };
    value
        .saturating_mul(days_per_unit)
        .saturating_mul(MS_PER_DAY)
}

/// Human-readable age: `N year(s)`, `N month(s)`, `N week(s)` or `N day(s)`.
fn format_age(age_ms: i64) -> String {
    let days = age_ms.div_euclid(MS_PER_DAY);

    let (count, unit) = if days >= 365 {
        (days / 365, "year")
    } else if days >= 30 {
        (days / 30, "month")
    } else if days >= 7 {
        (days / 7, "week")
    } else {
        (days, "day")
    };
    let plural = if count == 1 { "" } else { "s" };
    format!("{count} {unit}{plural}")
}

/// Parse an `[until:...]` date in LOCAL time, like JS `new Date(y, m, d)`:
/// `YYYY-MM` means the start of the following month (end of that month),
/// `YYYY-MM-DD` means 23:59:59.999 of that day. Month and day overflow
/// roll forward (`2024-13` is January 2025, `2024-02-31` is March 2nd).
fn parse_until_date(date_str: &str) -> Option<DateTime<Utc>> {
    if let Some(caps) = MONTH_PATTERN.captures(date_str) {
        let year: i32 = caps[1].parse().ok()?;
        let month: i64 = caps[2].parse().ok()?;
        // `new Date(year, month, 1)` with a 1-based month = first day of the
        // next month in 0-based terms.
        let first = js_month_start(year, month)?;
        return local_to_utc(first.and_hms_opt(0, 0, 0)?);
    }

    if let Some(caps) = DAY_PATTERN.captures(date_str) {
        let year: i32 = caps[1].parse().ok()?;
        let month: i64 = caps[2].parse().ok()?;
        let day: i64 = caps[3].parse().ok()?;
        let first = js_month_start(year, month - 1)?;
        let date = first.checked_add_signed(Duration::days(day - 1))?;
        return local_to_utc(date.and_hms_milli_opt(23, 59, 59, 999)?);
    }

    None
}

/// First day of the month `month0` (0-based, may overflow) of `year`,
/// mirroring JS `new Date(year, month0, 1)`.
fn js_month_start(year: i32, month0: i64) -> Option<NaiveDate> {
    let total_months = i64::from(year) * 12 + month0;
    let y = i32::try_from(total_months.div_euclid(12)).ok()?;
    let m = u32::try_from(total_months.rem_euclid(12) + 1).ok()?;
    NaiveDate::from_ymd_opt(y, m, 1)
}

/// Interpret a naive timestamp in the local timezone. In a DST gap the
/// time is pushed forward one hour (as JS does); if the zone cannot place
/// it at all, UTC is used.
fn local_to_utc(naive: NaiveDateTime) -> Option<DateTime<Utc>> {
    let local = match Local.from_local_datetime(&naive) {
        LocalResult::Single(dt) => dt,
        LocalResult::Ambiguous(earliest, _) => earliest,
        LocalResult::None => match Local.from_local_datetime(&(naive + Duration::hours(1))) {
            LocalResult::Single(dt) | LocalResult::Ambiguous(dt, _) => dt,
            LocalResult::None => return Some(naive.and_utc()),
        },
    };
    Some(local.with_timezone(&Utc))
}

#[cfg(test)]
mod tests;
