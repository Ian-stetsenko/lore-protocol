//! Port of `tests/unit/commands/validate.test.ts` (issue #69): `--from <ref>`
//! selects `<ref>..HEAD`; the deprecated `--since` alias was removed in 0.8.0
//! and is rejected as an unknown option.

use super::*;
use crate::cli::{Cli, Command};
use crate::formatters::json_formatter::JsonFormatter;
use crate::services::atom_repository::AtomRepository;
use crate::test_support::{raw_commit, MockGitClient};
use crate::types::config::LoreConfig;
use clap::Parser;
use serde_json::Value;

fn parse(args: &[&str]) -> std::result::Result<ValidateArgs, clap::Error> {
    let cli = Cli::try_parse_from(["lore", "validate"].iter().chain(args))?;
    match cli.command {
        Command::Validate(a) => Ok(a),
        other => panic!("unexpected {other:?}"),
    }
}

fn git_returning(hash: &str) -> MockGitClient {
    let git = MockGitClient::new();
    git.set_log_result(vec![raw_commit()
        .hash(hash)
        .trailers("Lore-id: abcd1234")
        .build()]);
    git
}

/// Runs `lore validate <args>` and returns the JSON validation result.
fn run_validate(git: &MockGitClient, args: &[&str]) -> Result<Value> {
    let parser = TrailerParser::new();
    let repo = AtomRepository::new(git, &parser, Vec::new());
    let config = LoreConfig::default();
    let validator = Validator::new(&parser, &repo, &config);
    let formatter = JsonFormatter::new();
    let deps = ValidateDeps {
        validator: &validator,
        git_client: git,
        trailer_parser: &parser,
        formatter: &formatter,
    };
    let mut out = Vec::new();
    let mut err = Vec::new();
    let mut io = Io::new(&mut out, &mut err);
    run(&parse(args).expect("valid args"), &deps, &mut io)?;
    assert!(err.is_empty(), "stderr: {}", String::from_utf8_lossy(&err));
    Ok(serde_json::from_slice(&out).expect("json output"))
}

fn log_args(git: &MockGitClient) -> Vec<Vec<String>> {
    git.log_calls().into_iter().map(|(args, _)| args).collect()
}

#[test]
fn routes_from_to_the_ref_head_range_and_feeds_the_result_to_the_validator() {
    let hash = "a".repeat(40);
    let git = git_returning(&hash);

    let result = run_validate(&git, &["--from", "main"]).expect("validates");

    assert_eq!(log_args(&git), vec![vec!["main..HEAD".to_owned()]]);
    assert_eq!(result["summary"]["commits_checked"], 1);
    assert_eq!(result["results"][0]["commit"], hash.as_str());
}

#[test]
fn validates_the_same_commits_as_the_equivalent_positional_range() {
    let hash = "b".repeat(40);
    let positional = git_returning(&hash);
    let from_flag = git_returning(&hash);

    let positional_result = run_validate(&positional, &["main..HEAD"]).expect("validates");
    let from_result = run_validate(&from_flag, &["--from", "main"]).expect("validates");

    assert_eq!(log_args(&from_flag), log_args(&positional));
    assert_eq!(from_result, positional_result);
}

#[test]
fn keeps_the_positional_range_working_unchanged() {
    let git = MockGitClient::new();

    run_validate(&git, &["main..feature"]).expect("validates");

    assert_eq!(log_args(&git), vec![vec!["main..feature".to_owned()]]);
}

#[test]
fn rejects_a_positional_range_combined_with_from() {
    let git = MockGitClient::new();

    let err = run_validate(&git, &["main..feature", "--from", "main"]).expect_err("conflict");

    assert_eq!(
        err.to_string(),
        "Conflicting range specifiers: positional range \"main..feature\" and --from main. Pass one or the other."
    );
    assert_eq!(err.exit_code(), 1);
    assert_eq!(git.log_call_count(), 0);
}

#[test]
fn prints_nothing_on_stderr_when_from_is_used() {
    // run_validate asserts that stderr stays empty.
    run_validate(&MockGitClient::new(), &["--from", "main"]).expect("validates");
}

#[test]
fn rejects_since_as_an_unknown_option_removed_in_0_8_0_use_from() {
    let err = parse(&["--since", "main"]).expect_err("--since is gone");
    assert_eq!(err.kind(), clap::error::ErrorKind::UnknownArgument);
}

#[test]
fn keeps_the_default_last_commit_and_last_behavior() {
    let defaults = MockGitClient::new();
    run_validate(&defaults, &[]).expect("validates");
    assert_eq!(log_args(&defaults), vec![vec!["-1".to_owned()]]);

    let last = MockGitClient::new();
    run_validate(&last, &["--last", "3"]).expect("validates");
    assert_eq!(log_args(&last), vec![vec!["-3".to_owned()]]);
}

// ---- empty range values follow JS truthiness (Rust-only coverage) ---------

#[test]
fn an_empty_from_falls_back_to_the_last_commit() {
    let git = MockGitClient::new();

    run_validate(&git, &["--from", ""]).expect("validates");

    assert_eq!(log_args(&git), vec![vec!["-1".to_owned()]]);
}

#[test]
fn an_empty_positional_range_falls_back_to_the_last_commit() {
    let git = MockGitClient::new();

    run_validate(&git, &[""]).expect("validates");

    assert_eq!(log_args(&git), vec![vec!["-1".to_owned()]]);
}
