//! Ported case-for-case from `tests/unit/services/staleness-detector.test.ts`.

use super::*;
use crate::test_support::{atom, date, AtomBuilder, MockGitClient};
use crate::types::config::StaleConfig;
use crate::util::LoreError;
use chrono::Datelike;

fn config_with(stale: StaleConfig) -> LoreConfig {
    LoreConfig {
        stale,
        ..LoreConfig::default()
    }
}

fn older_than(value: &str) -> LoreConfig {
    config_with(StaleConfig {
        older_than: value.to_owned(),
        ..StaleConfig::default()
    })
}

fn drift_threshold(value: usize) -> LoreConfig {
    config_with(StaleConfig {
        drift_threshold: value,
        ..StaleConfig::default()
    })
}

/// Mirrors `makeAtom`: id `a1b2c3d4`, hash `abc12345`, no files changed.
fn make_atom() -> AtomBuilder {
    atom()
        .hash("abc12345")
        .author("dev@example.com")
        .intent("feat: test commit")
        .files(&[])
}

fn now() -> DateTime<Utc> {
    Utc::now()
}

fn days_ago(days: i64) -> DateTime<Utc> {
    Utc::now() - Duration::days(days)
}

fn years_ago(years: i32) -> DateTime<Utc> {
    let now = Utc::now();
    now.with_year(now.year() - years)
        .unwrap_or_else(|| now - Duration::days(365 * i64::from(years)))
}

fn no_supersession() -> HashMap<String, SupersessionStatus> {
    HashMap::new()
}

fn supersession_map(entries: &[(&str, SupersessionStatus)]) -> HashMap<String, SupersessionStatus> {
    entries
        .iter()
        .map(|(id, status)| (id.to_string(), status.clone()))
        .collect()
}

fn has_signal(report: &StaleAtomReport, signal: StaleSignal) -> bool {
    report.reasons.iter().any(|r| r.signal == signal)
}

fn has_signal_containing(report: &StaleAtomReport, signal: StaleSignal, text: &str) -> bool {
    report
        .reasons
        .iter()
        .any(|r| r.signal == signal && r.description.contains(text))
}

// ---------------------------------------------------------------------------
// describe('age signal')
// ---------------------------------------------------------------------------
mod age_signal {
    use super::*;

    #[test]
    fn should_detect_atoms_older_than_the_configured_threshold() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        // Atom is 1 year old, threshold is 6 months
        let a = make_atom().at(years_ago(1)).build();

        let result = detector.analyze(&[a], &no_supersession());

        assert_eq!(result.len(), 1);
        assert!(has_signal(&result[0], StaleSignal::Age));
    }

    #[test]
    fn should_not_flag_atoms_newer_than_the_threshold() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom().at(days_ago(1)).build();

        let result = detector.analyze(&[a], &no_supersession());

        assert!(result.is_empty());
    }

    #[test]
    fn should_respect_custom_age_threshold() {
        let git = MockGitClient::new();
        let config = older_than("30d");
        let detector = StalenessDetector::new(&git, &config);
        // Atom is 60 days old, threshold is 30 days
        let a = make_atom().at(days_ago(60)).build();

        let result = detector.analyze(&[a], &no_supersession());

        assert_eq!(result.len(), 1);
        assert!(has_signal_containing(
            &result[0],
            StaleSignal::Age,
            "threshold: 30d"
        ));
    }

    #[test]
    fn should_handle_year_duration_format() {
        let git = MockGitClient::new();
        let config = older_than("1y");
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom().at(years_ago(2)).build();

        let result = detector.analyze(&[a], &no_supersession());

        assert_eq!(result.len(), 1);
    }

    #[test]
    fn should_handle_week_duration_format() {
        let git = MockGitClient::new();
        let config = older_than("2w");
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom().at(days_ago(21)).build();

        let result = detector.analyze(&[a], &no_supersession());

        assert_eq!(result.len(), 1);
    }

    // Rust-only: exact wording of the age description.
    #[test]
    fn should_format_the_age_exactly_like_the_typescript_implementation() {
        let git = MockGitClient::new();
        let config = older_than("1d");
        let detector = StalenessDetector::new(&git, &config);
        let now = date("2025-06-01T00:00:00Z");
        let cases = [
            ("2024-01-01T00:00:00Z", "1 year"),
            ("2022-01-01T00:00:00Z", "3 years"),
            ("2025-04-15T00:00:00Z", "1 month"),
            ("2025-03-01T00:00:00Z", "3 months"),
            ("2025-05-22T00:00:00Z", "1 week"),
            ("2025-05-15T00:00:00Z", "2 weeks"),
            ("2025-05-30T00:00:00Z", "2 days"),
            ("2025-05-30T12:00:00Z", "1 day"),
        ];

        for (atom_date, expected) in cases {
            let a = make_atom().date(atom_date).build();
            let result = detector.analyze_at(&[a], &no_supersession(), now);
            assert_eq!(
                result[0].reasons[0].description,
                format!("Atom is {expected} old (threshold: 1d)"),
                "atom dated {atom_date}"
            );
        }
    }

    #[test]
    fn should_default_to_six_months_when_the_duration_is_unparseable() {
        let git = MockGitClient::new();
        let config = older_than("soon");
        let detector = StalenessDetector::new(&git, &config);
        let now = date("2025-06-01T00:00:00Z");

        let fresh = make_atom().at(now - Duration::days(179)).build();
        let stale = make_atom().at(now - Duration::days(181)).build();

        assert!(detector
            .analyze_at(&[fresh], &no_supersession(), now)
            .is_empty());
        assert_eq!(
            detector.analyze_at(&[stale], &no_supersession(), now).len(),
            1
        );
    }
}

// ---------------------------------------------------------------------------
// describe('drift signal')
// ---------------------------------------------------------------------------
mod drift_signal {
    use super::*;

    #[test]
    fn should_detect_files_with_too_many_commits_since_the_atom() {
        let git = MockGitClient::new();
        git.set_count_commits_since(|_, _| Ok(25));
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom().at(now()).files(&["src/auth.ts"]).build();

        let result = detector.analyze(&[a], &no_supersession());

        assert_eq!(result.len(), 1);
        assert!(has_signal(&result[0], StaleSignal::Drift));
        assert!(has_signal_containing(
            &result[0],
            StaleSignal::Drift,
            "25 commits"
        ));
        assert_eq!(
            result[0].reasons[0].description,
            "src/auth.ts has 25 commits since this atom (threshold: 20)"
        );
        assert_eq!(
            git.count_commits_since_calls(),
            vec![("src/auth.ts".to_owned(), "abc12345".to_owned())]
        );
    }

    #[test]
    fn should_not_flag_files_under_the_drift_threshold() {
        let git = MockGitClient::new();
        git.set_count_commits_since(|_, _| Ok(5));
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom().at(now()).files(&["src/auth.ts"]).build();

        let result = detector.analyze(&[a], &no_supersession());

        assert!(result.is_empty());
    }

    #[test]
    fn should_check_drift_for_each_file_in_files_changed() {
        let git = MockGitClient::new();
        // auth.ts: under threshold; db.ts: over threshold
        git.set_count_commits_since(|path, _| Ok(if path == "src/db.ts" { 30 } else { 5 }));
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom()
            .at(now())
            .files(&["src/auth.ts", "src/db.ts"])
            .build();

        let result = detector.analyze(&[a], &no_supersession());

        assert_eq!(result.len(), 1);
        assert!(has_signal_containing(
            &result[0],
            StaleSignal::Drift,
            "src/db.ts"
        ));
        assert_eq!(git.count_commits_since_calls().len(), 2);
    }

    #[test]
    fn should_handle_errors_from_count_commits_since_gracefully() {
        let git = MockGitClient::new();
        git.set_count_commits_since(|_, _| Err(LoreError::git("file not found")));
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom().at(now()).files(&["deleted-file.ts"]).build();

        let result = detector.analyze(&[a], &no_supersession());

        // Should not crash, and should not add a drift reason for the deleted file
        assert!(result.is_empty());
    }

    #[test]
    fn should_respect_custom_drift_threshold() {
        let git = MockGitClient::new();
        git.set_count_commits_since(|_, _| Ok(10));
        let config = drift_threshold(5);
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom().at(now()).files(&["src/auth.ts"]).build();

        let result = detector.analyze(&[a], &no_supersession());

        assert_eq!(result.len(), 1);
        assert!(has_signal_containing(
            &result[0],
            StaleSignal::Drift,
            "threshold: 5"
        ));
    }
}

// ---------------------------------------------------------------------------
// describe('low confidence signal')
// ---------------------------------------------------------------------------
mod low_confidence_signal {
    use super::*;

    #[test]
    fn should_detect_atoms_with_confidence_low() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom()
            .at(now())
            .confidence(ConfidenceLevel::Low)
            .build();

        let result = detector.analyze(&[a], &no_supersession());

        assert_eq!(result.len(), 1);
        assert!(has_signal(&result[0], StaleSignal::LowConfidence));
        assert_eq!(
            result[0].reasons[0].description,
            "Atom is marked as Confidence: low"
        );
    }

    #[test]
    fn should_not_flag_atoms_with_confidence_medium() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom()
            .at(now())
            .confidence(ConfidenceLevel::Medium)
            .build();

        let result = detector.analyze(&[a], &no_supersession());

        assert!(result.is_empty());
    }

    #[test]
    fn should_not_flag_atoms_with_confidence_high() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom()
            .at(now())
            .confidence(ConfidenceLevel::High)
            .build();

        let result = detector.analyze(&[a], &no_supersession());

        assert!(result.is_empty());
    }

    #[test]
    fn should_not_flag_atoms_with_null_confidence() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom().at(now()).build();

        let result = detector.analyze(&[a], &no_supersession());

        assert!(result.is_empty());
    }
}

// ---------------------------------------------------------------------------
// describe('expired hints signal')
// ---------------------------------------------------------------------------
mod expired_hints_signal {
    use super::*;

    #[test]
    fn should_detect_expired_until_yyyy_mm_directives() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom()
            .at(now())
            .directive(&["Migrate to v2 API [until:2024-06]"])
            .build();

        let result = detector.analyze(&[a], &no_supersession());

        assert_eq!(result.len(), 1);
        assert!(has_signal(&result[0], StaleSignal::ExpiredHint));
        assert!(has_signal_containing(
            &result[0],
            StaleSignal::ExpiredHint,
            "until:2024-06"
        ));
        assert_eq!(
            result[0].reasons[0].description,
            "Directive \"Migrate to v2 API [until:2024-06]\" has expired [until:2024-06]"
        );
    }

    #[test]
    fn should_detect_expired_until_yyyy_mm_dd_directives() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom()
            .at(now())
            .directive(&["Remove feature flag [until:2024-01-15]"])
            .build();

        let result = detector.analyze(&[a], &no_supersession());

        assert_eq!(result.len(), 1);
        assert!(has_signal_containing(
            &result[0],
            StaleSignal::ExpiredHint,
            "until:2024-01-15"
        ));
    }

    #[test]
    fn should_not_flag_future_until_directives() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let future = format!("{}-12", Utc::now().year() + 1);
        let a = make_atom()
            .at(now())
            .directive(&[&format!("Migrate to v2 API [until:{future}]")])
            .build();

        let result = detector.analyze(&[a], &no_supersession());

        assert!(result.is_empty());
    }

    #[test]
    fn should_detect_multiple_expired_hints_in_different_directives() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom()
            .at(now())
            .directive(&["Task A [until:2024-01]", "Task B [until:2024-06]"])
            .build();

        let result = detector.analyze(&[a], &no_supersession());

        assert_eq!(result.len(), 1);
        let expired: Vec<_> = result[0]
            .reasons
            .iter()
            .filter(|r| r.signal == StaleSignal::ExpiredHint)
            .collect();
        assert_eq!(expired.len(), 2);
    }

    #[test]
    fn should_handle_directives_without_until_hints() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom()
            .at(now())
            .directive(&[
                "Keep this module small",
                "Prefer composition over inheritance",
            ])
            .build();

        let result = detector.analyze(&[a], &no_supersession());

        assert!(result.is_empty());
    }

    // Rust-only: boundary semantics of the two until formats.
    #[test]
    fn yyyy_mm_expires_at_the_start_of_the_following_month() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom()
            .date("2024-06-01T00:00:00Z")
            .directive(&["x [until:2024-06]"])
            .build();

        // Mid-June: still valid in every timezone.
        assert!(detector
            .analyze_at(
                std::slice::from_ref(&a),
                &no_supersession(),
                date("2024-06-15T12:00:00Z")
            )
            .is_empty());
        // Well into July: expired in every timezone.
        assert_eq!(
            detector
                .analyze_at(&[a], &no_supersession(), date("2024-07-03T12:00:00Z"))
                .len(),
            1
        );
    }

    #[test]
    fn yyyy_mm_dd_expires_at_the_end_of_that_day() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom()
            .date("2024-01-01T00:00:00Z")
            .directive(&["x [until:2024-01-15]"])
            .build();

        assert!(detector
            .analyze_at(
                std::slice::from_ref(&a),
                &no_supersession(),
                date("2024-01-14T00:00:00Z")
            )
            .is_empty());
        assert_eq!(
            detector
                .analyze_at(&[a], &no_supersession(), date("2024-01-17T12:00:00Z"))
                .len(),
            1
        );
    }

    #[test]
    fn month_and_day_overflow_roll_forward_like_js_dates() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);

        // 2024-13 -> start of February 2025
        let month_overflow = make_atom()
            .date("2025-01-01T00:00:00Z")
            .directive(&["x [until:2024-13]"])
            .build();
        assert!(detector
            .analyze_at(
                std::slice::from_ref(&month_overflow),
                &no_supersession(),
                date("2025-01-15T00:00:00Z")
            )
            .is_empty());
        assert_eq!(
            detector
                .analyze_at(
                    &[month_overflow],
                    &no_supersession(),
                    date("2025-02-15T00:00:00Z")
                )
                .len(),
            1
        );

        // 2024-02-31 -> end of March 2nd 2024 (leap year)
        let day_overflow = make_atom()
            .date("2024-01-01T00:00:00Z")
            .directive(&["x [until:2024-02-31]"])
            .build();
        assert!(detector
            .analyze_at(
                std::slice::from_ref(&day_overflow),
                &no_supersession(),
                date("2024-03-01T00:00:00Z")
            )
            .is_empty());
        assert_eq!(
            detector
                .analyze_at(
                    &[day_overflow],
                    &no_supersession(),
                    date("2024-03-05T00:00:00Z")
                )
                .len(),
            1
        );
    }
}

// ---------------------------------------------------------------------------
// describe('orphaned dependency signal')
// ---------------------------------------------------------------------------
mod orphaned_dependency_signal {
    use super::*;

    #[test]
    fn should_detect_dependencies_on_superseded_atoms() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom().at(now()).depends_on(&["bbbb2222"]).build();
        let map = supersession_map(&[("bbbb2222", SupersessionStatus::superseded_by("cccc3333"))]);

        let result = detector.analyze(&[a], &map);

        assert_eq!(result.len(), 1);
        assert!(has_signal(&result[0], StaleSignal::OrphanedDep));
        assert!(has_signal_containing(
            &result[0],
            StaleSignal::OrphanedDep,
            "bbbb2222"
        ));
        assert_eq!(
            result[0].reasons[0].description,
            "Depends on bbbb2222 which is superseded by cccc3333"
        );
    }

    #[test]
    fn should_not_flag_dependencies_on_active_atoms() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom().at(now()).depends_on(&["bbbb2222"]).build();
        let map = supersession_map(&[("bbbb2222", SupersessionStatus::active())]);

        let result = detector.analyze(&[a], &map);

        assert!(result.is_empty());
    }

    #[test]
    fn should_not_flag_dependencies_on_unknown_atoms() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom().at(now()).depends_on(&["bbbb2222"]).build();

        let result = detector.analyze(&[a], &no_supersession());

        assert!(result.is_empty());
    }

    #[test]
    fn should_detect_multiple_orphaned_dependencies() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom()
            .at(now())
            .depends_on(&["bbbb2222", "cccc3333"])
            .build();
        let map = supersession_map(&[
            ("bbbb2222", SupersessionStatus::superseded_by("dddd4444")),
            ("cccc3333", SupersessionStatus::superseded_by("eeee5555")),
        ]);

        let result = detector.analyze(&[a], &map);

        assert_eq!(result.len(), 1);
        let orphans: Vec<_> = result[0]
            .reasons
            .iter()
            .filter(|r| r.signal == StaleSignal::OrphanedDep)
            .collect();
        assert_eq!(orphans.len(), 2);
    }

    #[test]
    fn should_skip_invalid_lore_id_references_in_depends_on() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom().at(now()).depends_on(&["not-valid-id"]).build();
        let map = supersession_map(&[(
            "not-valid-id",
            SupersessionStatus::superseded_by("aaaa1111"),
        )]);

        let result = detector.analyze(&[a], &map);

        assert!(result.is_empty());
    }
}

// ---------------------------------------------------------------------------
// describe('combined signals')
// ---------------------------------------------------------------------------
mod combined_signals {
    use super::*;

    #[test]
    fn should_report_multiple_staleness_reasons_for_one_atom() {
        let git = MockGitClient::new();
        git.set_count_commits_since(|_, _| Ok(30));
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom()
            .at(years_ago(2))
            .confidence(ConfidenceLevel::Low)
            .directive(&["Remove flag [until:2024-01]"])
            .files(&["src/auth.ts"])
            .depends_on(&["bbbb2222"])
            .build();
        let map = supersession_map(&[("bbbb2222", SupersessionStatus::superseded_by("cccc3333"))]);

        let result = detector.analyze(&[a], &map);

        assert_eq!(result.len(), 1);
        // All 5 signals
        assert!(has_signal(&result[0], StaleSignal::Age));
        assert!(has_signal(&result[0], StaleSignal::Drift));
        assert!(has_signal(&result[0], StaleSignal::LowConfidence));
        assert!(has_signal(&result[0], StaleSignal::ExpiredHint));
        assert!(has_signal(&result[0], StaleSignal::OrphanedDep));
        // Reported in signal order.
        let signals: Vec<StaleSignal> = result[0].reasons.iter().map(|r| r.signal).collect();
        assert_eq!(
            signals,
            vec![
                StaleSignal::Age,
                StaleSignal::Drift,
                StaleSignal::LowConfidence,
                StaleSignal::ExpiredHint,
                StaleSignal::OrphanedDep,
            ]
        );
    }

    #[test]
    fn should_not_report_atoms_with_no_staleness_signals() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let a = make_atom().at(now()).build();

        let result = detector.analyze(&[a], &no_supersession());

        assert!(result.is_empty());
    }

    #[test]
    fn should_analyze_multiple_atoms_independently() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);
        let stale = make_atom().id("aaaa1111").at(years_ago(1)).build();
        let fresh = make_atom().id("bbbb2222").at(now()).build();

        let result = detector.analyze(&[stale, fresh], &no_supersession());

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].atom.lore_id, "aaaa1111");
    }

    #[test]
    fn should_handle_empty_atom_list() {
        let git = MockGitClient::new();
        let config = LoreConfig::default();
        let detector = StalenessDetector::new(&git, &config);

        let result = detector.analyze(&[], &no_supersession());

        assert!(result.is_empty());
    }
}
