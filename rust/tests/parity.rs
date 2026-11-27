//! Differential parity harness: runs the Rust `lore` binary and the
//! TypeScript CLI on identical repositories and compares them.
//!
//! Gated on `LORE_TS_CLI=/abs/path/to/dist/main.js`; skipped when unset.
//! Every fixture is built twice with the same steps, fixed identities and
//! fixed dates, so both repositories have identical commit hashes and every
//! difference in output is a difference between the implementations.
//!
//! Compared per case: the exit code, stdout byte for byte, stderr byte for
//! byte, and afterwards the state each CLI left behind (every commit
//! message, `git status`, `.lore/config.toml`, the commit-msg hook).
//! Normalisers cover output that is legitimately nondeterministic or
//! documented as different (see `rust/README.md`):
//! - freshly generated Lore-ids and the commit hashes that embed them, and
//!   only those: ids and hashes already in the fixture history are compared
//!   exactly (an amend must keep its Lore-id);
//! - the repository's absolute path;
//! - the parser's text after "Commit input is not valid JSON:";
//! - clap vs Commander usage and help text (exit code compared only).

mod common;

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command as Proc, Output};
use std::sync::LazyLock;

use assert_cmd::Command;
use common::{atom_message, git_available, Repo, DATE_OLD};
use regex::Regex;

// ---- cases -----------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Compare {
    /// Exit code, stdout and stderr, after the always-on normalisers.
    Exact,
    /// As `Exact`, also masking freshly generated Lore-ids and hashes.
    GeneratedIds,
    /// Exit code only (clap and Commander word usage and help differently).
    ExitCode,
}

struct Case {
    args: Vec<String>,
    compare: Compare,
    /// Working directory relative to the repository root.
    cwd: &'static str,
    stdin: Option<&'static str>,
}

fn case(args: &[&str]) -> Case {
    Case {
        args: args.iter().map(|a| a.to_string()).collect(),
        compare: Compare::Exact,
        cwd: "",
        stdin: None,
    }
}

impl Case {
    fn compare(mut self, compare: Compare) -> Self {
        self.compare = compare;
        self
    }

    fn cwd(mut self, cwd: &'static str) -> Self {
        self.cwd = cwd;
        self
    }

    fn stdin(mut self, stdin: &'static str) -> Self {
        self.stdin = Some(stdin);
        self
    }

    fn label(&self) -> String {
        let cwd = if self.cwd.is_empty() {
            String::new()
        } else {
            format!(" (in {})", self.cwd)
        };
        format!("lore {}{cwd}", self.args.join(" "))
    }
}

/// Each case in text mode and again with `--json`.
fn both_formats(cases: Vec<Case>) -> Vec<Case> {
    cases
        .into_iter()
        .flat_map(|c| {
            let mut json = Case {
                args: c.args.clone(),
                compare: c.compare,
                cwd: c.cwd,
                stdin: c.stdin,
            };
            json.args.push("--json".to_owned());
            [c, json]
        })
        .collect()
}

// ---- fixtures --------------------------------------------------------------

type Fixture = fn(&Repo);

fn unborn(_repo: &Repo) {}

fn linear_seeded(repo: &Repo) {
    repo.commit_at("README.md", "chore: initial commit", DATE_OLD);
    repo.commit_at(
        "src/auth.ts",
        &atom_message(
            "feat(auth): add login flow",
            &[
                "Lore-id: aaaa1111",
                "Constraint: sessions must be server-side",
                "Rejected: JWT | leaks roles",
                "Confidence: low",
                "Scope-risk: wide",
                "Reversibility: migration-needed",
                "Directive: do not cache sessions [until:2020-01]",
                "Directive: keep the cookie httpOnly",
                "Tested: unit",
                "Not-tested: redis failover",
                "Ticket: AUTH-1",
            ],
        ),
        DATE_OLD,
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
    repo.commit(
        "src/db/query.ts",
        &atom_message(
            "feat(db): parameterise queries",
            &[
                "Lore-id: cccc3333",
                "Depends-on: aaaa1111",
                "Confidence: high",
                "Tested: integration",
            ],
        ),
    );
}

fn side_branch_poison(repo: &Repo) {
    repo.commit_at("README.md", "chore: initial commit", DATE_OLD);
    repo.git(&["checkout", "-q", "-b", "poison-branch"]);
    repo.commit_at(
        "poison/decision.md",
        &atom_message("feat: poison atom", &["Lore-id: deadbeef"]),
        "2030-01-01T00:00:00+00:00",
    );
    repo.git(&["checkout", "-q", "main"]);
    repo.commit_at(
        "docs/decision.md",
        &atom_message(
            "feat: legit atom",
            &["Lore-id: deadbeef", "Related: cafe1234"],
        ),
        DATE_OLD,
    );
    repo.git(&["checkout", "-q", "-b", "side-branch"]);
    repo.commit_at(
        "side/decision.md",
        &atom_message("feat: side atom", &["Lore-id: cafe1234"]),
        DATE_OLD,
    );
    repo.git(&["checkout", "-q", "main"]);
}

fn supersession_shapes(repo: &Repo) {
    repo.commit("README.md", "chore: initial commit");
    // Chain: 22222222 <- 33333333 <- 44444444 (live tail).
    repo.commit(
        "a.md",
        &atom_message("feat(chain): a", &["Lore-id: 22222222"]),
    );
    repo.commit(
        "b.md",
        &atom_message(
            "feat(chain): b",
            &["Lore-id: 33333333", "Supersedes: 22222222"],
        ),
    );
    repo.commit(
        "c.md",
        &atom_message(
            "feat(chain): c",
            &["Lore-id: 44444444", "Supersedes: 33333333"],
        ),
    );
    repo.commit(
        "d.md",
        &atom_message(
            "feat(dep): d",
            &["Lore-id: 11111111", "Depends-on: 22222222"],
        ),
    );
    // Cycle: 55555555 <-> 66666666, and a self-supersession.
    repo.commit(
        "e.md",
        &atom_message(
            "feat(cycle): e",
            &["Lore-id: 55555555", "Supersedes: 66666666"],
        ),
    );
    repo.commit(
        "f.md",
        &atom_message(
            "feat(cycle): f",
            &["Lore-id: 66666666", "Supersedes: 55555555"],
        ),
    );
    repo.commit(
        "g.md",
        &atom_message(
            "feat(self): g",
            &["Lore-id: 77777777", "Supersedes: 77777777"],
        ),
    );
    repo.commit(
        "h.md",
        &atom_message(
            "feat(dep): h",
            &[
                "Lore-id: 88888888",
                "Depends-on: 55555555",
                "Depends-on: 77777777",
            ],
        ),
    );
}

fn dangling_references(repo: &Repo) {
    repo.commit("README.md", "chore: initial commit");
    repo.commit(
        "a.md",
        &atom_message("feat: a", &["Lore-id: deadbee0", "Related: ffff9999"]),
    );
    repo.commit(
        "b.md",
        &atom_message(
            "feat: b",
            &[
                "Lore-id: abcd1234",
                "Supersedes: 0000aaaa",
                "Depends-on: deadbee0",
            ],
        ),
    );
    repo.commit("c.md", "feat: no trailers at all");
}

fn mixed_scopes(repo: &Repo) {
    repo.commit("README.md", "chore: initial commit");
    repo.commit(
        "api/a.ts",
        &atom_message("feat(api): a", &["Lore-id: a0000001"]),
    );
    repo.commit(
        "api/b.ts",
        &atom_message("fix(API): b", &["Lore-id: a0000002"]),
    );
    repo.commit(
        "x/c.ts",
        &atom_message("feat(a.b): dotted", &["Lore-id: a0000003"]),
    );
    repo.commit(
        "x/d.ts",
        &atom_message("feat(axb): lookalike", &["Lore-id: a0000004"]),
    );
    repo.commit("api/e.ts", "chore(api): no trailers");
    repo.commit(
        "x/f.ts",
        &atom_message("feat(billing): newest", &["Lore-id: a0000005"]),
    );
}

/// Atoms whose enum trailers are invalid (unknown, wrong case, empty).
fn invalid_enums(repo: &Repo) {
    repo.commit("README.md", "chore: initial commit");
    repo.commit(
        "a.md",
        &atom_message(
            "fix: unknown confidence",
            &["Lore-id: 1111aaaa", "Confidence: very-high"],
        ),
    );
    repo.commit(
        "b.md",
        &atom_message(
            "fix: cased and empty",
            &[
                "Lore-id: 2222aaaa",
                "Confidence: High",
                "Scope-risk:",
                "Reversibility: maybe",
            ],
        ),
    );
    repo.commit(
        "c.md",
        &atom_message(
            "fix: valid",
            &[
                "Lore-id: 3333aaaa",
                "Confidence: high",
                "Scope-risk: narrow",
            ],
        ),
    );
}

/// A config at the outer root and a nested repository below it: discovery
/// from inside `inner/` must stop at `inner/.git` and never see the outer
/// config.
fn nested_repository(repo: &Repo) {
    linear_seeded(repo);
    repo.write(".lore/config.toml", "[trailers]\nrequired = [\"Ticket\"]\n");
    repo.write("inner/a.md", "inner\n");
    repo.git(&["-C", "inner", "init", "-q"]);
    repo.git(&["-C", "inner", "add", "-A"]);
    repo.git(&[
        "-C",
        "inner",
        "commit",
        "-q",
        "-m",
        "feat: inner atom\n\nLore-id: 1234abcd",
    ]);
}

/// A repository with one staged file, ready for `lore commit`.
fn staged(repo: &Repo) {
    linear_seeded(repo);
    repo.write("src/new.ts", "new\n");
    repo.git(&["add", "-A"]);
}

fn staged_on_unborn(repo: &Repo) {
    repo.write("first.txt", "first\n");
    repo.git(&["add", "-A"]);
}

/// Staged changes on a branch whose name has a dot, and on a detached HEAD:
/// git's `[branch hash]` summary line takes a different shape in each.
fn staged_on_a_dotted_branch(repo: &Repo) {
    linear_seeded(repo);
    repo.git(&["checkout", "-q", "-b", "release/v0.8.1"]);
    repo.write("src/new.ts", "new\n");
    repo.git(&["add", "-A"]);
}

fn staged_on_a_detached_head(repo: &Repo) {
    linear_seeded(repo);
    repo.git(&["checkout", "-q", "--detach"]);
    repo.write("src/new.ts", "new\n");
    repo.git(&["add", "-A"]);
}

/// A ref pointing at a missing object: `git log --all` fails, so the Lore-id
/// index cannot be built and the reference checks take their skip path.
fn with_dangling_ref(repo: &Repo) {
    staged(repo);
    repo.write(
        ".git/refs/heads/broken",
        "0123456789abcdef0123456789abcdef01234567\n",
    );
}

/// Commit message files for `validate --commit-msg-file` (hook mode).
fn hook_messages(repo: &Repo) {
    linear_seeded(repo);
    repo.write(
        "msg-clean.txt",
        "feat: clean\n\nLore-id: abcdef12\nConfidence: high\n",
    );
    repo.write(
        "msg-warn.txt",
        "feat: dangling\n\nLore-id: abcdef12\nRelated: ffff9999\n",
    );
    repo.write("msg-error.txt", "feat: no trailers\n");
}

// ---- running ---------------------------------------------------------------

struct Run {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

impl From<Output> for Run {
    fn from(output: Output) -> Self {
        Run {
            code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        }
    }
}

fn run_ts(ts_cli: &Path, repo: &Repo, case: &Case) -> Run {
    let mut cmd = Proc::new("node");
    cmd.arg(ts_cli)
        .args(&case.args)
        .current_dir(repo.path().join(case.cwd))
        .envs(repo.env());
    with_stdin(cmd, case.stdin)
}

fn run_rust(repo: &Repo, case: &Case) -> Run {
    let mut cmd = Command::cargo_bin("lore").expect("lore binary built");
    cmd.args(&case.args)
        .current_dir(repo.path().join(case.cwd))
        .envs(repo.env());
    cmd.write_stdin(case.stdin.unwrap_or(""));
    cmd.output().expect("lore runs").into()
}

fn with_stdin(mut cmd: Proc, stdin: Option<&str>) -> Run {
    use std::io::Write;
    use std::process::Stdio;
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("node runs");
    if let Some(mut pipe) = child.stdin.take() {
        pipe.write_all(stdin.unwrap_or("").as_bytes())
            .expect("write stdin");
    }
    child.wait_with_output().expect("node finishes").into()
}

// ---- normalising -----------------------------------------------------------

/// Where a freshly generated Lore-id or commit hash can appear.
static GENERATED_LORE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(Lore-id: |"loreId": "|"lore_id": ")([0-9a-f]{8})"#).unwrap());
/// A commit hash in CLI output, or a full hash alone on a line (`git log
/// --format=%H`).
static GENERATED_HASH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?m)(Commit (?:created|amended): |"hash": ")([0-9a-f]{7,40})|^()([0-9a-f]{40})$"#)
        .unwrap()
});
static HISTORY_LORE_ID: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?m)^Lore-id:\s*([0-9a-f]{8})").unwrap());

/// Lore-ids and commit hashes already in a fixture's history, before the
/// case runs. Only values outside this set count as generated.
struct KnownHistory {
    lore_ids: HashSet<String>,
    hashes: Vec<String>,
}

impl KnownHistory {
    fn of(repo: &Repo) -> Self {
        KnownHistory {
            lore_ids: HISTORY_LORE_ID
                .captures_iter(&all_messages(repo))
                .map(|c| c[1].to_owned())
                .collect(),
            hashes: history(repo, "--format=%H")
                .lines()
                .map(str::to_owned)
                .collect(),
        }
    }

    fn is_known_hash(&self, candidate: &str) -> bool {
        self.hashes.iter().any(|h| h.starts_with(candidate))
    }

    /// Mask generated Lore-ids and hashes; keep every known one verbatim.
    fn mask_generated(&self, text: &str) -> String {
        let text = GENERATED_LORE_ID.replace_all(text, |c: &regex::Captures<'_>| {
            if self.lore_ids.contains(&c[2]) {
                c[0].to_owned()
            } else {
                format!("{}<new-lore-id>", &c[1])
            }
        });
        GENERATED_HASH
            .replace_all(&text, |c: &regex::Captures<'_>| {
                let (prefix, hash) = match (c.get(1), c.get(2)) {
                    (Some(prefix), Some(hash)) => (prefix.as_str(), hash.as_str()),
                    _ => ("", &c[4]),
                };
                if self.is_known_hash(hash) {
                    c[0].to_owned()
                } else {
                    format!("{prefix}<new-hash>")
                }
            })
            .into_owned()
    }
}

/// `git log` over every ref, falling back to HEAD when a ref is broken (the
/// dangling-ref fixture); empty before the first commit.
fn history(repo: &Repo, format: &str) -> String {
    let log = |revs: &[&str]| {
        Proc::new("git")
            .arg("log")
            .arg(format)
            .args(revs)
            .current_dir(repo.path())
            .envs(repo.env())
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
    };
    log(&["--all"])
        .or_else(|| log(&["HEAD"]))
        .unwrap_or_default()
}

/// Every commit message, each preceded by its hash.
fn all_messages(repo: &Repo) -> String {
    history(repo, "--format=%H%n%B")
}

static JSON_PARSE_ERROR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(Commit input is not valid JSON: )[^"\n]*"#).unwrap());

fn normalise(text: &str, repo: &Repo, compare: Compare, known: &KnownHistory) -> String {
    let mut text = text.to_owned();
    for root in repo_roots(repo) {
        text = text.replace(&root, "<repo>");
    }
    text = JSON_PARSE_ERROR
        .replace_all(&text, "${1}<parser message>")
        .into_owned();
    if compare == Compare::GeneratedIds {
        text = known.mask_generated(&text);
    }
    text
}

/// The state a CLI run leaves behind, as (what, contents) pairs.
fn repository_state(repo: &Repo) -> Vec<(&'static str, String)> {
    let read = |rel: &str| {
        fs::read_to_string(repo.path().join(rel)).unwrap_or_else(|_| "<absent>".to_owned())
    };
    vec![
        ("git log --all --format=%H%n%B", all_messages(repo)),
        (
            "git status --porcelain",
            repo.git(&["status", "--porcelain"]),
        ),
        (".lore/config.toml", read(".lore/config.toml")),
        (".git/hooks/commit-msg", read(".git/hooks/commit-msg")),
    ]
}

/// The repository path as given and as resolved (macOS `/var` -> `/private/var`).
fn repo_roots(repo: &Repo) -> Vec<String> {
    let mut roots = vec![repo.path().display().to_string()];
    if let Ok(real) = repo.path().canonicalize() {
        roots.insert(0, real.display().to_string());
    }
    roots
}

/// Compares one case on a fresh pair of identical repositories; returns a
/// description of every difference.
fn compare_case(ts_cli: &Path, fixture: Fixture, case: &Case) -> Vec<String> {
    let ts_repo = Repo::new();
    let rust_repo = Repo::new();
    fixture(&ts_repo);
    fixture(&rust_repo);
    assert_eq!(
        all_messages(&ts_repo),
        all_messages(&rust_repo),
        "fixtures must be identical"
    );
    // Identical fixtures share one known history.
    let known = KnownHistory::of(&ts_repo);

    let ts = run_ts(ts_cli, &ts_repo, case);
    let rust = run_rust(&rust_repo, case);

    let mut diffs = Vec::new();
    if ts.code != rust.code {
        diffs.push(format!("exit code: TS {:?}, Rust {:?}", ts.code, rust.code));
    }
    let mut compare_text = |what: &str, ts_text: &str, rust_text: &str| {
        let ts_text = normalise(ts_text, &ts_repo, case.compare, &known);
        let rust_text = normalise(rust_text, &rust_repo, case.compare, &known);
        if ts_text != rust_text {
            diffs.push(format!(
                "{what} differs\n--- TS\n{ts_text}\n--- Rust\n{rust_text}"
            ));
        }
    };
    if case.compare != Compare::ExitCode {
        compare_text("stdout", &ts.stdout, &rust.stdout);
        compare_text("stderr", &ts.stderr, &rust.stderr);
    }
    // Usage errors must leave no trace either, so state is always compared.
    for ((what, ts_state), (_, rust_state)) in repository_state(&ts_repo)
        .into_iter()
        .zip(repository_state(&rust_repo))
    {
        compare_text(what, &ts_state, &rust_state);
    }
    diffs
}

fn ts_cli() -> Option<PathBuf> {
    let path = std::env::var_os("LORE_TS_CLI").map(PathBuf::from)?;
    if !git_available() {
        eprintln!("git not available; skipping parity tests");
        return None;
    }
    assert!(
        path.is_file(),
        "LORE_TS_CLI={} is not a file (build the TS CLI first)",
        path.display()
    );
    Some(path)
}

/// Runs every case against `fixture` and fails listing every mismatch.
fn assert_parity(fixture: Fixture, cases: Vec<Case>) {
    let Some(ts) = ts_cli() else {
        eprintln!("LORE_TS_CLI not set; skipping parity tests");
        return;
    };
    let mismatches: Vec<String> = cases
        .iter()
        .flat_map(|case| {
            compare_case(&ts, fixture, case)
                .into_iter()
                .map(move |diff| format!("{}: {diff}", case.label()))
        })
        .collect();
    assert!(
        mismatches.is_empty(),
        "{} parity mismatch(es):\n\n{}",
        mismatches.len(),
        mismatches.join("\n\n")
    );
}

// ---- the parity suite ------------------------------------------------------

/// The 14 read-only query and maintenance commands.
fn read_only_cases(path: &str, line: &str, root_id: &str) -> Vec<Case> {
    both_formats(vec![
        case(&["log"]),
        case(&["context", path]),
        case(&["constraints", path]),
        case(&["rejected", path]),
        case(&["directives", path]),
        case(&["tested", path]),
        case(&["coverage", path]),
        case(&["why", line]),
        case(&["search"]),
        case(&["stale"]),
        case(&["trace", root_id]),
        case(&["validate"]),
        // squash prints a merged message with a freshly generated Lore-id.
        case(&["squash", "HEAD~1..HEAD"]).compare(Compare::GeneratedIds),
        case(&["doctor"]),
    ])
}

#[test]
fn parity_on_an_unborn_repository() {
    assert_parity(
        unborn,
        read_only_cases("README.md", "README.md:1", "aaaa1111"),
    );
}

#[test]
fn parity_on_a_linear_seeded_history() {
    let mut cases = read_only_cases("src/auth.ts", "src/auth.ts:1", "bbbb2222");
    cases.extend(both_formats(vec![
        case(&["log", "--limit", "1"]),
        case(&["log", "--since", "2025-01-01"]),
        case(&["log", "--max-commits", "2"]),
        case(&["log", "src/auth.ts"]),
        case(&["context", "src/auth.ts", "--follow"]),
        case(&["context", "src/db/query.ts", "--follow"]),
        case(&["context", "src", "--all"]),
        case(&["context", "src", "--author", "LORE@example.com"]),
        case(&["context", "src", "--limit", "1"]),
        case(&["context", "src", "--max-commits", "1"]),
        case(&["context", "ignored", "--scope", "auth"]),
        case(&["why", "src/auth.ts:1-2"]),
        case(&["search", "--text", "session"]),
        case(&["search", "--confidence", "low"]),
        case(&["search", "--scope-risk", "wide"]),
        case(&["search", "--reversibility", "migration-needed"]),
        case(&["search", "--has", "constraint"]),
        case(&["search", "--scope", "auth"]),
        case(&["search", "--author", "lore@example.com", "--limit", "1"]),
        case(&["search", "--until", "2025-01-01"]),
        case(&["stale", "--older-than", "1y"]),
        case(&["stale", "--drift", "1"]),
        case(&["stale", "--low-confidence"]),
        case(&["stale", "src/auth.ts"]),
        case(&["trace", "aaaa1111", "--max-depth", "1"]),
        case(&["validate", "--last", "4"]),
        case(&["validate", "--from", "HEAD~3"]),
        case(&["validate", "HEAD~3..HEAD"]),
        case(&["validate", "--from", ""]),
        case(&["validate", "--strict", "--last", "4"]),
        case(&["squash", "HEAD~4..HEAD"]).compare(Compare::GeneratedIds),
        case(&[
            "squash",
            "HEAD~4..HEAD",
            "--intent",
            "feat: merged",
            "--body",
            "b",
        ])
        .compare(Compare::GeneratedIds),
        case(&["doctor", "--all"]),
    ]));
    assert_parity(linear_seeded, cases);
}

#[test]
fn parity_from_a_subdirectory() {
    assert_parity(
        linear_seeded,
        both_formats(vec![
            case(&["context", "auth.ts"]).cwd("src"),
            case(&["constraints", "."]).cwd("src"),
            case(&["why", "auth.ts:1"]).cwd("src"),
            case(&["log", "db"]).cwd("src"),
            case(&["stale", "--drift", "1"]).cwd("src"),
            case(&["doctor"]).cwd("src"),
        ]),
    );
}

#[test]
fn parity_with_a_side_branch_poison_commit() {
    assert_parity(
        side_branch_poison,
        both_formats(vec![
            case(&["trace", "deadbeef"]),
            case(&["trace", "cafe1234"]),
            case(&["context", "docs"]),
            case(&["context", "docs", "--follow"]),
            case(&["log"]),
            case(&["doctor"]),
            case(&["doctor", "--all"]),
            case(&["validate", "--last", "2"]),
        ]),
    );
}

#[test]
fn parity_on_supersession_chains_cycles_and_self_supersession() {
    assert_parity(
        supersession_shapes,
        both_formats(vec![
            case(&["log"]),
            case(&["context", "."]),
            case(&["context", ".", "--all"]),
            case(&["search", "--all"]),
            case(&["search", "--scope", "cycle"]),
            case(&["trace", "11111111"]),
            case(&["trace", "55555555"]),
            case(&["trace", "77777777"]),
            case(&["stale"]),
            case(&["doctor"]),
            case(&["validate", "--last", "8"]),
        ]),
    );
}

#[test]
fn parity_with_dangling_references() {
    assert_parity(
        dangling_references,
        both_formats(vec![
            case(&["doctor"]),
            case(&["validate", "--last", "3"]),
            case(&["validate", "--last", "3", "--strict"]),
            case(&["trace", "abcd1234"]),
            case(&["context", ".", "--follow"]),
        ]),
    );
}

#[test]
fn parity_with_mixed_scopes() {
    assert_parity(
        mixed_scopes,
        both_formats(vec![
            case(&["context", "x", "--scope", "api"]),
            case(&["context", "x", "--scope", "api", "--max-commits", "1"]),
            case(&["context", "x", "--scope", "a.b"]),
            case(&["search", "--scope", "API"]),
            case(&["search", "--scope", "api", "--max-commits", "2"]),
        ]),
    );
}

#[test]
fn parity_for_errors_and_usage() {
    let mut cases = both_formats(vec![
        case(&["trace", "not-an-id"]),
        case(&["why", "no-line-number"]),
        case(&["why", "missing.ts:1"]),
        case(&["squash", "nope..HEAD"]),
        case(&["validate", "HEAD~1..HEAD", "--from", "HEAD"]),
        case(&["context", "src", "--limit", "0"]),
        case(&["log", "--max-commits", "abc"]),
        case(&["search", "--limit", "5x"]),
        case(&["validate", "--last", "0"]),
        case(&["stale", "--older-than", "garbage"]),
        // Not compared: `validate --last`, `trace --max-depth` and
        // `stale --drift` with a non-numeric value. TS 0.8.0 parses them
        // with a bare parseInt, so `abc` silently becomes NaN and exits 0;
        // Rust rejects it as a usage error (exit 1). Documented in README.md.
        // `trace --max-depth` moves to exact parity with the 0.8.1 port: TS
        // #90 parses it with parseNonNegativeInt (accepts 0, renders the
        // error through the formatter).
    ]);
    // The two-argument `--format json` form: TS's top-level handler only
    // recognises `--json` and `--format=json`.
    cases.extend([
        case(&["log", "--limit", "0", "--format", "json"]),
        case(&["log", "--limit", "0", "--format=json"]),
    ]);
    cases.extend(
        [
            &["--version"][..],
            &["--help"],
            &[],
            &["no-such-command"],
            &["validate", "--since", "HEAD"],
            &["log", "--no-such-flag"],
            &["trace"],
        ]
        .into_iter()
        .map(|args| case(args).compare(Compare::ExitCode)),
    );
    assert_parity(linear_seeded, cases);
}

#[test]
fn parity_for_commit() {
    let mut cases = both_formats(vec![
        case(&["commit", "--intent", "feat: x", "--related", "deadbeef"]),
        case(&[
            "commit",
            "--intent",
            "feat: x",
            "--supersedes",
            "aaaa1112",
            "--related",
            "abc1234",
            "--depends-on",
            "DEADBEEF",
        ]),
        case(&["commit", "--intent", "feat: x", "--confidence", "very-high"]),
        case(&["commit", "--no-edit"]),
        case(&["commit", "--amend", "--no-edit", "--intent", "x"]),
        case(&["commit", "--amend", "--no-edit"]),
        case(&["commit"]).stdin(r#"{"intent": "feat: flat", "Constraint": ["c"]}"#),
        case(&["commit"]).stdin(r#"{ intent: not json }"#),
        case(&["commit"]).stdin(r#"["intent"]"#),
        case(&["commit"]).stdin(r#"{"intent": "x", "trailers": null}"#),
    ]);
    cases.extend(
        both_formats(vec![
            case(&[
                "commit",
                "--intent",
                "feat: ok",
                "--constraint",
                "c1",
                "--constraint",
                "c2",
                "--confidence",
                "high",
                "--supersedes",
                "aaaa1111",
                "--related",
                "bbbb2222",
            ]),
            case(&[
                "commit",
                "--intent",
                "feat: x",
                "--related",
                "deadbeef",
                "--no-verify-refs",
            ]),
            case(&["commit", "--amend", "--intent", "fix: amended"]),
            case(&["commit"]).stdin(
                r#"{"intent": "feat: json", "trailers": {"Tested": ["t"], "Ticket": "T-9"}}"#,
            ),
            // Warnings: stderr lines in text mode, the payload array in JSON.
            case(&[
                "commit",
                "--intent",
                "feat: an intent that is far too long to fit within the seventy-two limit",
            ]),
        ])
        .into_iter()
        .map(|c| c.compare(Compare::GeneratedIds)),
    );
    assert_parity(staged, cases);
}

#[test]
fn parity_for_commit_on_an_unborn_head() {
    let cases = both_formats(vec![
        case(&["commit", "--intent", "feat: first", "--related", "deadbeef"]),
        case(&[
            "commit",
            "--intent",
            "feat: first",
            "--related",
            "deadbeef",
            "--no-verify-refs",
        ])
        .compare(Compare::GeneratedIds),
    ]);
    assert_parity(staged_on_unborn, cases);
}

#[test]
fn parity_for_nothing_staged() {
    assert_parity(
        linear_seeded,
        both_formats(vec![case(&["commit", "--intent", "feat: nothing staged"])]),
    );
}

#[test]
fn parity_when_the_lore_id_index_is_unavailable() {
    let mut cases = both_formats(vec![case(&["doctor"])]);
    cases.extend(
        both_formats(vec![
            case(&["commit", "--intent", "feat: x", "--related", "aaaa1111"]),
            case(&["commit", "--intent", "feat: x", "--related", "deadbeef"]),
        ])
        .into_iter()
        .map(|c| c.compare(Compare::GeneratedIds)),
    );
    assert_parity(with_dangling_ref, cases);

    // The fixture must really take the skip path, or the cases above would
    // pass without pinning it.
    let repo = Repo::new();
    with_dangling_ref(&repo);
    let doctor = run_rust(&repo, &case(&["doctor"]));
    assert!(
        doctor.stdout.contains("Reference resolution (skipped)"),
        "{}",
        doctor.stdout
    );
    let commit = run_rust(
        &repo,
        &case(&["commit", "--intent", "feat: x", "--related", "deadbeef"]),
    );
    assert_eq!(commit.code, Some(0), "{}", commit.stderr);
    assert!(
        commit
            .stderr
            .contains("validation skipped: the Lore-id index could not be built"),
        "{}",
        commit.stderr
    );
}

#[test]
fn parity_for_init_and_hooks() {
    let cases = both_formats(vec![
        case(&["init"]),
        case(&["hooks", "install"]),
        case(&["hooks", "uninstall"]),
    ]);
    assert_parity(linear_seeded, cases);
}

#[test]
fn parity_for_validate_hook_mode() {
    assert_parity(
        hook_messages,
        both_formats(vec![
            case(&["validate", "--commit-msg-file", "msg-clean.txt"]),
            case(&["validate", "--commit-msg-file", "msg-warn.txt"]),
            case(&["validate", "--commit-msg-file", "msg-warn.txt", "--strict"]),
            case(&["validate", "--commit-msg-file", "msg-error.txt"]),
        ]),
    );
}

#[test]
fn parity_for_invalid_enum_values() {
    assert_parity(
        invalid_enums,
        both_formats(vec![
            case(&["validate"]),
            case(&["validate", "--last", "3"]),
            case(&["validate", "--last", "3", "--strict"]),
            case(&["log"]),
            case(&["search", "--confidence", "high"]),
        ]),
    );
}

#[test]
fn parity_for_config_discovery_bounded_by_the_work_tree_root() {
    assert_parity(
        nested_repository,
        both_formats(vec![
            case(&["validate"]),
            case(&["validate"]).cwd("inner"),
            case(&["doctor"]).cwd("inner"),
        ]),
    );
}

#[test]
fn parity_for_the_commit_hash_on_unusual_heads() {
    let cases = || {
        both_formats(vec![case(&["commit", "--intent", "feat: x"])])
            .into_iter()
            .map(|c| c.compare(Compare::GeneratedIds))
            .collect::<Vec<_>>()
    };
    assert_parity(staged_on_a_dotted_branch, cases());
    assert_parity(staged_on_a_detached_head, cases());
}
