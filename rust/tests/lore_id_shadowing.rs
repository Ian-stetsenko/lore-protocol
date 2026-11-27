//! Port of `tests/integration/lore-id-shadowing.integration.test.ts`: a
//! real-git reproduction of issue #57 (Lore-id poisoning).
//!
//! A future-dated commit on a side branch shares a Lore-id with a commit on
//! the current branch. `lore trace` must resolve to the HEAD-reachable atom,
//! `lore doctor` must stay silent by default, and `lore doctor --all` must
//! report the cross-ref duplicate. A Lore-id that exists only on a side
//! branch must still resolve via the `--all` fallback.

mod common;

use common::Repo;
use lore::services::atom_repository::AtomRepository;
use lore::services::git_client::ProcessGitClient;
use lore::services::trailer_parser::TrailerParser;
use serde_json::Value;

/// Fixed past date for every commit unless overridden per commit.
const PAST_DATE: &str = "2024-06-01T00:00:00Z";
const FUTURE_DATE: &str = "2030-01-01T00:00:00Z";

struct Fixture {
    repo: Repo,
    legit: String,
    side: String,
}

impl Fixture {
    fn new() -> Fixture {
        let repo = Repo::new();

        // Non-Lore base commit on main.
        repo.commit_at("README.md", "chore: initial commit", PAST_DATE);

        // Side branch carries a future-dated poison atom sharing the Lore-id.
        repo.git(&["checkout", "-q", "-b", "poison-branch"]);
        repo.commit_at(
            "poison/decision.md",
            "feat: poison atom\n\nLore-id: deadbeef\nConfidence: high",
            FUTURE_DATE,
        );

        // Back on main: the legitimate atom with the same Lore-id, older date.
        repo.git(&["checkout", "-q", "main"]);
        let legit = repo.commit_at(
            "docs/decision.md",
            "feat: legit atom\n\nLore-id: deadbeef\nConfidence: high",
            PAST_DATE,
        );

        // Another side branch with a Lore-id that only exists off main.
        repo.git(&["checkout", "-q", "-b", "side-branch"]);
        let side = repo.commit_at(
            "side/decision.md",
            "feat: side atom\n\nLore-id: cafe1234\nConfidence: high",
            PAST_DATE,
        );

        // Final state: on main, both side branches ahead of it.
        repo.git(&["checkout", "-q", "main"]);
        Fixture { repo, legit, side }
    }

    fn client(&self) -> ProcessGitClient {
        ProcessGitClient::new(Some(self.repo.path().to_path_buf()))
    }

    fn lore_json(&self, args: &[&str]) -> Value {
        let output = self
            .repo
            .lore()
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
    let fresh = Repo::new();
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
