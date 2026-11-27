//! Port of `tests/unit/commands/doctor.test.ts`: cross-ref Lore-id
//! duplicates are reported only with `--all` (issue #57), and reference
//! resolution is split by trailer severity across every ref (#81).
//!
//! The TS suite mocks `AtomRepository`; here the real repository runs over a
//! scripted git client. The doctor scan is the `--max-count` query, and every
//! other `log` call is the Lore-id index build.

use std::path::PathBuf;

use super::*;
use crate::formatters::json_formatter::JsonFormatter;
use crate::formatters::text_formatter::TextFormatter;
use crate::interfaces::git_client::RawCommit;
use crate::services::trailer_parser::TrailerParser;
use crate::test_support::{atom, raw_commit, MockGitClient};
use crate::types::config::LoreConfig;
use crate::util::LoreError;
use serde_json::Value;

/// A config loader that finds no config file.
struct NoConfigLoader;

/// A config loader that finds a config file and either parses or rejects it.
struct FoundConfigLoader {
    is_valid: bool,
}

impl ConfigLoader for FoundConfigLoader {
    fn load_for_path(&self, _target_path: &Path) -> Result<LoreConfig> {
        Ok(LoreConfig::default())
    }

    fn load_from_file(&self, _config_path: &Path) -> Result<LoreConfig> {
        if self.is_valid {
            Ok(LoreConfig::default())
        } else {
            Err(LoreError::new("invalid TOML"))
        }
    }

    fn find_config_path(&self, _start_path: &Path) -> Result<Option<PathBuf>> {
        Ok(Some(PathBuf::from("/repo/.lore/config.toml")))
    }
}

impl ConfigLoader for NoConfigLoader {
    fn load_for_path(&self, _target_path: &Path) -> Result<LoreConfig> {
        Ok(LoreConfig::default())
    }

    fn load_from_file(&self, _config_path: &Path) -> Result<LoreConfig> {
        Ok(LoreConfig::default())
    }

    fn find_config_path(&self, _start_path: &Path) -> Result<Option<PathBuf>> {
        Ok(None)
    }
}

fn lore_commit(lore_id: &str) -> RawCommit {
    raw_commit()
        .hash(&format!("hash-{lore_id}"))
        .trailers(&format!("Lore-id: {lore_id}"))
        .build()
}

/// Runs doctor and returns its stdout and exit code.
fn run_doctor_formatted(
    git: &MockGitClient,
    formatter: &dyn OutputFormatter,
    config_loader: &dyn ConfigLoader,
    all: bool,
) -> (String, i32) {
    let parser = TrailerParser::new();
    let repo = AtomRepository::new(git, &parser, Vec::new());
    let deps = DoctorDeps {
        atom_repository: &repo,
        config_loader,
        formatter,
        cwd: Path::new("."),
    };
    let mut out = Vec::new();
    let mut err = Vec::new();
    let mut io = Io::new(&mut out, &mut err);
    let code = run(&DoctorArgs { all }, &deps, &mut io).expect("doctor runs");
    (String::from_utf8_lossy(&out).into_owned(), code)
}

/// Runs doctor with JSON output and returns the parsed result and exit code.
fn run_doctor_json(git: &MockGitClient, config_loader: &dyn ConfigLoader) -> (Value, i32) {
    let (out, code) = run_doctor_formatted(git, &JsonFormatter::new(), config_loader, false);
    (serde_json::from_str(&out).expect("json output"), code)
}

fn run_doctor(git: &MockGitClient, all: bool) -> Vec<Value> {
    let (out, _) = run_doctor_formatted(git, &JsonFormatter::new(), &NoConfigLoader, all);
    let output: Value = serde_json::from_str(&out).expect("json output");
    output["checks"].as_array().expect("checks").clone()
}

/// An atom citing `refs` as (trailer key, id) pairs.
fn referencing_commit(lore_id: &str, refs: &[(&str, &str)]) -> RawCommit {
    let mut trailers = format!("Lore-id: {lore_id}");
    for (key, id) in refs {
        trailers.push_str(&format!("\n{key}: {id}"));
    }
    raw_commit()
        .hash(&format!("hash-{lore_id}"))
        .trailers(&trailers)
        .build()
}

fn is_scan(args: &[String]) -> bool {
    args.iter().any(|a| a.starts_with("--max-count="))
}

/// History where the doctor scan sees `scanned` and the Lore-id index
/// holds `indexed`.
fn git_with(scanned: Vec<RawCommit>, indexed: Vec<RawCommit>) -> MockGitClient {
    let git = MockGitClient::new();
    git.set_log(move |args, _| {
        Ok(if is_scan(args) {
            scanned.clone()
        } else {
            indexed.clone()
        })
    });
    git
}

/// Index builds: every `log` call that is not the doctor scan.
fn index_reads(git: &MockGitClient) -> usize {
    git.log_calls()
        .iter()
        .filter(|(args, _)| !is_scan(args))
        .count()
}

fn find_named<'a>(checks: &'a [Value], name: &str) -> Option<&'a Value> {
    checks.iter().find(|c| c["name"] == name)
}

const WARNING_CHECK: &str = "Reference resolution (supersedes/depends-on)";
const RELATED_CHECK: &str = "Reference resolution (related)";

fn find_check<'a>(checks: &'a [Value], name: &str) -> &'a Value {
    checks
        .iter()
        .find(|c| c["name"] == name)
        .unwrap_or_else(|| panic!("no {name} check in {checks:?}"))
}

fn log_args(git: &MockGitClient) -> Vec<Vec<String>> {
    git.log_calls().into_iter().map(|(args, _)| args).collect()
}

#[test]
fn scans_only_the_current_branch_by_default() {
    let git = MockGitClient::new();

    let checks = run_doctor(&git, false);

    assert_eq!(log_args(&git), vec![vec!["--max-count=10000".to_owned()]]);
    let uniqueness = checks
        .iter()
        .find(|c| {
            c["name"]
                .as_str()
                .is_some_and(|n| n.starts_with("Lore-id uniqueness"))
        })
        .expect("uniqueness check");
    assert_eq!(uniqueness["name"], "Lore-id uniqueness");
    assert_eq!(uniqueness["status"], "ok");
}

#[test]
fn all_scans_every_ref_and_reports_cross_ref_duplicate_lore_ids_issue_57() {
    let git = MockGitClient::new();
    git.set_log(|args, _| {
        Ok(if args.iter().any(|a| a == "--all") {
            // Two atoms sharing one Lore-id: one on the branch, one on a ref.
            vec![lore_commit("deadbeef"), lore_commit("deadbeef")]
        } else {
            vec![lore_commit("deadbeef")]
        })
    });

    let checks = run_doctor(&git, true);

    assert_eq!(
        log_args(&git),
        vec![
            vec!["--max-count=10000".to_owned()],
            vec!["--all".to_owned(), "--max-count=10000".to_owned()],
        ]
    );
    let uniqueness = find_check(&checks, "Lore-id uniqueness (all refs)");
    assert_eq!(uniqueness["status"], "warning");
    assert!(uniqueness["details"]
        .as_array()
        .expect("details")
        .contains(&Value::from("Lore-id \"deadbeef\" appears 2 times")));
}

#[test]
fn all_with_no_cross_ref_duplicates_stays_ok() {
    let git = MockGitClient::new();
    git.set_log_result(vec![lore_commit("deadbeef")]);

    let checks = run_doctor(&git, true);

    assert_eq!(
        find_check(&checks, "Lore-id uniqueness (all refs)")["status"],
        "ok"
    );
}

// ---- check helpers (Rust-only coverage) ----------------------------------

#[test]
fn uniqueness_reports_duplicates_in_first_seen_order() {
    let atoms = vec![
        atom().id("aaaa1111").build(),
        atom().id("bbbb2222").build(),
        atom().id("aaaa1111").build(),
        atom().id("bbbb2222").build(),
        atom().id("bbbb2222").build(),
    ];
    let check = check_lore_id_uniqueness(&atoms, false);
    assert_eq!(check.status, DoctorStatus::Warning);
    assert_eq!(check.message, "2 duplicate Lore-id(s) found");
    assert_eq!(
        check.details,
        vec![
            "Lore-id \"aaaa1111\" appears 2 times",
            "Lore-id \"bbbb2222\" appears 3 times"
        ]
    );
    let ok = check_lore_id_uniqueness(&atoms[..2], false);
    assert_eq!(ok.status, DoctorStatus::Ok);
    assert_eq!(ok.message, "All 2 Lore-ids are unique");
}

#[test]
fn orphans_are_detected() {
    let atoms = vec![
        atom().id("aaaa1111").build(),
        atom()
            .id("bbbb2222")
            .supersedes(&["aaaa1111"])
            .related(&["ffff9999", "not-an-id"])
            .build(),
        atom().id("cccc3333").depends_on(&["aaaa1111"]).build(),
    ];
    let orphans = check_orphaned_dependencies(&atoms);
    assert_eq!(orphans.status, DoctorStatus::Info);
    assert_eq!(
        orphans.details,
        vec!["Atom cccc3333 depends on aaaa1111, which has been superseded"]
    );
    assert_eq!(
        check_orphaned_dependencies(&atoms[..1]).status,
        DoctorStatus::Ok
    );
}

// ---- reference resolution split by severity (#81) ------------------------

#[test]
fn accepts_a_reference_that_resolves_only_on_a_non_head_ref_via_the_shared_index() {
    // The branch scan carries the referencing atom but not the referenced
    // id; the all-refs index resolves it.
    let git = git_with(
        vec![referencing_commit("aaaa1111", &[("Related", "bbbb2222")])],
        vec![lore_commit("bbbb2222")],
    );

    let (result, code) = run_doctor_json(&git, &NoConfigLoader);

    let checks = result["checks"].as_array().expect("checks");
    let references = find_check(checks, WARNING_CHECK);
    assert_eq!(references["status"], "ok");
    assert_eq!(references["details"], Value::Array(Vec::new()));
    // No dangling Related findings: the info check is not pushed at all.
    assert!(find_named(checks, RELATED_CHECK).is_none());
    assert_eq!(code, 0);
}

#[test]
fn never_builds_the_lore_id_index_for_a_reference_free_corpus() {
    let git = git_with(vec![lore_commit("deadbeef")], vec![]);

    run_doctor(&git, false);

    assert_eq!(index_reads(&git), 0);
}

#[test]
fn builds_the_lore_id_index_once_when_a_scanned_atom_carries_a_reference_id() {
    let git = git_with(
        vec![referencing_commit(
            "aaaa1111",
            &[("Supersedes", "bbbb2222")],
        )],
        vec![lore_commit("bbbb2222")],
    );

    run_doctor(&git, false);

    // One build: the pinned HEAD pass plus the --all delta pass.
    assert_eq!(index_reads(&git), 2);
}

#[test]
fn reports_one_skipped_check_not_an_error_when_the_index_build_fails() {
    let scanned = vec![referencing_commit("aaaa1111", &[("Related", "bbbb2222")])];
    let git = MockGitClient::new();
    git.set_log(move |args, _| {
        if is_scan(args) {
            Ok(scanned.clone())
        } else {
            Err(LoreError::git("git failed"))
        }
    });

    let (result, code) = run_doctor_json(&git, &NoConfigLoader);

    let checks = result["checks"].as_array().expect("checks");
    let skipped: Vec<_> = checks
        .iter()
        .filter(|c| c["name"] == "Reference resolution (skipped)")
        .collect();
    assert_eq!(skipped.len(), 1);
    assert_eq!(skipped[0]["status"], "warning");
    assert_eq!(
        skipped[0]["message"],
        "reference check skipped: Lore-id index unavailable"
    );
    assert_eq!(skipped[0]["details"], Value::Array(Vec::new()));
    // Neither split reference check ran alongside the skipped one.
    assert!(find_named(checks, WARNING_CHECK).is_none());
    assert!(find_named(checks, RELATED_CHECK).is_none());
    // Remaining checks still ran; the exit contract is errors-only.
    let names: Vec<&str> = checks.iter().filter_map(|c| c["name"].as_str()).collect();
    assert_eq!(
        names[..3],
        [
            "Config file",
            "Lore-id uniqueness",
            "Reference resolution (skipped)"
        ]
    );
    assert_eq!(names.len(), 4);
    assert_eq!(code, 0);
}

#[test]
fn reports_dangling_related_references_under_the_info_check_with_the_warning_check_ok() {
    let git = git_with(
        vec![referencing_commit("aaaa1111", &[("Related", "cccc3333")])],
        vec![],
    );

    let (result, code) = run_doctor_json(&git, &NoConfigLoader);

    let checks = result["checks"].as_array().expect("checks");
    let related = find_check(checks, RELATED_CHECK);
    assert_eq!(related["status"], "info");
    assert!(!related["message"].as_str().unwrap_or("").is_empty());
    assert_eq!(
        related["details"],
        serde_json::json!(["Lore-id \"cccc3333\" referenced by aaaa1111 (Related) not found"])
    );
    // Only Related dangles: the warning-severity check stays present, ok.
    let warning = find_check(checks, WARNING_CHECK);
    assert_eq!(warning["status"], "ok");
    assert_eq!(
        warning["message"],
        "All references resolve to existing atoms"
    );
    assert_eq!(warning["details"], Value::Array(Vec::new()));
    assert_eq!(code, 0);
}

#[test]
fn reports_dangling_supersedes_references_under_the_warning_check() {
    let git = git_with(
        vec![referencing_commit(
            "aaaa1111",
            &[("Supersedes", "cccc3333")],
        )],
        vec![],
    );

    let (result, code) = run_doctor_json(&git, &NoConfigLoader);

    let checks = result["checks"].as_array().expect("checks");
    let warning = find_check(checks, WARNING_CHECK);
    assert_eq!(warning["status"], "warning");
    assert_eq!(warning["message"], "1 broken reference(s) found");
    assert_eq!(
        warning["details"],
        serde_json::json!(["Lore-id \"cccc3333\" referenced by aaaa1111 (Supersedes) not found"])
    );
    // Nothing dangles in the info class: no info check is pushed.
    assert!(find_named(checks, RELATED_CHECK).is_none());
    assert_eq!(code, 0);
}

#[test]
fn reports_dangling_depends_on_references_under_the_warning_check() {
    let git = git_with(
        vec![referencing_commit(
            "aaaa1111",
            &[("Depends-on", "cccc3333")],
        )],
        vec![],
    );

    let (result, code) = run_doctor_json(&git, &NoConfigLoader);

    let checks = result["checks"].as_array().expect("checks");
    let warning = find_check(checks, WARNING_CHECK);
    assert_eq!(warning["status"], "warning");
    assert_eq!(warning["message"], "1 broken reference(s) found");
    assert_eq!(
        warning["details"],
        serde_json::json!(["Lore-id \"cccc3333\" referenced by aaaa1111 (Depends-on) not found"])
    );
    assert_eq!(code, 0);
}

#[test]
fn counts_the_severity_classes_separately_in_the_summary_mixed_corpus() {
    let git = git_with(
        vec![
            referencing_commit("aaaa1111", &[("Supersedes", "cccc3333")]),
            referencing_commit("dddd4444", &[("Related", "eeee5555")]),
        ],
        vec![],
    );
    // An ok Config check keeps the summary scoped to the two reference
    // severity classes under assertion.
    let (result, code) = run_doctor_json(&git, &FoundConfigLoader { is_valid: true });

    assert_eq!(
        result["summary"],
        serde_json::json!({"errors": 0, "warnings": 1, "info": 1})
    );
    let checks = result["checks"].as_array().expect("checks");
    let warning = find_check(checks, WARNING_CHECK);
    assert_eq!(warning["status"], "warning");
    assert_eq!(warning["message"], "1 broken reference(s) found");
    assert_eq!(
        warning["details"],
        serde_json::json!(["Lore-id \"cccc3333\" referenced by aaaa1111 (Supersedes) not found"])
    );
    let related = find_check(checks, RELATED_CHECK);
    assert_eq!(related["status"], "info");
    assert_eq!(
        related["details"],
        serde_json::json!(["Lore-id \"eeee5555\" referenced by dddd4444 (Related) not found"])
    );
    assert_eq!(code, 0);
}

#[test]
fn prints_no_empty_info_check_or_line_for_a_clean_corpus_json_and_text() {
    let git = git_with(
        vec![referencing_commit("aaaa1111", &[("Related", "bbbb2222")])],
        vec![lore_commit("bbbb2222")],
    );

    let checks = run_doctor(&git, false);
    assert!(find_named(&checks, RELATED_CHECK).is_none());
    let reference_checks: Vec<_> = checks
        .iter()
        .filter(|c| {
            c["name"]
                .as_str()
                .is_some_and(|n| n.starts_with("Reference resolution"))
        })
        .collect();
    assert_eq!(reference_checks.len(), 1);
    assert_eq!(reference_checks[0]["status"], "ok");

    let (text, _) = run_doctor_formatted(&git, &TextFormatter::new(false), &NoConfigLoader, false);
    assert!(!text.contains(RELATED_CHECK));
    assert!(text.contains(WARNING_CHECK));
}

#[test]
fn still_audits_references_carried_by_superseded_atoms_history_integrity() {
    // dddd4444 supersedes aaaa1111; the superseded atom still carries a
    // dangling Related, which must report under its severity class.
    let git = git_with(
        vec![
            referencing_commit("aaaa1111", &[("Related", "cccc3333")]),
            referencing_commit("dddd4444", &[("Supersedes", "aaaa1111")]),
        ],
        vec![lore_commit("aaaa1111")],
    );

    let (result, code) = run_doctor_json(&git, &NoConfigLoader);

    let checks = result["checks"].as_array().expect("checks");
    let related = find_check(checks, RELATED_CHECK);
    assert_eq!(related["status"], "info");
    assert_eq!(
        related["details"],
        serde_json::json!(["Lore-id \"cccc3333\" referenced by aaaa1111 (Related) not found"])
    );
    assert_eq!(find_check(checks, WARNING_CHECK)["status"], "ok");
    assert_eq!(code, 0);
}

#[test]
fn keeps_the_errors_only_exit_contract_with_error_warning_and_info_together() {
    // A rejecting config loader trips the Config error check while the
    // reference split contributes one warning and one info.
    let git = git_with(
        vec![
            referencing_commit("aaaa1111", &[("Supersedes", "cccc3333")]),
            referencing_commit("dddd4444", &[("Related", "eeee5555")]),
        ],
        vec![],
    );

    let (result, code) = run_doctor_json(&git, &FoundConfigLoader { is_valid: false });

    assert_eq!(
        result["summary"],
        serde_json::json!({"errors": 1, "warnings": 1, "info": 1})
    );
    let checks = result["checks"].as_array().expect("checks");
    assert_eq!(find_check(checks, "Config file")["status"], "error");
    // Warnings and info never fail the run; the error alone sets exit 1.
    assert_eq!(code, 1);
}
