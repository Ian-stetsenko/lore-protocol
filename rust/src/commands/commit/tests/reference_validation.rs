//! Port of `tests/unit/commands/commit-reference-validation.test.ts`.
//!
//! The TS suite mocks `AtomRepository`; here the real repository runs over a
//! scripted `MockGitClient`, so "the repository was never called" becomes
//! "git was never asked for history" (no `log` or `resolve_ref` call), and
//! resolved / unresolvable ids are whatever the scripted history holds.
//! The real `CommitBuilder` always runs, so format issues come from the
//! production rules rather than a stubbed `validate`.

use std::cell::{Cell, RefCell};

use super::*;
use crate::formatters::text_formatter::TextFormatter;
use crate::interfaces::git_client::RawCommit;
use crate::interfaces::output_formatter::OutputFormatter;
use crate::interfaces::prompt::{Prompt, TextPromptOptions};
use crate::test_support::raw_commit;
use crate::types::output::ValidationIssue;
use crate::util::constants::prompt_strings;

const SKIPPED_WARNING: &str = "validation skipped: the Lore-id index could not be built";

const REFERENCE_CASES: [(&str, &str); 3] = [
    ("--supersedes", "Supersedes"),
    ("--depends-on", "Depends-on"),
    ("--related", "Related"),
];

fn atom_commit(lore_id: &str) -> RawCommit {
    raw_commit()
        .hash(&format!("hash-{lore_id}"))
        .trailers(&format!("Lore-id: {lore_id}"))
        .build()
}

/// History whose Lore-id index holds exactly `lore_ids`.
fn git_with_atoms(lore_ids: &[&str]) -> MockGitClient {
    let git = MockGitClient::new();
    git.set_log_result(lore_ids.iter().map(|id| atom_commit(id)).collect());
    git
}

/// A fresh repository: HEAD is unborn and every log pass is empty.
fn unborn_head_git() -> MockGitClient {
    let git = MockGitClient::new();
    git.set_resolve_ref(|_| {
        Err(LoreError::git(
            "git rev-parse failed: fatal: ambiguous argument 'HEAD'",
        ))
    });
    git
}

struct Outcome {
    result: Result<i32>,
    stdout: String,
    stderr: String,
}

impl Outcome {
    fn issues(&self) -> &[ValidationIssue] {
        match &self.result {
            Err(err @ LoreError::Validation { .. }) => err.issues(),
            other => panic!("expected a validation error, got {other:?}"),
        }
    }

    fn issues_with_rule(&self, rule: &str) -> Vec<&ValidationIssue> {
        self.issues().iter().filter(|i| i.rule == rule).collect()
    }
}

fn run_commit_with(git: &MockGitClient, prompt: &dyn Prompt, args: &[&str]) -> Outcome {
    run_commit_formatted(git, prompt, &JsonFormatter::new(), args)
}

fn run_commit_formatted(
    git: &MockGitClient,
    prompt: &dyn Prompt,
    formatter: &dyn OutputFormatter,
    args: &[&str],
) -> Outcome {
    let parser = TrailerParser::new();
    let generator = FixedLoreIdGenerator::single("a1b2c3d4");
    let config = LoreConfig::default();
    let builder = CommitBuilder::new(&parser, &generator, &config);
    let resolver = CommitInputResolver::new(prompt);
    let reader = HeadLoreIdReader::new(git, &parser);
    let repository = AtomRepository::new(git, &parser, Vec::new());
    let deps = CommitDeps {
        commit_builder: &builder,
        git_client: git,
        formatter,
        commit_input_resolver: &resolver,
        head_lore_id_reader: &reader,
        atom_repository: &repository,
    };
    let mut out = Vec::new();
    let mut err = Vec::new();
    let mut io = Io::new(&mut out, &mut err);
    let result = run(&parse(args), &deps, &mut io);
    Outcome {
        result,
        stdout: String::from_utf8_lossy(&out).into_owned(),
        stderr: String::from_utf8_lossy(&err).into_owned(),
    }
}

fn run_commit(git: &MockGitClient, args: &[&str]) -> Outcome {
    run_commit_with(git, &MockPrompt::new(), args)
}

fn with_intent<'a>(args: &[&'a str]) -> Vec<&'a str> {
    let mut all = vec!["--intent", "test commit"];
    all.extend_from_slice(args);
    all
}

/// Whether git was asked for history (index build or Lore-id lookup).
fn history_reads(git: &MockGitClient) -> usize {
    git.calls()
        .iter()
        .filter(|c| matches!(c, GitCall::Log { .. } | GitCall::ResolveRef(_)))
        .count()
}

fn assert_nothing_committed(git: &MockGitClient) {
    assert!(git.commit_calls().is_empty(), "a commit was created");
}

// ---- lore commit reference validation --------------------------------------

#[test]
fn trailer_citing_an_unresolvable_id_exits_1_creates_nothing_and_the_pair_appears_in_the_issues() {
    for (flag, trailer) in REFERENCE_CASES {
        let git = git_with_atoms(&[]);

        let outcome = run_commit(&git, &with_intent(&[flag, "deadbeef"]));

        let err = outcome.result.as_ref().expect_err("must fail");
        assert_eq!(err.exit_code(), 1, "{trailer}");
        // Pair presence only (trailer name + id).
        assert!(
            outcome
                .issues()
                .iter()
                .any(|i| i.severity == Severity::Error
                    && i.message.contains(trailer)
                    && i.message.contains("deadbeef")),
            "{trailer}: {:?}",
            outcome.issues()
        );
        assert_nothing_committed(&git);
    }
}

#[test]
fn succeeds_identically_to_today_when_every_reference_id_resolves() {
    let git = git_with_atoms(&["aaaa1111", "bbbb2222"]);

    let outcome = run_commit(
        &git,
        &with_intent(&["--supersedes", "aaaa1111", "--related", "bbbb2222"]),
    );

    assert_eq!(outcome.result.expect("commits"), 0);
    // One index build (HEAD pass + delta pass) serves both ids.
    assert_eq!(git.log_call_count(), 2);
    let commits = git.commit_calls();
    assert_eq!(commits.len(), 1);
    assert_eq!(commits[0].1, CommitOptions::default());
}

#[test]
fn passes_an_id_that_resolves_only_on_a_non_head_ref_matching_trace_semantics() {
    let git = MockGitClient::new();
    git.set_log(|args, _| {
        Ok(if args.iter().any(|a| a == "--all") {
            vec![atom_commit("cccc3333")]
        } else {
            Vec::new()
        })
    });

    let outcome = run_commit(&git, &with_intent(&["--depends-on", "cccc3333"]));

    assert_eq!(outcome.result.expect("commits"), 0);
    assert_eq!(git.commit_calls().len(), 1);
}

#[test]
fn never_calls_the_repository_when_the_commit_has_no_reference_ids() {
    let git = MockGitClient::new();

    let outcome = run_commit(&git, &["--intent", "plain commit"]);

    assert_eq!(outcome.result.expect("commits"), 0);
    assert_eq!(history_reads(&git), 0);
    assert_eq!(git.commit_calls().len(), 1);
}

#[test]
fn skips_resolution_for_pattern_invalid_reference_ids_format_gate_owns_them() {
    let git = MockGitClient::new();

    let outcome = run_commit(&git, &with_intent(&["--supersedes", "zzzzzzzz"]));

    // The real builder rejects the format; the reference gate never reads
    // history for an id that could not exist on any ref.
    assert_eq!(history_reads(&git), 0);
    let issues = outcome.issues();
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].rule, "invalid-lore-id-ref");
}

#[test]
fn bypasses_the_repository_on_the_amend_no_edit_path() {
    let git = MockGitClient::new();

    let outcome = run_commit(&git, &["--amend", "--no-edit"]);

    assert_eq!(outcome.result.expect("amends"), 0);
    assert_eq!(history_reads(&git), 0);
    assert_eq!(
        git.commit_calls(),
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
fn reports_one_issue_per_trailer_id_pair_not_per_id() {
    let git = git_with_atoms(&[]);

    let outcome = run_commit(
        &git,
        &with_intent(&["--supersedes", "deadbeef", "--related", "deadbeef"]),
    );

    let ref_issues: Vec<_> = outcome
        .issues()
        .iter()
        .filter(|i| i.message.contains("deadbeef"))
        .collect();
    assert_eq!(ref_issues.len(), 2);
    assert!(ref_issues.iter().any(|i| i.message.contains("Supersedes")));
    assert!(ref_issues.iter().any(|i| i.message.contains("Related")));
    assert!(ref_issues.iter().all(|i| i.rule == "reference-resolves"));
}

#[test]
fn fails_when_any_reference_id_is_unresolvable_reporting_only_the_failing_pairs() {
    let git = git_with_atoms(&["aaaa1111"]);

    let outcome = run_commit(
        &git,
        &with_intent(&["--supersedes", "aaaa1111", "--related", "deadbeef"]),
    );

    let issues = outcome.issues();
    assert_eq!(issues.len(), 1);
    assert_eq!(
        issues[0].message,
        "Related references Lore-id deadbeef, which resolves on no ref."
    );
    assert_nothing_committed(&git);
}

#[test]
fn fails_once_with_both_classes_when_format_and_reference_issues_coexist() {
    let git = git_with_atoms(&[]);

    let outcome = run_commit(
        &git,
        &with_intent(&["--supersedes", "deadbeef", "--supersedes", "zzzzzzzz"]),
    );

    assert_eq!(outcome.issues().len(), 2);
    let format_issues = outcome.issues_with_rule("invalid-lore-id-ref");
    let reference_issues = outcome.issues_with_rule("reference-resolves");
    assert_eq!(format_issues.len(), 1);
    assert!(format_issues[0].message.contains("zzzzzzzz"));
    assert_eq!(reference_issues.len(), 1);
    assert!(reference_issues[0].message.contains("Supersedes"));
    assert!(reference_issues[0].message.contains("deadbeef"));
    assert_nothing_committed(&git);
}

#[test]
fn resolves_references_after_format_validation_and_before_the_build() {
    let git = git_with_atoms(&["aaaa1111"]);

    let outcome = run_commit(&git, &with_intent(&["--supersedes", "aaaa1111"]));

    assert_eq!(outcome.result.expect("commits"), 0);
    // Every history read precedes the commit; a resolved id needs no
    // near-match pass (the index is built exactly once: two log passes).
    let calls = git.calls();
    let commit_at = calls
        .iter()
        .position(|c| matches!(c, GitCall::Commit { .. }))
        .expect("commit call");
    let last_log_at = calls
        .iter()
        .rposition(|c| matches!(c, GitCall::Log { .. }))
        .expect("log call");
    assert!(last_log_at < commit_at);
    assert_eq!(git.log_call_count(), 2);
}

#[test]
fn hints_a_pure_hex_id_with_the_git_hash_sentence() {
    for id in [
        "abc1234",
        "abc123456",
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    ] {
        let git = MockGitClient::new();

        let outcome = run_commit(&git, &with_intent(&["--supersedes", id]));

        let issues = outcome.issues();
        assert_eq!(issues.len(), 1, "{id}");
        assert_eq!(issues[0].rule, "invalid-lore-id-ref");
        assert_eq!(
            issues[0].message,
            format!("Invalid Lore-id reference in Supersedes: \"{id}\". Must be 8-character hex. Hint: this looks like a git commit hash; Lore-ids are 8-character lowercase hex.")
        );
        assert_eq!(history_reads(&git), 0);
    }
}

#[test]
fn hints_an_exactly_8_hex_id_with_the_lowercase_sentence() {
    for id in ["DEADBEEF", "AbCdEf12"] {
        let git = MockGitClient::new();

        let outcome = run_commit(&git, &with_intent(&["--supersedes", id]));

        let issues = outcome.issues();
        assert_eq!(issues.len(), 1, "{id}");
        assert_eq!(issues[0].rule, "invalid-lore-id-ref");
        assert_eq!(
            issues[0].message,
            format!("Invalid Lore-id reference in Supersedes: \"{id}\". Must be 8-character hex. Hint: Lore-ids are lowercase hex.")
        );
        assert!(!issues[0].message.contains("git commit hash"));
        assert_eq!(history_reads(&git), 0);
    }
}

#[test]
fn carries_no_hint_for_other_invalid_shapes() {
    for id in ["zzzzzzzz", "1234567z", "abcdefgh9"] {
        let git = MockGitClient::new();

        let outcome = run_commit(&git, &with_intent(&["--supersedes", id]));

        let issues = outcome.issues();
        assert_eq!(issues.len(), 1, "{id}");
        assert_eq!(issues[0].rule, "invalid-lore-id-ref");
        assert_eq!(
            issues[0].message,
            format!("Invalid Lore-id reference in Supersedes: \"{id}\". Must be 8-character hex.")
        );
    }
}

#[test]
fn reports_each_identical_trailer_id_pair_exactly_once() {
    let git = git_with_atoms(&[]);

    let outcome = run_commit(
        &git,
        &with_intent(&["--supersedes", "deadbeef", "--supersedes", "deadbeef"]),
    );

    let ref_issues: Vec<_> = outcome
        .issues()
        .iter()
        .filter(|i| i.message.contains("deadbeef"))
        .collect();
    assert_eq!(ref_issues.len(), 1);
    assert_eq!(ref_issues[0].rule, "reference-resolves");
    // One index build for the single unique id.
    assert_eq!(git.log_call_count(), 2);
}

#[test]
fn fails_identically_when_the_reference_id_arrives_via_a_json_input_file() {
    let dir = tempfile::tempdir().expect("tempdir");
    let file = dir.path().join("commit-input.json");
    std::fs::write(
        &file,
        r#"{"intent": "test commit", "trailers": {"Supersedes": ["deadbeef"]}}"#,
    )
    .expect("write input");
    let file_arg = file.display().to_string();

    let flag = run_commit(
        &git_with_atoms(&[]),
        &with_intent(&["--supersedes", "deadbeef"]),
    );
    let from_file = run_commit(&git_with_atoms(&[]), &["--file", &file_arg]);

    let flag_err = flag.result.as_ref().expect_err("flag input fails");
    let file_err = from_file.result.as_ref().expect_err("file input fails");
    assert_eq!(file_err.to_string(), flag_err.to_string());
    assert_eq!(file_err.exit_code(), flag_err.exit_code());
    assert_eq!(from_file.issues(), flag.issues());
    assert_eq!(from_file.issues()[0].rule, "reference-resolves");
    assert!(from_file.issues()[0].message.contains("deadbeef"));
}

#[test]
fn renders_the_merged_issues_structurally_in_json_output_mode() {
    let git = git_with_atoms(&[]);

    let outcome = run_commit(
        &git,
        &with_intent(&["--supersedes", "deadbeef", "--supersedes", "zzzzzzzz"]),
    );

    // Mirror main.rs's validation-error rendering: issues map to
    // severity + message and flow through the JSON error formatter.
    let err = outcome.result.as_ref().expect_err("fails");
    let messages: Vec<ErrorMessage> = outcome
        .issues()
        .iter()
        .map(|i| ErrorMessage {
            severity: i.severity,
            field: None,
            message: i.message.clone(),
        })
        .collect();
    let payload: Value =
        serde_json::from_str(&JsonFormatter::new().format_error(err.exit_code(), &messages))
            .expect("json");

    assert_eq!(payload["error"], Value::Bool(true));
    assert_eq!(payload["code"], 1);
    let rendered = payload["messages"].as_array().expect("messages");
    assert_eq!(rendered.len(), 2);
    assert!(rendered.iter().all(|m| m["severity"] == "error"));
    let text = |m: &Value| m["message"].as_str().unwrap_or("").to_owned();
    assert!(rendered
        .iter()
        .any(|m| text(m).contains("zzzzzzzz") && text(m).contains("Supersedes")));
    assert!(rendered
        .iter()
        .any(|m| text(m).contains("deadbeef") && text(m).contains("resolves on no ref")));
}

#[test]
fn appends_near_match_candidates_to_the_resolution_error() {
    // deadbee0 is at Hamming distance 1, deadbe00 at 2, cafe1234 is far.
    let git = git_with_atoms(&["deadbe00", "cafe1234", "deadbee0"]);

    let outcome = run_commit(&git, &with_intent(&["--supersedes", "deadbeef"]));

    let ref_issues = outcome.issues_with_rule("reference-resolves");
    assert_eq!(ref_issues.len(), 1);
    assert_eq!(
        ref_issues[0].message,
        "Supersedes references Lore-id deadbeef, which resolves on no ref. Did you mean one of: deadbee0, deadbe00?"
    );
}

// ---- lore commit reference validation robustness ---------------------------

#[test]
fn skips_validation_with_a_pinned_warning_and_commits_when_the_lore_id_index_cannot_be_built() {
    let git = MockGitClient::new();
    git.set_log_error("git log failed: transient index build failure");

    let outcome = run_commit_formatted(
        &git,
        &MockPrompt::new(),
        &TextFormatter::new(false),
        &with_intent(&["--supersedes", "deadbeef"]),
    );

    assert_eq!(outcome.result.expect("commits"), 0);
    // "Could not check" is distinct from "check failed": one pinned
    // reference-check-skipped warning through format_warnings, then the
    // commit proceeds.
    assert_eq!(outcome.stderr, format!("warning: {SKIPPED_WARNING}\n"));
    assert_eq!(git.commit_calls().len(), 1);
    // The near-match pass never runs after the index build failed: the
    // failed build is the only history read (resolve, HEAD walk, delta).
    assert_eq!(git.log_call_count(), 2);
}

#[test]
fn carries_the_skipped_warning_in_the_json_payload_and_keeps_stderr_empty() {
    let git = MockGitClient::new();
    git.set_log_error("git log failed: transient index build failure");

    let outcome = run_commit(&git, &with_intent(&["--supersedes", "deadbeef"]));

    assert_eq!(outcome.result.expect("commits"), 0);
    assert!(outcome.stderr.is_empty(), "{}", outcome.stderr);
    let payload: serde_json::Value = serde_json::from_str(&outcome.stdout).expect("json");
    assert_eq!(
        payload["warnings"],
        serde_json::json!([{
            "severity": "warning",
            "rule": "reference-check-skipped",
            "message": SKIPPED_WARNING,
        }])
    );
}

#[test]
fn does_not_swallow_non_git_failures_raised_while_checking_references() {
    let git = MockGitClient::new();
    git.set_log(|_, _| {
        Err(LoreError::validation(
            "unexpected",
            vec![ValidationIssue::error(
                "reference-resolves",
                "upstream issue",
            )],
        ))
    });

    let outcome = run_commit(&git, &with_intent(&["--supersedes", "deadbeef"]));

    // Only git errors mean "could not check"; everything else fails loudly.
    let err = outcome.result.as_ref().expect_err("propagates");
    assert_eq!(err.to_string(), "unexpected");
    assert!(outcome.stderr.is_empty());
    assert_nothing_committed(&git);
}

/// Answers by message: a valid intent, one Supersedes id (`deadbeef`), and
/// "no" to every other confirmation. Counts every prompt call.
struct UnresolvableInteractivePrompt {
    supersedes_collected: Cell<bool>,
    calls: RefCell<Vec<String>>,
    closes: Cell<usize>,
}

impl UnresolvableInteractivePrompt {
    fn new() -> Self {
        UnresolvableInteractivePrompt {
            supersedes_collected: Cell::new(false),
            calls: RefCell::new(Vec::new()),
            closes: Cell::new(0),
        }
    }

    fn record(&self, message: &str) {
        self.calls.borrow_mut().push(message.to_owned());
    }
}

impl Prompt for UnresolvableInteractivePrompt {
    fn ask_text(&self, message: &str, _options: &TextPromptOptions) -> Result<String> {
        self.record(message);
        Ok(if message == prompt_strings::SUPERSEDES_INPUT {
            "deadbeef".to_owned()
        } else {
            "interactive intent".to_owned()
        })
    }

    fn ask_multiline(&self, message: &str) -> Result<String> {
        self.record(message);
        Ok(String::new())
    }

    fn ask_choice(&self, message: &str, choices: &[&str]) -> Result<String> {
        self.record(message);
        Ok(choices.first().copied().unwrap_or_default().to_owned())
    }

    fn ask_confirm(&self, message: &str, _default: Option<bool>) -> Result<bool> {
        self.record(message);
        if message == prompt_strings::ADD_SUPERSEDES && !self.supersedes_collected.get() {
            self.supersedes_collected.set(true);
            return Ok(true); // accept one Supersedes id, then decline the re-ask
        }
        Ok(false)
    }

    fn close(&self) {
        self.closes.set(self.closes.get() + 1);
    }
}

#[test]
fn errors_after_interactive_collection_ends_on_an_unresolvable_id_without_replaying_the_session() {
    let git = git_with_atoms(&[]);
    let prompt = UnresolvableInteractivePrompt::new();

    let outcome = run_commit_with(&git, &prompt, &["--interactive"]);

    let ref_issues = outcome.issues_with_rule("reference-resolves");
    assert_eq!(ref_issues.len(), 1);
    assert!(ref_issues[0].message.contains("Supersedes"));
    assert!(ref_issues[0].message.contains("deadbeef"));
    assert_nothing_committed(&git);
    // The session ran exactly once: one close, and the prompt calls show a
    // single pass through the collectors (no replay or retry loop).
    assert_eq!(prompt.closes.get(), 1);
    let calls = prompt.calls.borrow();
    let supersedes_asks = calls
        .iter()
        .filter(|m| m.as_str() == prompt_strings::ADD_SUPERSEDES)
        .count();
    assert_eq!(supersedes_asks, 2, "one accept, one decline: {calls:?}");
}

#[test]
fn fails_a_first_ever_lore_commit_citing_any_reference_id_through_the_unborn_head_path() {
    // Unborn HEAD makes the index build fall back to --all, which yields an
    // empty index, so every cited id resolves on no ref.
    let git = unborn_head_git();

    let outcome = run_commit(&git, &with_intent(&["--supersedes", "deadbeef"]));

    assert!(outcome
        .issues()
        .iter()
        .any(|i| i.rule == "reference-resolves"
            && i.message.contains("deadbeef")
            && i.message.contains("Supersedes")));
    assert_nothing_committed(&git);
}

#[test]
fn lets_a_first_ever_lore_commit_proceed_on_unborn_head_with_no_verify_refs() {
    let git = unborn_head_git();

    let outcome = run_commit(
        &git,
        &with_intent(&["--supersedes", "deadbeef", "--no-verify-refs"]),
    );

    assert_eq!(outcome.result.expect("commits"), 0);
    assert_eq!(git.commit_calls().len(), 1);
    assert_eq!(history_reads(&git), 0);
}
