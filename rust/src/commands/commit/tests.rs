//! Port of `tests/unit/commands/commit-amend.test.ts`, driven through the
//! real services with a scripted git client. The reference gate cases from
//! `commit-reference-validation.test.ts` live in `reference_validation`.

mod reference_validation;

use super::*;
use crate::cli::{Cli, Command};
use crate::formatters::json_formatter::JsonFormatter;
use crate::interfaces::git_client::CommitOptions;
use crate::services::atom_repository::AtomRepository;
use crate::services::trailer_parser::TrailerParser;
use crate::test_support::{FixedLoreIdGenerator, GitCall, MockGitClient, MockPrompt};
use crate::types::config::LoreConfig;
use clap::Parser;

fn parse(args: &[&str]) -> CommitArgs {
    let cli = Cli::try_parse_from(["lore", "commit"].iter().chain(args)).expect("valid args");
    match cli.command {
        Command::Commit(a) => a,
        other => panic!("unexpected {other:?}"),
    }
}

struct Harness {
    git: MockGitClient,
    out: Vec<u8>,
    err: Vec<u8>,
}

impl Harness {
    fn new(head_message: &str) -> Self {
        let git = MockGitClient::new();
        git.set_head_message_result(head_message);
        Harness {
            git,
            out: Vec::new(),
            err: Vec::new(),
        }
    }

    fn run(&mut self, args: &[&str]) -> Result<i32> {
        let parser = TrailerParser::new();
        let generator = FixedLoreIdGenerator::single("deadbeef");
        let config = LoreConfig::default();
        let builder = CommitBuilder::new(&parser, &generator, &config);
        let prompt = MockPrompt::new();
        let resolver = CommitInputResolver::new(&prompt);
        let reader = HeadLoreIdReader::new(&self.git, &parser);
        let repository = AtomRepository::new(&self.git, &parser, Vec::new());
        let formatter = JsonFormatter::new();
        let deps = CommitDeps {
            commit_builder: &builder,
            git_client: &self.git,
            formatter: &formatter,
            commit_input_resolver: &resolver,
            head_lore_id_reader: &reader,
            atom_repository: &repository,
        };
        let mut io = Io::new(&mut self.out, &mut self.err);
        run(&parse(args), &deps, &mut io)
    }

    fn head_reads(&self) -> usize {
        self.git
            .calls()
            .iter()
            .filter(|c| matches!(c, GitCall::HeadMessage))
            .count()
    }

    fn staged_checks(&self) -> usize {
        self.git
            .calls()
            .iter()
            .filter(|c| matches!(c, GitCall::HasStagedChanges))
            .count()
    }

    fn stdout(&self) -> String {
        String::from_utf8_lossy(&self.out).into_owned()
    }

    /// `git log` calls: the reference gate is the only `log` user here, so
    /// zero means the Lore-id index was never built.
    fn index_reads(&self) -> usize {
        self.git.log_call_count()
    }
}

const LORE_HEAD: &str = "feat: previous\n\nLore-id: cafebabe\nConfidence: low";

#[test]
fn should_skip_staged_changes_guard_when_amend_is_used() {
    let mut h = Harness::new("");
    h.git.set_has_staged_changes(false);
    // Without --amend this would be NoStagedChanges; with --amend it succeeds.
    assert_eq!(
        h.run(&["--amend", "--intent", "amend test"]).expect("ok"),
        0
    );
    assert_eq!(h.staged_checks(), 0);
}

#[test]
fn should_pass_existing_lore_id_to_commit_builder_when_amending() {
    let mut h = Harness::new(LORE_HEAD);
    h.run(&["--amend", "--intent", "amend test"]).expect("ok");
    assert_eq!(h.head_reads(), 1);
    let (message, _) = h.git.commit_calls().remove(0);
    assert!(message.contains("Lore-id: cafebabe"), "{message}");
    assert!(!message.contains("deadbeef"));
    assert!(h.stdout().contains("\"loreId\": \"cafebabe\""));
}

#[test]
fn should_pass_amend_flag_to_git_client_commit() {
    let mut h = Harness::new("");
    h.run(&["--amend", "--intent", "amend test"]).expect("ok");
    let calls = h.git.commit_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        calls[0].1,
        CommitOptions {
            amend: true,
            no_edit: false
        }
    );
    assert!(calls[0].0.starts_with("amend test\n\nLore-id: deadbeef"));
    assert!(h
        .stdout()
        .contains("Commit amended: abc1234 | Lore-id: deadbeef"));
}

#[test]
fn should_bypass_lore_processing_with_amend_no_edit() {
    let mut h = Harness::new("");
    h.run(&["--amend", "--no-edit"]).expect("ok");
    let calls = h.git.commit_calls();
    assert_eq!(
        calls,
        vec![(
            String::new(),
            CommitOptions {
                amend: true,
                no_edit: true
            }
        )]
    );
    assert!(h.stdout().contains("Commit amended: abc1234"));
    assert!(h.stdout().contains("\"loreId\": null"));
}

#[test]
fn should_read_lore_id_from_head_even_with_amend_no_edit() {
    let mut h = Harness::new(LORE_HEAD);
    h.run(&["--amend", "--no-edit"]).expect("ok");
    assert_eq!(h.head_reads(), 1);
    assert!(h
        .stdout()
        .contains("Commit amended: abc1234 | Lore-id: cafebabe"));
}

#[test]
fn should_accept_amend_no_edit_no_verify_refs_as_a_no_op() {
    let mut h = Harness::new("");
    // --no-verify-refs is a mode flag: it must not trip the --no-edit
    // conflicting-input check.
    h.run(&["--amend", "--no-edit", "--no-verify-refs"])
        .expect("ok");
    assert_eq!(h.index_reads(), 0);
    assert_eq!(
        h.git.commit_calls(),
        vec![(
            String::new(),
            CommitOptions {
                amend: true,
                no_edit: true
            }
        )]
    );
}

#[test]
fn should_fail_when_no_edit_is_combined_with_input() {
    for extra in [
        &["--file", "input.json"][..],
        &["--intent", "new"],
        &["-i"],
        &["--body", "some context"],
        &["--constraint", "must use X"],
        &["--confidence", "high"],
        &["--related", "abc12345"],
    ] {
        let mut h = Harness::new("");
        let mut args = vec!["--amend", "--no-edit"];
        args.extend_from_slice(extra);
        let err = h.run(&args).expect_err("conflicting input must fail");
        assert!(
            err.to_string()
                .starts_with("--no-edit keeps the existing message unchanged"),
            "{extra:?}: {err}"
        );
        assert_eq!(err.exit_code(), 1);
        assert!(h.git.commit_calls().is_empty());
    }
}

#[test]
fn should_fail_when_no_edit_is_used_without_amend() {
    let mut h = Harness::new("");
    let err = h
        .run(&["--no-edit", "--intent", "test"])
        .expect_err("fails");
    assert_eq!(err.to_string(), "--no-edit can only be used with --amend");
    assert!(h.git.commit_calls().is_empty());
}

#[test]
fn should_generate_new_lore_id_when_amending_a_non_lore_commit() {
    let mut h = Harness::new("chore: plain commit without trailers");
    h.run(&["--amend", "--intent", "amend non-lore"])
        .expect("ok");
    assert_eq!(h.head_reads(), 1);
    let (message, _) = h.git.commit_calls().remove(0);
    assert!(message.contains("Lore-id: deadbeef"), "{message}");
}

#[test]
fn should_not_read_lore_id_from_head_for_normal_commits() {
    let mut h = Harness::new(LORE_HEAD);
    h.run(&["--intent", "normal commit"]).expect("ok");
    assert_eq!(h.head_reads(), 0);
    let (message, options) = h.git.commit_calls().remove(0);
    assert!(message.contains("Lore-id: deadbeef"), "{message}");
    assert_eq!(options, CommitOptions::default());
    assert!(h
        .stdout()
        .contains("Commit created: abc1234 | Lore-id: deadbeef"));
}

#[test]
fn should_check_staged_changes_for_normal_commits() {
    let mut h = Harness::new("");
    h.run(&["--intent", "normal"]).expect("ok");
    assert_eq!(h.staged_checks(), 1);

    let mut none = Harness::new("");
    none.git.set_has_staged_changes(false);
    let err = none
        .run(&["--intent", "normal"])
        .expect_err("no staged changes");
    assert!(matches!(err, LoreError::NoStagedChanges));
    assert_eq!(err.exit_code(), 3);
}

#[test]
fn validation_errors_abort_before_committing() {
    let mut h = Harness::new("");
    let err = h
        .run(&["--intent", "x", "--confidence", "very-high"])
        .expect_err("invalid enum");
    assert!(matches!(err, LoreError::Validation { .. }));
    assert_eq!(err.issues().len(), 1);
    assert_eq!(err.issues()[0].rule, "invalid-enum");
    assert!(h.git.commit_calls().is_empty());
}

#[test]
fn should_report_the_staged_changes_guard_before_reference_validation_when_both_would_fail() {
    let mut h = Harness::new("");
    h.git.set_has_staged_changes(false);
    let err = h
        .run(&["--intent", "test commit", "--related", "deadbeef"])
        .expect_err("no staged changes");
    assert_eq!(
        err.to_string(),
        "No staged changes. Stage files with `git add` before running `lore commit`."
    );
    // The staged guard wins: the reference gate never runs.
    assert_eq!(h.index_reads(), 0);
    assert!(h.git.commit_calls().is_empty());
}

// ---- reference gate escape (--no-verify-refs) -------------------------------

#[test]
fn should_commit_despite_unresolvable_reference_ids_when_no_verify_refs_is_passed() {
    // The empty mock history resolves nothing: deadbeef is unresolvable.
    let mut h = Harness::new("");
    h.run(&[
        "--intent",
        "test commit",
        "--related",
        "deadbeef",
        "--no-verify-refs",
    ])
    .expect("ok");
    assert_eq!(h.index_reads(), 0);
    let (_, options) = h.git.commit_calls().remove(0);
    assert_eq!(options, CommitOptions::default());
}

#[test]
fn should_keep_reference_validation_active_when_no_verify_refs_is_omitted() {
    let mut h = Harness::new("");
    let err = h
        .run(&["--intent", "test commit", "--related", "deadbeef"])
        .expect_err("unresolvable reference");
    assert_eq!(err.to_string(), "Commit input validation failed");
    assert!(h.index_reads() > 0);
    assert!(h.git.commit_calls().is_empty());
}

#[test]
fn should_validate_new_reference_trailers_on_amend_with_reference_input() {
    let mut h = Harness::new("");
    let err = h
        .run(&[
            "--amend",
            "--intent",
            "amend test",
            "--supersedes",
            "deadbeef",
        ])
        .expect_err("unresolvable reference");
    assert_eq!(err.to_string(), "Commit input validation failed");
    assert!(h.index_reads() > 0);
    assert!(h.git.commit_calls().is_empty());
}

#[test]
fn should_commit_on_amend_despite_unresolvable_ids_when_no_verify_refs_is_passed() {
    let mut h = Harness::new("");
    h.run(&[
        "--amend",
        "--intent",
        "amend test",
        "--supersedes",
        "deadbeef",
        "--no-verify-refs",
    ])
    .expect("ok");
    assert_eq!(h.index_reads(), 0);
    let (_, options) = h.git.commit_calls().remove(0);
    assert_eq!(
        options,
        CommitOptions {
            amend: true,
            no_edit: false
        }
    );
}
