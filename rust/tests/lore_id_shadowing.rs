//! Port of `tests/integration/lore-id-shadowing.integration.test.ts`: a
//! real-git reproduction of issue #57 (Lore-id poisoning).
//!
//! A future-dated commit on a side branch shares a Lore-id with a commit on
//! the current branch. `lore trace` must resolve to the HEAD-reachable atom,
//! `lore doctor` must stay silent by default, and `lore doctor --all` must
//! report the cross-ref duplicate. A Lore-id that exists only on a side
//! branch must still resolve via the `--all` fallback.

use std::fs;
use std::path::Path;
use std::process::Command as Proc;

use assert_cmd::Command;
use lore::services::atom_repository::AtomRepository;
use lore::services::git_client::ProcessGitClient;
use lore::services::trailer_parser::TrailerParser;
use serde_json::Value;
use tempfile::TempDir;

/// Fixed past date for every commit unless overridden per commit.
const PAST_DATE: &str = "2024-06-01T00:00:00Z";
const FUTURE_DATE: &str = "2030-01-01T00:00:00Z";

struct Fixture {
    root: TempDir,
    legit: String,
    side: String,
}

/// Isolates git from the developer's global config (signing, hooks, templates).
fn git_env(root: &Path) -> Vec<(&'static str, String)> {
    let empty_config = root.join(".empty-gitconfig");
    if !empty_config.exists() {
        fs::write(&empty_config, "").expect("write config");
    }
    vec![
        ("GIT_CONFIG_GLOBAL", empty_config.display().to_string()),
        ("GIT_CONFIG_NOSYSTEM", "1".to_owned()),
        ("GIT_AUTHOR_NAME", "Lore Test".to_owned()),
        ("GIT_AUTHOR_EMAIL", "lore@example.com".to_owned()),
        ("GIT_COMMITTER_NAME", "Lore Test".to_owned()),
        ("GIT_COMMITTER_EMAIL", "lore@example.com".to_owned()),
        ("LORE_NO_UPDATE_CHECK", "1".to_owned()),
    ]
}

fn git(root: &Path, args: &[&str], date: &str) -> String {
    let output = Proc::new("git")
        .args(args)
        .current_dir(root)
        .envs(git_env(root))
        .env("GIT_AUTHOR_DATE", date)
        .env("GIT_COMMITTER_DATE", date)
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn init_repo(root: &Path) {
    git(root, &["init", "-q"], PAST_DATE);
    git(
        root,
        &["symbolic-ref", "HEAD", "refs/heads/main"],
        PAST_DATE,
    );
}

fn commit(root: &Path, file: &str, message: &str, date: &str) -> String {
    let full = root.join(file);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).expect("mkdir");
    }
    fs::write(&full, format!("{message}\n")).expect("write");
    git(root, &["add", "-A"], date);
    git(root, &["commit", "-q", "-m", message], date);
    git(root, &["rev-parse", "HEAD"], date).trim().to_owned()
}

impl Fixture {
    fn new() -> Fixture {
        let root = tempfile::tempdir().expect("tempdir");
        let path = root.path();
        init_repo(path);

        // Non-Lore base commit on main.
        commit(path, "README.md", "chore: initial commit", PAST_DATE);

        // Side branch carries a future-dated poison atom sharing the Lore-id.
        git(path, &["checkout", "-q", "-b", "poison-branch"], PAST_DATE);
        commit(
            path,
            "poison/decision.md",
            "feat: poison atom\n\nLore-id: deadbeef\nConfidence: high",
            FUTURE_DATE,
        );

        // Back on main: the legitimate atom with the same Lore-id, older date.
        git(path, &["checkout", "-q", "main"], PAST_DATE);
        let legit = commit(
            path,
            "docs/decision.md",
            "feat: legit atom\n\nLore-id: deadbeef\nConfidence: high",
            PAST_DATE,
        );

        // Another side branch with a Lore-id that only exists off main.
        git(path, &["checkout", "-q", "-b", "side-branch"], PAST_DATE);
        let side = commit(
            path,
            "side/decision.md",
            "feat: side atom\n\nLore-id: cafe1234\nConfidence: high",
            PAST_DATE,
        );

        // Final state: on main, both side branches ahead of it.
        git(path, &["checkout", "-q", "main"], PAST_DATE);
        Fixture { root, legit, side }
    }

    fn client(&self) -> ProcessGitClient {
        ProcessGitClient::new(Some(self.root.path().to_path_buf()))
    }

    fn lore_json(&self, args: &[&str]) -> Value {
        let output = Command::cargo_bin("lore")
            .expect("lore binary built")
            .current_dir(self.root.path())
            .envs(git_env(self.root.path()))
            .args(args)
            .arg("--json")
            .output()
            .expect("lore runs");
        serde_json::from_slice(&output.stdout).unwrap_or_else(|e| {
            panic!(
                "invalid JSON ({e}): {}",
                String::from_utf8_lossy(&output.stdout)
            )
        })
    }

    fn doctor_check(&self, args: &[&str], name: &str) -> Value {
        let output = self.lore_json(args);
        output["checks"]
            .as_array()
            .expect("checks")
            .iter()
            .find(|c| c["name"] == name)
            .cloned()
            .unwrap_or_else(|| panic!("no {name} check in {output}"))
    }
}

// ---- lore trace with a poisoned Lore-id (issue #57) -----------------------

#[test]
fn resolves_the_shared_lore_id_to_the_head_reachable_atom_not_the_future_dated_side_branch() {
    let fixture = Fixture::new();
    let client = fixture.client();
    let parser = TrailerParser::new();
    let repo = AtomRepository::new(&client, &parser, Vec::new());

    let atom = repo
        .find_by_lore_id("deadbeef")
        .expect("lookup")
        .expect("atom");

    assert_eq!(atom.commit_hash, fixture.legit);
    assert_eq!(atom.intent, "feat: legit atom");
}

#[test]
fn prints_the_head_reachable_atom_as_the_trace_root() {
    let fixture = Fixture::new();

    let result = fixture.lore_json(&["trace", "deadbeef"]);

    assert_eq!(result["root"]["commit"], fixture.legit.as_str());
    assert_eq!(result["root"]["intent"], "feat: legit atom");
}

#[test]
fn still_resolves_a_lore_id_that_exists_only_on_a_side_branch_fallback() {
    let fixture = Fixture::new();
    let client = fixture.client();
    let parser = TrailerParser::new();
    let repo = AtomRepository::new(&client, &parser, Vec::new());

    let atom = repo
        .find_by_lore_id("cafe1234")
        .expect("lookup")
        .expect("atom");

    assert_eq!(atom.commit_hash, fixture.side);
}

// ---- lore_id_index with side branches (delta pass, real git) --------------

#[test]
fn indexes_head_reachable_and_side_branch_only_ids_head_winning_shared_ones() {
    let fixture = Fixture::new();
    let client = fixture.client();
    let parser = TrailerParser::new();
    let repo = AtomRepository::new(&client, &parser, Vec::new());

    let index = repo.lore_id_index().expect("index");

    // Shared id: the HEAD-reachable atom wins over the future-dated poison.
    assert_eq!(
        index.get("deadbeef").map(|a| a.commit_hash.as_str()),
        Some(fixture.legit.as_str())
    );
    // Side-branch-only id: still indexed.
    assert_eq!(
        index.get("cafe1234").map(|a| a.commit_hash.as_str()),
        Some(fixture.side.as_str())
    );
    assert_eq!(index.len(), 2);
}

// ---- lore lookups on a fresh repository (unborn HEAD) ---------------------

#[test]
fn return_null_and_an_empty_index_instead_of_failing() {
    let fresh = tempfile::tempdir().expect("tempdir");
    init_repo(fresh.path());
    let client = ProcessGitClient::new(Some(fresh.path().to_path_buf()));
    let parser = TrailerParser::new();
    let repo = AtomRepository::new(&client, &parser, Vec::new());

    assert!(repo.find_by_lore_id("deadbeef").expect("lookup").is_none());
    assert_eq!(repo.lore_id_index().expect("index").len(), 0);
}

// ---- lore doctor with a poisoned Lore-id (issue #57) ----------------------

#[test]
fn stays_silent_about_the_duplicate_by_default_current_branch_only() {
    let fixture = Fixture::new();

    let uniqueness = fixture.doctor_check(&["doctor"], "Lore-id uniqueness");

    assert_eq!(uniqueness["status"], "ok");
    assert_eq!(uniqueness["details"], Value::Array(Vec::new()));
}

#[test]
fn all_reports_the_lore_id_duplicated_across_refs() {
    let fixture = Fixture::new();

    let uniqueness = fixture.doctor_check(&["doctor", "--all"], "Lore-id uniqueness (all refs)");

    assert_eq!(uniqueness["status"], "warning");
    assert!(uniqueness["details"]
        .as_array()
        .expect("details")
        .iter()
        .any(|d| d.as_str().is_some_and(|d| d.contains("deadbeef"))));
}
