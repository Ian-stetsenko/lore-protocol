//! Port of `tests/unit/commands/doctor.test.ts` (issue #57): cross-ref
//! Lore-id duplicates are reported only with `--all`; the default stays
//! current-branch only.

use std::path::PathBuf;

use super::*;
use crate::formatters::json_formatter::JsonFormatter;
use crate::interfaces::git_client::RawCommit;
use crate::services::trailer_parser::TrailerParser;
use crate::test_support::{atom, raw_commit, MockGitClient};
use crate::types::config::LoreConfig;
use serde_json::Value;

/// A config loader that finds no config file.
struct NoConfigLoader;

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

fn run_doctor(git: &MockGitClient, all: bool) -> Vec<Value> {
    let parser = TrailerParser::new();
    let repo = AtomRepository::new(git, &parser, Vec::new());
    let formatter = JsonFormatter::new();
    let deps = DoctorDeps {
        atom_repository: &repo,
        config_loader: &NoConfigLoader,
        formatter: &formatter,
        cwd: Path::new("."),
    };
    let mut out = Vec::new();
    let mut err = Vec::new();
    let mut io = Io::new(&mut out, &mut err);
    run(&DoctorArgs { all }, &deps, &mut io).expect("doctor runs");
    let output: Value = serde_json::from_slice(&out).expect("json output");
    output["checks"].as_array().expect("checks").clone()
}

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
fn references_and_orphans_are_detected() {
    let atoms = vec![
        atom().id("aaaa1111").build(),
        atom()
            .id("bbbb2222")
            .supersedes(&["aaaa1111"])
            .related(&["ffff9999", "not-an-id"])
            .build(),
        atom().id("cccc3333").depends_on(&["aaaa1111"]).build(),
    ];
    let refs = check_references_resolve(&atoms);
    assert_eq!(refs.status, DoctorStatus::Warning);
    assert_eq!(
        refs.details,
        vec!["Lore-id \"ffff9999\" referenced by bbbb2222 (Related) not found"]
    );
    let orphans = check_orphaned_dependencies(&atoms);
    assert_eq!(orphans.status, DoctorStatus::Info);
    assert_eq!(
        orphans.details,
        vec!["Atom cccc3333 depends on aaaa1111, which has been superseded"]
    );
    assert_eq!(
        check_references_resolve(&atoms[..1]).status,
        DoctorStatus::Ok
    );
    assert_eq!(
        check_orphaned_dependencies(&atoms[..1]).status,
        DoctorStatus::Ok
    );
}
