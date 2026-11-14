//! Port of `tests/unit/commands/trace.test.ts`: the root resolves via a
//! targeted grep, edges via the shared Lore-id index, built lazily.

use super::*;
use crate::cli::{Cli, Command};
use crate::formatters::json_formatter::JsonFormatter;
use crate::interfaces::git_client::RawCommit;
use crate::services::trailer_parser::TrailerParser;
use crate::test_support::{raw_commit, MockGitClient};
use clap::Parser;
use serde_json::Value;

fn parse(args: &[&str]) -> TraceArgs {
    let cli = Cli::try_parse_from(["lore", "trace"].iter().chain(args)).expect("valid args");
    match cli.command {
        Command::Trace(a) => a,
        other => panic!("unexpected {other:?}"),
    }
}

fn commit(id: &str, related: &[&str]) -> RawCommit {
    let mut trailers = format!("Lore-id: {id}");
    for r in related {
        trailers.push_str(&format!("\nRelated: {r}"));
    }
    raw_commit()
        .hash(&format!("hash-{id}"))
        .trailers(&trailers)
        .build()
}

/// Scripts git so a `--grep=...<id>` query returns the matching commit and
/// an `--all` index query returns every commit.
fn git_with(commits: Vec<RawCommit>) -> MockGitClient {
    let git = MockGitClient::new();
    git.set_log(move |args, options| {
        if let Some(grep) = args.iter().find(|a| a.starts_with("--grep=")) {
            return Ok(commits
                .iter()
                .filter(|c| {
                    let id = c
                        .trailers
                        .lines()
                        .next()
                        .unwrap_or("")
                        .trim_start_matches("Lore-id: ");
                    grep.ends_with(id)
                })
                .cloned()
                .collect());
        }
        if options.lore_only && args.iter().any(|a| a == "--all") {
            return Ok(commits.clone());
        }
        Ok(Vec::new())
    });
    git
}

fn run_trace(git: &MockGitClient, args: &[&str]) -> Result<Value> {
    let parser = TrailerParser::new();
    let repo = AtomRepository::new(git, &parser, Vec::new());
    let formatter = JsonFormatter::new();
    let deps = TraceDeps {
        atom_repository: &repo,
        formatter: &formatter,
    };
    let mut out = Vec::new();
    let mut err = Vec::new();
    let mut io = Io::new(&mut out, &mut err);
    let code = run(&parse(args), &deps, &mut io)?;
    assert_eq!(code, 0);
    Ok(serde_json::from_slice(&out).expect("json output"))
}

fn grep_queries(git: &MockGitClient) -> Vec<String> {
    git.log_calls()
        .iter()
        .filter_map(|(args, _)| args.iter().find(|a| a.starts_with("--grep=")).cloned())
        .collect()
}

fn index_builds(git: &MockGitClient) -> usize {
    git.log_calls()
        .iter()
        .filter(|(args, options)| options.lore_only && args.iter().any(|a| a == "--all"))
        .count()
}

#[test]
fn should_resolve_the_root_via_find_by_lore_id_and_edges_via_the_shared_index() {
    let git = git_with(vec![
        commit("aaaa1111", &["bbbb2222", "cccc3333"]),
        commit("bbbb2222", &[]),
        commit("cccc3333", &["dddd4444"]),
    ]);

    let out = run_trace(&git, &["aaaa1111"]).expect("trace");

    assert_eq!(
        grep_queries(&git),
        vec!["--grep=^Lore-id:[[:space:]]*aaaa1111"]
    );
    assert_eq!(index_builds(&git), 1);
    assert_eq!(out["root"]["lore_id"], "aaaa1111");
    let edges = out["edges"].as_array().expect("edges");
    assert_eq!(edges.len(), 3);
    assert_eq!(edges[0]["to"], "bbbb2222");
    assert_eq!(edges[0]["resolved"], Value::Bool(true));
    assert_eq!(edges[1]["to"], "cccc3333");
    assert_eq!(edges[2]["from"], "cccc3333");
    assert_eq!(edges[2]["to"], "dddd4444");
    assert_eq!(edges[2]["resolved"], Value::Bool(false));
    assert_eq!(edges[2]["target_atom"], Value::Null);
}

#[test]
fn should_fail_when_the_root_lore_id_is_unknown() {
    let git = git_with(vec![commit("aaaa1111", &[])]);
    let err = run_trace(&git, &["deadbeef"]).expect_err("unknown id");
    assert_eq!(
        err.to_string(),
        "Lore-id \"deadbeef\" not found in commit history."
    );
    assert_eq!(err.exit_code(), 1);
    assert_eq!(index_builds(&git), 0);
}

#[test]
fn should_reject_malformed_lore_ids_before_touching_git() {
    let git = git_with(Vec::new());
    let err = run_trace(&git, &["not-an-id"]).expect_err("malformed");
    assert_eq!(
        err.to_string(),
        "Invalid Lore-id format: \"not-an-id\". Must be 8-character hex."
    );
    assert_eq!(git.log_call_count(), 0);
}

#[test]
fn should_not_build_the_index_when_the_root_atom_has_no_references() {
    let git = git_with(vec![commit("aaaa1111", &[])]);
    let out = run_trace(&git, &["aaaa1111"]).expect("trace");
    assert_eq!(index_builds(&git), 0);
    assert_eq!(out["edges"], serde_json::json!([]));
}

fn tos(out: &Value) -> Vec<&str> {
    out["edges"]
        .as_array()
        .expect("edges")
        .iter()
        .map(|e| e["to"].as_str().unwrap_or(""))
        .collect()
}

#[test]
fn max_depth_limits_the_traversal() {
    let git = git_with(vec![
        commit("aaaa1111", &["bbbb2222"]),
        commit("bbbb2222", &["cccc3333"]),
        commit("cccc3333", &[]),
    ]);
    // Depth 0: the root's edges are listed but nothing is expanded.
    let shallow = run_trace(&git, &["aaaa1111", "--max-depth", "0"]).expect("trace");
    assert_eq!(tos(&shallow), vec!["bbbb2222"]);

    // Depth 1: bbbb2222 is visited and its edges listed, but cccc3333 is
    // not expanded further (TS: `depth + 1 <= maxDepth` gate on enqueue).
    let out = run_trace(&git, &["aaaa1111", "--max-depth", "1"]).expect("trace");
    assert_eq!(tos(&out), vec!["bbbb2222", "cccc3333"]);

    let deep = run_trace(&git, &["aaaa1111"]).expect("trace");
    assert_eq!(deep["edges"].as_array().map(Vec::len), Some(2));
}
