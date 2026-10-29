//! End-to-end tests: run the built `lore` binary against throwaway git
//! repositories and assert on exit codes, text output and JSON output.
//!
//! These complement the unit tests (which mock git) by exercising the real
//! composition root, the real git CLI and the real formatters together.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command as Proc;

use assert_cmd::Command;
use predicates::prelude::*;
use serde_json::Value;
use tempfile::TempDir;

const DATE_RECENT: &str = "2026-10-01T10:00:00+00:00";
const DATE_OLD: &str = "2024-01-01T10:00:00+00:00";

struct Repo {
    dir: TempDir,
    gitconfig: PathBuf,
}

impl Repo {
    fn new() -> Repo {
        let dir = tempfile::tempdir().expect("tempdir");
        let gitconfig = dir.path().join(".empty-gitconfig");
        fs::write(&gitconfig, "").expect("write gitconfig");
        let repo = Repo { dir, gitconfig };
        repo.git(&["init", "-q"]);
        repo.git(&["symbolic-ref", "HEAD", "refs/heads/main"]);
        repo
    }

    fn path(&self) -> &Path {
        self.dir.path()
    }

    fn env(&self) -> Vec<(&'static str, String)> {
        vec![
            ("GIT_CONFIG_GLOBAL", self.gitconfig.display().to_string()),
            ("GIT_CONFIG_NOSYSTEM", "1".into()),
            ("GIT_AUTHOR_NAME", "Lore Test".into()),
            ("GIT_AUTHOR_EMAIL", "lore@example.com".into()),
            ("GIT_COMMITTER_NAME", "Lore Test".into()),
            ("GIT_COMMITTER_EMAIL", "lore@example.com".into()),
            ("LORE_NO_UPDATE_CHECK", "1".into()),
        ]
    }

    fn git(&self, args: &[&str]) -> String {
        self.git_at(args, DATE_RECENT)
    }

    fn git_at(&self, args: &[&str], date: &str) -> String {
        let output = Proc::new("git")
            .args(args)
            .current_dir(self.path())
            .envs(self.env())
            .env("GIT_AUTHOR_DATE", date)
            .env("GIT_COMMITTER_DATE", date)
            .output()
            .expect("git runs");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    fn write(&self, rel: &str, content: &str) {
        let full = self.path().join(rel);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).expect("mkdir");
        }
        fs::write(full, content).expect("write file");
    }

    /// Write `file`, stage everything and commit with `message` (which may
    /// contain a trailer block). Returns the new HEAD hash.
    fn commit(&self, file: &str, message: &str) -> String {
        self.commit_at(file, message, DATE_RECENT)
    }

    fn commit_at(&self, file: &str, message: &str, date: &str) -> String {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        self.write(file, &format!("{message}\n{stamp}\n"));
        self.git_at(&["add", "-A"], date);
        self.git_at(&["commit", "-q", "-m", message], date);
        self.git_at(&["rev-parse", "HEAD"], date).trim().to_owned()
    }

    fn lore(&self) -> Command {
        let mut cmd = Command::cargo_bin("lore").expect("lore binary built");
        cmd.current_dir(self.path()).envs(self.env());
        cmd
    }
}

fn json(stdout: &[u8]) -> Value {
    serde_json::from_slice(stdout)
        .unwrap_or_else(|e| panic!("invalid JSON: {e}\n{}", String::from_utf8_lossy(stdout)))
}

fn atom_message(subject: &str, trailers: &[&str]) -> String {
    format!("{subject}\n\n{}", trailers.join("\n"))
}

// ---------------------------------------------------------------------------
// Global behaviour
// ---------------------------------------------------------------------------

#[test]
fn version_prints_the_bare_version() {
    let repo = Repo::new();
    repo.lore()
        .arg("--version")
        .assert()
        .success()
        .stdout(format!("{}\n", env!("CARGO_PKG_VERSION")));
}

#[test]
fn no_subcommand_prints_help_and_exits_1() {
    let repo = Repo::new();
    repo.lore()
        .assert()
        .code(1)
        .stderr(predicate::str::contains("Usage:"));
}

#[test]
fn unknown_command_exits_1() {
    let repo = Repo::new();
    repo.lore().arg("frobnicate").assert().code(1);
}

#[test]
fn help_lists_every_command() {
    let repo = Repo::new();
    let assert = repo.lore().arg("--help").assert().success();
    let out = String::from_utf8_lossy(&assert.get_output().stdout).into_owned();
    for cmd in [
        "init",
        "context",
        "constraints",
        "rejected",
        "directives",
        "tested",
        "why",
        "search",
        "log",
        "stale",
        "trace",
        "commit",
        "validate",
        "squash",
        "doctor",
        "hooks",
    ] {
        assert!(out.contains(cmd), "help is missing `{cmd}`:\n{out}");
    }
}

#[test]
fn outside_a_repository_git_errors_exit_2() {
    let dir = tempfile::tempdir().expect("tempdir");
    let gitconfig = dir.path().join(".empty-gitconfig");
    fs::write(&gitconfig, "").expect("write");
    let mut cmd = Command::cargo_bin("lore").expect("lore binary built");
    cmd.current_dir(dir.path())
        .env("GIT_CONFIG_GLOBAL", gitconfig.display().to_string())
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CEILING_DIRECTORIES", dir.path().display().to_string())
        .arg("log")
        .assert()
        .code(2)
        .stderr(predicate::str::contains("error: git log failed"))
        .stderr(predicate::str::contains("(exit code 2)"));
}

#[test]
fn errors_are_json_when_requested() {
    let repo = Repo::new();
    let assert = repo
        .lore()
        .args(["trace", "not-an-id", "--json"])
        .assert()
        .code(1);
    let err = json(&assert.get_output().stderr);
    assert_eq!(err["error"], Value::Bool(true));
    assert_eq!(err["code"], 1);
    assert_eq!(err["lore_version"], "1.0");
    assert!(err["messages"][0]["message"]
        .as_str()
        .unwrap_or("")
        .contains("Invalid Lore-id format"));
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

#[test]
fn init_creates_config_then_reports_it_exists() {
    let repo = Repo::new();
    repo.lore()
        .arg("init")
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Created .lore/config.toml with protocol version 1.0",
        ));
    let config = fs::read_to_string(repo.path().join(".lore/config.toml")).expect("config");
    assert!(config.contains("[hooks]"));
    assert!(config.contains("skip_patterns = [\"^Merge \"]"));

    repo.lore()
        .arg("init")
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Config already exists at .lore/config.toml",
        ));
}

#[test]
fn init_reports_missing_options_on_old_configs() {
    let repo = Repo::new();
    repo.write(".lore/config.toml", "[protocol]\nversion = \"1.0\"\n");
    repo.lore()
        .arg("init")
        .assert()
        .success()
        .stdout(predicate::str::contains("missing new options"))
        .stdout(predicate::str::contains("[hooks] section"))
        .stdout(predicate::str::contains("You are using default settings"));
}

#[test]
fn init_reports_corrupted_config() {
    let repo = Repo::new();
    repo.write(".lore/config.toml", "[protocol\nversion = ");
    repo.lore()
        .arg("init")
        .assert()
        .code(1)
        .stderr(predicate::str::contains("corrupted and cannot be parsed"));
}

// ---------------------------------------------------------------------------
// commit
// ---------------------------------------------------------------------------

#[test]
fn commit_with_flags_writes_trailers() {
    let repo = Repo::new();
    repo.commit("README.md", "chore: initial");
    repo.write("src/auth.ts", "export const login = () => 1;\n");
    repo.git(&["add", "-A"]);

    let assert = repo
        .lore()
        .args([
            "commit",
            "--intent",
            "feat(auth): add login flow",
            "--body",
            "Sessions beat JWT here.",
            "--constraint",
            "must support horizontal scaling",
            "--rejected",
            "JWT | leaks roles",
            "--confidence",
            "high",
            "--scope-risk",
            "wide",
            "--tested",
            "unit",
            "--json",
        ])
        .assert()
        .success();
    let out = json(&assert.get_output().stdout);
    assert_eq!(out["success"], Value::Bool(true));
    let lore_id = out["loreId"].as_str().expect("loreId");
    assert_eq!(lore_id.len(), 8);
    assert!(lore_id.bytes().all(|b| b.is_ascii_hexdigit()));
    assert!(out["message"]
        .as_str()
        .unwrap_or("")
        .starts_with("Commit created: "));

    let message = repo.git(&["log", "-1", "--format=%B"]);
    assert!(message.starts_with("feat(auth): add login flow\n\nSessions beat JWT here.\n\n"));
    assert!(message.contains(&format!("Lore-id: {lore_id}")));
    assert!(message.contains("Constraint: must support horizontal scaling"));
    assert!(message.contains("Rejected: JWT | leaks roles"));
    assert!(message.contains("Tested: unit"));
    assert!(message.contains("Confidence: high"));
    assert!(message.contains("Scope-risk: wide"));
}

#[test]
fn commit_reads_json_from_stdin() {
    let repo = Repo::new();
    repo.commit("README.md", "chore: initial");
    repo.write("a.txt", "a\n");
    repo.git(&["add", "-A"]);

    repo.lore()
        .arg("commit")
        .write_stdin(
            r#"{"intent":"fix(core): handle empty input","trailers":{"Constraint":["never panic"],"Reversibility":"clean","Ticket":"ABC-1"}}"#,
        )
        .assert()
        .success()
        .stdout(predicate::str::contains("Commit created: "))
        .stdout(predicate::str::contains("| Lore-id: "));

    let message = repo.git(&["log", "-1", "--format=%B"]);
    assert!(message.contains("Constraint: never panic"));
    assert!(message.contains("Reversibility: clean"));
    assert!(message.contains("Ticket: ABC-1"));
}

#[test]
fn commit_without_staged_changes_exits_3() {
    let repo = Repo::new();
    repo.commit("README.md", "chore: initial");
    repo.lore()
        .args(["commit", "--intent", "feat: nothing staged"])
        .assert()
        .code(3)
        .stderr(predicate::str::contains("No staged changes"));
}

#[test]
fn commit_rejects_invalid_enum_values() {
    let repo = Repo::new();
    repo.commit("README.md", "chore: initial");
    repo.write("a.txt", "a\n");
    repo.git(&["add", "-A"]);
    repo.lore()
        .args(["commit", "--intent", "feat: x", "--confidence", "very"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains("Invalid Confidence value"));
}

#[test]
fn commit_no_edit_requires_amend() {
    let repo = Repo::new();
    repo.commit("README.md", "chore: initial");
    repo.lore()
        .args(["commit", "--no-edit"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains(
            "--no-edit can only be used with --amend",
        ));
}

#[test]
fn commit_amend_keeps_the_lore_id() {
    let repo = Repo::new();
    repo.commit("README.md", "chore: initial");
    repo.commit(
        "src/a.ts",
        &atom_message("feat: first", &["Lore-id: aaaa1111", "Confidence: low"]),
    );
    repo.write("src/a.ts", "changed\n");
    repo.git(&["add", "-A"]);

    repo.lore()
        .args([
            "commit",
            "--amend",
            "--intent",
            "feat: first, reworded",
            "--confidence",
            "high",
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Commit amended: "))
        .stdout(predicate::str::contains("| Lore-id: aaaa1111"));

    let message = repo.git(&["log", "-1", "--format=%B"]);
    assert!(message.starts_with("feat: first, reworded"));
    assert!(message.contains("Lore-id: aaaa1111"));
    assert!(message.contains("Confidence: high"));
    assert_eq!(repo.git(&["rev-list", "--count", "HEAD"]).trim(), "2");
}

#[test]
fn commit_amend_no_edit_passes_through() {
    let repo = Repo::new();
    repo.commit("README.md", "chore: initial");
    repo.commit(
        "src/a.ts",
        &atom_message("feat: first", &["Lore-id: aaaa1111"]),
    );
    repo.write("src/a.ts", "changed\n");
    repo.git(&["add", "-A"]);

    repo.lore()
        .args(["commit", "--amend", "--no-edit", "--json"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"loreId\": \"aaaa1111\""));

    repo.lore()
        .args(["commit", "--amend", "--no-edit", "--intent", "x"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains(
            "--no-edit keeps the existing message unchanged",
        ));
}

// ---------------------------------------------------------------------------
// log / context / constraints / rejected / directives / tested / why
// ---------------------------------------------------------------------------

fn seeded_repo() -> Repo {
    let repo = Repo::new();
    repo.commit("README.md", "chore: initial commit");
    repo.commit(
        "src/auth.ts",
        &atom_message(
            "feat(auth): add login flow",
            &[
                "Lore-id: aaaa1111",
                "Constraint: sessions must be server-side",
                "Rejected: JWT | leaks roles",
                "Confidence: high",
                "Directive: do not cache sessions [until:2020-01]",
                "Tested: unit",
                "Not-tested: redis failover",
            ],
        ),
    );
    repo.commit(
        "src/auth.ts",
        &atom_message(
            "fix(auth): rotate session ids",
            &[
                "Lore-id: bbbb2222",
                "Constraint: rotate on privilege change",
                "Confidence: medium",
                "Related: aaaa1111",
            ],
        ),
    );
    repo.commit("docs/notes.md", "docs: plain commit without lore");
    repo
}

#[test]
fn log_json_lists_atoms_newest_first_with_files() {
    let repo = seeded_repo();
    let assert = repo.lore().args(["log", "--json"]).assert().success();
    let out = json(&assert.get_output().stdout);
    assert_eq!(out["command"], "log");
    assert_eq!(out["target"], "all");
    assert_eq!(out["target_type"], "global");
    let results = out["results"].as_array().expect("results");
    assert_eq!(results.len(), 2);
    assert_eq!(results[0]["lore_id"], "bbbb2222");
    assert_eq!(results[1]["lore_id"], "aaaa1111");
    assert_eq!(
        results[0]["files_changed"],
        serde_json::json!(["src/auth.ts"])
    );
    assert_eq!(
        results[0]["trailers"]["related"],
        serde_json::json!(["aaaa1111"])
    );
    assert_eq!(
        results[1]["trailers"]["not_tested"],
        serde_json::json!(["redis failover"])
    );
    assert_eq!(results[1]["superseded"], Value::Bool(false));
    assert_eq!(results[1]["superseded_by"], Value::Null);
    assert_eq!(out["meta"]["total_atoms"], 2);
    assert_eq!(out["meta"]["filtered_atoms"], 2);
    assert_eq!(out["meta"]["newest"], "2026-10-01T10:00:00.000Z");
}

#[test]
fn log_accepts_paths_and_limit() {
    let repo = seeded_repo();
    let assert = repo
        .lore()
        .args(["log", "--json", "--", "docs/"])
        .assert()
        .success();
    assert_eq!(
        json(&assert.get_output().stdout)["results"],
        serde_json::json!([])
    );

    let assert = repo
        .lore()
        .args(["log", "--limit", "1", "--json", "src/auth.ts"])
        .assert()
        .success();
    let out = json(&assert.get_output().stdout);
    assert_eq!(out["results"].as_array().map(Vec::len), Some(1));
    assert_eq!(out["meta"]["total_atoms"], 2);
    assert_eq!(out["meta"]["filtered_atoms"], 1);
}

#[test]
fn log_text_output_shows_headers_and_count() {
    let repo = seeded_repo();
    repo.lore()
        .arg("log")
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "── bbbb2222 (2026-10-01, lore@example.com) ",
        ))
        .stdout(predicate::str::contains(
            "Constraint: rotate on privilege change",
        ))
        .stdout(predicate::str::contains("2 of 2 atoms shown"));
}

#[test]
fn constraints_shows_only_constraints_and_context_shows_all() {
    let repo = seeded_repo();
    repo.lore()
        .args(["constraints", "src/auth.ts"])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Constraint: sessions must be server-side",
        ))
        .stdout(predicate::str::contains("Rejected:").not());

    repo.lore()
        .args(["context", "src/auth.ts"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Rejected: JWT | leaks roles"))
        .stdout(predicate::str::contains("Directive: do not cache sessions"));

    repo.lore()
        .args(["rejected", "src/auth.ts", "--json"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"rejected\""))
        .stdout(predicate::str::contains("\"constraint\"").not());

    repo.lore()
        .args(["directives", "src/"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Directive:"));

    repo.lore()
        .args(["coverage", "src/auth.ts"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Tested: unit"))
        .stdout(predicate::str::contains("Not-tested: redis failover"));
}

#[test]
fn path_queries_report_nothing_for_untouched_paths() {
    let repo = seeded_repo();
    repo.lore()
        .args(["context", "docs/notes.md"])
        .assert()
        .success()
        .stdout("No lore atoms found.\n");
}

#[test]
fn scope_filter_matches_conventional_commit_scope() {
    let repo = seeded_repo();
    let assert = repo
        .lore()
        .args(["context", "ignored", "--scope", "auth", "--json"])
        .assert()
        .success();
    let out = json(&assert.get_output().stdout);
    assert_eq!(out["target"], "scope:auth");
    assert_eq!(out["results"].as_array().map(Vec::len), Some(2));
}

#[test]
fn superseded_atoms_are_hidden_unless_all() {
    let repo = Repo::new();
    repo.commit("README.md", "chore: initial");
    repo.commit(
        "src/a.ts",
        &atom_message("feat: v1", &["Lore-id: aaaa1111"]),
    );
    repo.commit(
        "src/a.ts",
        &atom_message("feat: v2", &["Lore-id: bbbb2222", "Supersedes: aaaa1111"]),
    );

    let assert = repo
        .lore()
        .args(["context", "src/a.ts", "--json"])
        .assert()
        .success();
    let out = json(&assert.get_output().stdout);
    assert_eq!(out["results"].as_array().map(Vec::len), Some(1));
    assert_eq!(out["results"][0]["lore_id"], "bbbb2222");
    assert_eq!(out["meta"]["total_atoms"], 2);

    let assert = repo
        .lore()
        .args(["context", "src/a.ts", "--all", "--json"])
        .assert()
        .success();
    let out = json(&assert.get_output().stdout);
    assert_eq!(out["results"].as_array().map(Vec::len), Some(2));
    assert_eq!(out["results"][1]["superseded"], Value::Bool(true));
    assert_eq!(out["results"][1]["superseded_by"], "bbbb2222");

    repo.lore()
        .args(["context", "src/a.ts", "--all"])
        .assert()
        .success()
        .stdout(predicate::str::contains("(superseded by bbbb2222)"));
}

#[test]
fn follow_pulls_in_referenced_atoms() {
    let repo = Repo::new();
    repo.commit("README.md", "chore: initial");
    repo.commit(
        "src/core.ts",
        &atom_message("feat: core", &["Lore-id: aaaa1111"]),
    );
    repo.commit(
        "src/ui.ts",
        &atom_message("feat: ui", &["Lore-id: bbbb2222", "Depends-on: aaaa1111"]),
    );

    let assert = repo
        .lore()
        .args(["context", "src/ui.ts", "--follow", "--json"])
        .assert()
        .success();
    let ids: Vec<String> = json(&assert.get_output().stdout)["results"]
        .as_array()
        .expect("results")
        .iter()
        .map(|r| r["lore_id"].as_str().unwrap_or("").to_owned())
        .collect();
    assert_eq!(ids, vec!["bbbb2222", "aaaa1111"]);
}

#[test]
fn why_resolves_blame_to_atoms() {
    let repo = seeded_repo();
    repo.lore()
        .args(["why", "src/auth.ts:1"])
        .assert()
        .success()
        .stdout(predicate::str::contains("bbbb2222"));

    repo.lore()
        .args(["why", "src/auth.ts"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains(
            "Target must be file:line or file:line-line format",
        ));
}

// ---------------------------------------------------------------------------
// search / trace
// ---------------------------------------------------------------------------

#[test]
fn search_filters_by_enum_text_and_has() {
    let repo = seeded_repo();
    let assert = repo
        .lore()
        .args(["search", "--confidence", "high", "--json"])
        .assert()
        .success();
    let out = json(&assert.get_output().stdout);
    assert_eq!(out["target"], "confidence=high");
    assert_eq!(out["target_type"], "search");
    assert_eq!(out["results"].as_array().map(Vec::len), Some(1));
    assert_eq!(out["results"][0]["lore_id"], "aaaa1111");

    let assert = repo
        .lore()
        .args(["search", "--text", "rotate", "--json"])
        .assert()
        .success();
    assert_eq!(
        json(&assert.get_output().stdout)["results"][0]["lore_id"],
        "bbbb2222"
    );

    let assert = repo
        .lore()
        .args(["search", "--has", "Related", "--json"])
        .assert()
        .success();
    assert_eq!(
        json(&assert.get_output().stdout)["results"]
            .as_array()
            .map(Vec::len),
        Some(1)
    );

    let assert = repo
        .lore()
        .args(["search", "--author", "nobody@example.com", "--json"])
        .assert()
        .success();
    assert_eq!(
        json(&assert.get_output().stdout)["results"],
        serde_json::json!([])
    );
}

#[test]
fn trace_follows_reference_edges() {
    let repo = seeded_repo();
    repo.lore()
        .args(["trace", "bbbb2222"])
        .assert()
        .success()
        .stdout(predicate::str::starts_with(
            "bbbb2222 fix(auth): rotate session ids",
        ))
        .stdout(predicate::str::contains(
            "└── [Related] aaaa1111 feat(auth): add login flow",
        ));

    let assert = repo
        .lore()
        .args(["trace", "bbbb2222", "--json"])
        .assert()
        .success();
    let out = json(&assert.get_output().stdout);
    assert_eq!(out["root"]["lore_id"], "bbbb2222");
    assert_eq!(out["edges"][0]["relationship"], "Related");
    assert_eq!(out["edges"][0]["resolved"], Value::Bool(true));
    assert_eq!(out["edges"][0]["target_atom"]["lore_id"], "aaaa1111");

    repo.lore()
        .args(["trace", "cccc3333"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains("not found in commit history"));
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

#[test]
fn validate_exit_codes_follow_severity() {
    let repo = Repo::new();
    repo.commit("README.md", "chore: initial");
    repo.commit(
        "src/a.ts",
        &atom_message("feat: valid atom", &["Lore-id: aaaa1111"]),
    );
    repo.lore()
        .arg("validate")
        .assert()
        .success()
        .stdout(predicate::str::contains("✓ aaaa1111"))
        .stdout(predicate::str::contains("1 commits checked, all valid"));

    // Warning only: a dangling reference.
    repo.commit(
        "src/b.ts",
        &atom_message(
            "feat: dangling",
            &["Lore-id: bbbb2222", "Related: ffff9999"],
        ),
    );
    repo.lore()
        .arg("validate")
        .assert()
        .code(2)
        .stdout(predicate::str::contains("[reference-exists]"))
        .stdout(predicate::str::contains("1 warnings"));
    repo.lore().args(["validate", "--strict"]).assert().code(1);

    // Error: no Lore-id.
    repo.commit("src/c.ts", "feat: forgot the trailers");
    let assert = repo.lore().args(["validate", "--json"]).assert().code(1);
    let out = json(&assert.get_output().stdout);
    assert_eq!(out["valid"], Value::Bool(false));
    assert_eq!(out["summary"]["errors"], 1);
    assert_eq!(out["results"][0]["issues"][0]["rule"], "lore-id-present");

    // Ranges and --last.
    repo.lore()
        .args(["validate", "--last", "3"])
        .assert()
        .code(1);
    repo.lore()
        .args(["validate", "HEAD~3..HEAD~2"])
        .assert()
        .success();
}

#[test]
fn validate_commit_msg_file_mode_for_hooks() {
    let repo = Repo::new();
    repo.commit("README.md", "chore: initial");
    repo.write(
        "msg-ok.txt",
        "feat: hook message\n\nLore-id: abcdef12\nConfidence: high\n",
    );
    repo.write("msg-bad.txt", "feat: hook message without trailers\n");

    repo.lore()
        .args(["validate", "--commit-msg-file", "msg-ok.txt"])
        .assert()
        .success()
        .stdout(predicate::str::contains("✓ abcdef12"));

    repo.lore()
        .args(["validate", "--commit-msg-file", "msg-bad.txt"])
        .assert()
        .code(1)
        .stdout(predicate::str::contains("Lore-id trailer is missing"));
}

// ---------------------------------------------------------------------------
// stale / squash / doctor
// ---------------------------------------------------------------------------

#[test]
fn stale_reports_old_and_low_confidence_atoms() {
    let repo = Repo::new();
    repo.commit("README.md", "chore: initial");
    repo.commit_at(
        "src/old.ts",
        &atom_message(
            "feat: old decision",
            &["Lore-id: aaaa1111", "Confidence: low"],
        ),
        DATE_OLD,
    );
    repo.commit(
        "src/new.ts",
        &atom_message(
            "feat: fresh decision",
            &["Lore-id: bbbb2222", "Confidence: high"],
        ),
    );

    let assert = repo.lore().args(["stale", "--json"]).assert().success();
    let out = json(&assert.get_output().stdout);
    let stale = out["stale_atoms"].as_array().expect("stale_atoms");
    assert_eq!(stale.len(), 1);
    assert_eq!(stale[0]["lore_id"], "aaaa1111");
    let signals: Vec<&str> = stale[0]["reasons"]
        .as_array()
        .expect("reasons")
        .iter()
        .map(|r| r["signal"].as_str().unwrap_or(""))
        .collect();
    assert!(signals.contains(&"age"), "{signals:?}");
    assert!(signals.contains(&"low-confidence"), "{signals:?}");

    repo.lore()
        .args(["stale", "--low-confidence"])
        .assert()
        .success()
        .stdout(predicate::str::contains("STALE  aaaa1111 (2024-01-01)"))
        .stdout(predicate::str::contains(
            "Atom is marked as Confidence: low",
        ));

    repo.lore()
        .args(["stale", "src/new.ts"])
        .assert()
        .success()
        .stdout("No stale atoms found.\n");
}

#[test]
fn squash_merges_atoms_in_a_range() {
    let repo = Repo::new();
    repo.commit("README.md", "chore: initial");
    repo.commit("README.md", "chore: no lore here");
    // Distinct dates: the merged intent comes from the newest atom.
    repo.commit_at(
        "src/a.ts",
        &atom_message(
            "feat: step one",
            &[
                "Lore-id: aaaa1111",
                "Constraint: keep it small",
                "Confidence: high",
            ],
        ),
        "2026-09-01T10:00:00+00:00",
    );
    repo.commit(
        "src/b.ts",
        &atom_message(
            "feat: step two",
            &[
                "Lore-id: bbbb2222",
                "Constraint: no new deps",
                "Confidence: low",
                "Depends-on: aaaa1111",
            ],
        ),
    );

    let assert = repo
        .lore()
        .args(["squash", "HEAD~2..HEAD"])
        .assert()
        .success();
    let out = String::from_utf8_lossy(&assert.get_output().stdout).into_owned();
    assert!(out.starts_with("feat: step two\n\nLore-id: "), "{out}");
    // Array trailers are unioned in git order (newest first), as in TS.
    assert!(
        out.contains("Constraint: no new deps\nConstraint: keep it small\n"),
        "{out}"
    );
    assert!(out.contains("Confidence: low"));
    assert!(
        !out.contains("Depends-on: aaaa1111"),
        "internal refs are dropped: {out}"
    );

    repo.lore()
        .args(["squash", "HEAD~1..HEAD", "--intent", "feat: merged"])
        .assert()
        .success()
        .stdout(predicate::str::starts_with("feat: merged\n"));

    repo.lore()
        .args(["squash", "HEAD~3..HEAD~2"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains(
            "No Lore atoms found in the specified range.",
        ));
}

#[test]
fn doctor_reports_checks_and_summary() {
    let repo = Repo::new();
    repo.commit("README.md", "chore: initial");
    repo.commit("src/a.ts", &atom_message("feat: a", &["Lore-id: aaaa1111"]));
    repo.commit(
        "src/b.ts",
        &atom_message("feat: b", &["Lore-id: bbbb2222", "Related: cccc3333"]),
    );

    let assert = repo.lore().args(["doctor", "--json"]).assert().success();
    let out = json(&assert.get_output().stdout);
    let checks = out["checks"].as_array().expect("checks");
    assert_eq!(checks.len(), 4);
    assert_eq!(checks[0]["name"], "Config file");
    assert_eq!(checks[0]["status"], "warning");
    assert_eq!(checks[1]["name"], "Lore-id uniqueness");
    assert_eq!(checks[1]["status"], "ok");
    assert_eq!(checks[2]["status"], "warning");
    assert_eq!(out["summary"]["warnings"], 2);
    assert_eq!(out["summary"]["errors"], 0);

    repo.lore().arg("init").assert().success();
    repo.lore()
        .arg("doctor")
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "OK  Config file: Found and parsed",
        ))
        .stdout(predicate::str::contains(
            "WARNING  Reference resolution: 1 broken reference(s) found",
        ))
        .stdout(predicate::str::contains("1 warnings"));
}

// ---------------------------------------------------------------------------
// hooks
// ---------------------------------------------------------------------------

#[test]
fn hooks_install_update_and_uninstall() {
    let repo = Repo::new();
    repo.commit("README.md", "chore: initial");
    let hook = repo.path().join(".git/hooks/commit-msg");

    repo.lore()
        .args(["hooks", "install"])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Lore commit-msg hook installed at",
        ));
    let script = fs::read_to_string(&hook).expect("hook written");
    assert!(script.starts_with("#!/usr/bin/env bash\n# LORE-MANAGED-HOOK"));
    assert!(script.contains("lore validate --commit-msg-file \"$COMMIT_MSG_FILE\" --strict"));
    assert!(script.contains("^Merge "));

    repo.lore()
        .args(["hooks", "install"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Lore commit-msg hook updated."));

    repo.lore()
        .args(["hooks", "uninstall"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Lore commit-msg hook removed."));
    assert!(!hook.exists());

    repo.lore()
        .args(["hooks", "uninstall"])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "No commit-msg hook found. Nothing to remove.",
        ));
}

#[test]
fn hooks_install_refuses_foreign_hook_without_force() {
    let repo = Repo::new();
    repo.commit("README.md", "chore: initial");
    repo.write(".git/hooks/commit-msg", "#!/bin/sh\necho custom\n");

    repo.lore()
        .args(["hooks", "install"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains("Use --force to overwrite"));

    repo.lore()
        .args(["hooks", "install", "--force"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Existing hook backed up to"));
    assert!(repo.path().join(".git/hooks/commit-msg.bak").exists());

    repo.lore().args(["hooks", "uninstall"]).assert().success();
    repo.write(".git/hooks/commit-msg", "#!/bin/sh\necho custom\n");
    repo.lore()
        .args(["hooks", "uninstall"])
        .assert()
        .code(1)
        .stderr(predicate::str::contains("was not installed by Lore"));
}
