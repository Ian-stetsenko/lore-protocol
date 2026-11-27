//! Runs the real git binary against a throwaway repository. Covers behaviour
//! that cannot be asserted through a mocked `GitClient`: how git itself
//! interprets the arguments `ProcessGitClient` builds.

mod common;

use std::fs;
use std::path::PathBuf;

use common::{git_available, Repo};
use lore::interfaces::git_client::{CommitOptions, GitClient, LogOptions};
use lore::services::git_client::ProcessGitClient;

struct Fixture {
    repo: Repo,
    initial: String,
    atom: String,
    no_space: String,
    body_mention: String,
}

impl Fixture {
    fn new() -> Fixture {
        let repo = Repo::new();
        let initial = repo.commit("README.md", "chore: initial commit");
        let atom = repo.commit(
            "project/src/file.ts",
            "feat: first atom\n\nLore-id: aaaa1111\nConfidence: high",
        );
        let no_space = repo.commit(
            "project/src/other.ts",
            "feat: no-space trailer\n\nLore-id:bbbb2222",
        );
        let body_mention = repo.commit(
            "project/src/file.ts",
            "docs: mentions an id in the body\n\nLore-id: cccc3333 appears here but this paragraph is not the trailer block.\n\nSigned-off-by: Lore Test <lore@example.com>",
        );
        Fixture {
            repo,
            initial,
            atom,
            no_space,
            body_mention,
        }
    }

    fn commit(&self, file: &str, message: &str) -> String {
        self.repo.commit(file, message)
    }

    fn client(&self) -> ProcessGitClient {
        ProcessGitClient::new(Some(self.repo.path().to_path_buf()))
    }

    fn subdir_client(&self, sub: &str) -> ProcessGitClient {
        let path: PathBuf = self.repo.path().join(sub);
        ProcessGitClient::new(Some(path))
    }
}

/// Runs `body` with the fixture, applying the isolated git environment to
/// the test process so the client under test inherits it.
fn with_fixture(body: impl FnOnce(&Fixture)) {
    if !git_available() {
        eprintln!("git not available; skipping integration test");
        return;
    }
    let fixture = Fixture::new();
    // SAFETY-ish: tests in this binary run in threads of one process. The
    // variables match across tests except the global config path, and every
    // such config is empty (git ignores one that is already gone), so
    // concurrent sets are benign.
    for (k, v) in fixture.repo.env() {
        std::env::set_var(k, v);
    }
    body(&fixture);
}

#[test]
fn returns_every_commit_without_the_option() {
    with_fixture(|f| {
        let commits = f.client().log(&[], LogOptions::default()).expect("log");
        assert_eq!(commits.len(), 4);
    });
}

#[test]
fn skips_commits_with_no_lore_id_line_and_keeps_trailers_without_a_space_after_the_colon() {
    with_fixture(|f| {
        let commits = f.client().log(&[], LogOptions::LORE_ONLY).expect("log");
        let subjects: Vec<&str> = commits.iter().map(|c| c.subject.as_str()).collect();
        assert!(subjects.contains(&"feat: first atom"));
        assert!(subjects.contains(&"feat: no-space trailer"));
        assert!(!subjects.contains(&"chore: initial commit"));
    });
}

#[test]
fn is_only_a_coarse_filter_a_body_mention_is_a_candidate_but_its_trailer_block_has_no_lore_id() {
    with_fixture(|f| {
        let commits = f.client().log(&[], LogOptions::LORE_ONLY).expect("log");
        let candidate = commits
            .iter()
            .find(|c| c.hash == f.body_mention)
            .expect("body mention is a candidate");
        assert!(!candidate.trailers.contains("Lore-id"));
        assert!(candidate.trailers.contains("Signed-off-by"));
    });
}

#[test]
fn applies_the_pre_filter_to_the_bulk_file_pass_so_files_changed_stays_populated() {
    with_fixture(|f| {
        let commits = f.client().log(&[], LogOptions::LORE_ONLY).expect("log");
        let atom = commits.iter().find(|c| c.hash == f.atom).expect("atom");
        assert_eq!(atom.files_changed, vec!["project/src/file.ts"]);
        let no_space = commits
            .iter()
            .find(|c| c.hash == f.no_space)
            .expect("no-space");
        assert_eq!(no_space.files_changed, vec!["project/src/other.ts"]);
    });
}

// ---- GitClient.log scope pushdown (LogOptions.scope) ----------------------

/// Runs `body` with the base fixture plus scoped commits on top. The base
/// commits carry no conventional-commit scope, so they never match.
fn with_scope_fixture(body: impl FnOnce(&Fixture)) {
    with_fixture(|f| {
        f.commit(
            "src/a.ts",
            "feat(api): scoped atom\n\nLore-id: dddd4444\nConfidence: high",
        );
        f.commit(
            "src/b.ts",
            "fix(API): mixed-case scope\n\nLore-id: eeee5555",
        );
        f.commit(
            "src/c.ts",
            "feat(other): different scope\n\nLore-id: ffff6666",
        );
        f.commit("src/d.ts", "chore(api): no trailers here");
        f.commit("src/e.ts", "feat(a.b): dotted scope\n\nLore-id: abab1212");
        f.commit("src/f.ts", "feat(axb): dot lookalike\n\nLore-id: cdc12121");
        body(f);
    });
}

fn scoped_subjects(f: &Fixture, args: &[String], scope: &str) -> Vec<String> {
    f.client()
        .log(args, LogOptions::lore_only_in_scope(scope))
        .expect("log")
        .into_iter()
        .map(|c| c.subject)
        .collect()
}

#[test]
fn ands_a_coarse_case_insensitive_scope_grep_with_the_lore_id_pre_filter() {
    with_scope_fixture(|f| {
        let subjects = scoped_subjects(f, &[], "api");

        assert!(subjects.contains(&"feat(api): scoped atom".to_owned()));
        assert!(subjects.contains(&"fix(API): mixed-case scope".to_owned()));
        assert!(!subjects.contains(&"feat(other): different scope".to_owned()));
        assert!(!subjects.contains(&"chore(api): no trailers here".to_owned()));

        // The bulk --name-only pass runs with the same pre-filter args.
        let commits = f
            .client()
            .log(&[], LogOptions::lore_only_in_scope("api"))
            .expect("log");
        let scoped = commits
            .iter()
            .find(|c| c.subject == "feat(api): scoped atom")
            .expect("scoped atom");
        assert_eq!(scoped.files_changed, vec!["src/a.ts"]);
    });
}

#[test]
fn escapes_regex_metacharacters_in_the_scope_so_a_dot_stays_a_dot() {
    with_scope_fixture(|f| {
        let subjects = scoped_subjects(f, &[], "a.b");

        assert!(subjects.contains(&"feat(a.b): dotted scope".to_owned()));
        assert!(!subjects.contains(&"feat(axb): dot lookalike".to_owned()));
    });
}

#[test]
fn keeps_author_patterns_working_alongside_the_scope_grep_case_insensitively() {
    with_scope_fixture(|f| {
        // --regexp-ignore-case is global: it also case-folds author patterns
        // while scope is set, matching the parser-level author refinement.
        let subjects = scoped_subjects(f, &["--author=LORE TEST".to_owned()], "api");

        assert!(subjects.contains(&"feat(api): scoped atom".to_owned()));
        assert!(subjects.contains(&"fix(API): mixed-case scope".to_owned()));
    });
}

#[test]
fn counts_commits_touching_a_repository_relative_path_even_when_cwd_is_nested() {
    with_fixture(|f| {
        // After `atom`, exactly one commit (body_mention) touched project/src/file.ts.
        assert_eq!(
            f.client()
                .count_commits_since("project/src/file.ts", &f.atom)
                .expect("count"),
            1
        );
        assert_eq!(
            f.subdir_client("project")
                .count_commits_since("project/src/file.ts", &f.atom)
                .expect("count from subdir"),
            1
        );
    });
}

#[test]
fn formatted_log_fields_are_parsed_from_git_output() {
    with_fixture(|f| {
        let commits = f
            .client()
            .log(&["-1".to_owned(), f.atom.clone()], LogOptions::default())
            .expect("log");
        assert_eq!(commits.len(), 1);
        let c = &commits[0];
        assert_eq!(c.hash, f.atom);
        assert_eq!(c.author, "lore@example.com");
        assert_eq!(c.subject, "feat: first atom");
        assert_eq!(c.trailers, "Lore-id: aaaa1111\nConfidence: high");
        assert!(c.date.contains('T'), "ISO date expected, got {}", c.date);
        assert_eq!(c.files_changed, vec!["project/src/file.ts"]);
    });
}

#[test]
fn line_range_log_uses_the_default_format_parser() {
    with_fixture(|f| {
        let commits = f
            .client()
            .log(
                &["-L".to_owned(), "1,1:project/src/file.ts".to_owned()],
                LogOptions::default(),
            )
            .expect("log -L");
        assert!(
            commits.len() >= 2,
            "both commits touching line 1: {commits:?}"
        );
        let atom = commits
            .iter()
            .find(|c| c.hash == f.atom)
            .expect("atom via -L");
        assert_eq!(atom.subject, "feat: first atom");
        assert_eq!(atom.trailers, "Lore-id: aaaa1111\nConfidence: high");
        assert_eq!(atom.author, "lore@example.com");
        assert_eq!(atom.files_changed, vec!["project/src/file.ts"]);
    });
}

#[test]
fn blame_commit_and_repo_queries_work_end_to_end() {
    with_fixture(|f| {
        let client = f.client();
        assert!(client.is_inside_repo());
        let root = PathBuf::from(client.repo_root().expect("root"));
        assert_eq!(root.canonicalize().ok(), f.repo.path().canonicalize().ok());

        let blame = client
            .blame("project/src/file.ts", 1, Some(1))
            .expect("blame");
        assert_eq!(blame.len(), 1);
        assert_eq!(blame[0].commit_hash, f.body_mention);
        assert_eq!(blame[0].line_number, 1);
        assert_eq!(blame[0].content, "docs: mentions an id in the body");

        assert!(!client.has_staged_changes());
        fs::write(f.repo.path().join("new.txt"), "x\n").expect("write");
        f.repo.git(&["add", "new.txt"]);
        assert!(client.has_staged_changes());

        let result = client
            .commit(
                "feat: committed via client\n\nLore-id: dddd4444",
                Default::default(),
            )
            .expect("commit");
        assert!(result.success);
        assert!(!result.hash.is_empty());
        let head = client.resolve_ref("HEAD").expect("resolve");
        assert!(head.starts_with(&result.hash));
        assert_eq!(
            client.head_message().expect("head message"),
            "feat: committed via client\n\nLore-id: dddd4444"
        );
        assert_eq!(client.files_changed(&head).expect("files"), vec!["new.txt"]);
        assert_eq!(client.resolve_ref("HEAD~4").expect("resolve"), f.initial);
    });
}

#[test]
fn git_failures_surface_as_git_errors() {
    with_fixture(|f| {
        let err = f
            .client()
            .resolve_ref("no-such-ref-anywhere")
            .expect_err("unknown ref fails");
        assert_eq!(err.exit_code(), 2);
        assert!(err.to_string().starts_with("git rev-parse failed:"));
    });
}

// ---- commit hash via rev-parse (TS v0.8.1) ----------------------------------

/// Commits a fresh file through the client and asserts the reported hash is
/// `git rev-parse --short HEAD`.
fn assert_commit_reports_the_short_head(repo: &Repo, options: CommitOptions) {
    let client = ProcessGitClient::new(Some(repo.path().to_path_buf()));
    if !options.no_edit {
        repo.write("next.txt", "next\n");
        repo.git(&["add", "-A"]);
    }
    let result = client
        .commit("feat: next\n\nLore-id: eeee5555", options)
        .expect("commit");
    let short_head = repo
        .git(&["rev-parse", "--short", "HEAD"])
        .trim()
        .to_owned();
    assert!(!result.hash.is_empty());
    assert_eq!(result.hash, short_head);
}

/// A bare repository fixture for the hash cases, with the isolated git
/// environment applied to the test process (see `with_fixture`).
fn with_repo(body: impl FnOnce(&Repo)) {
    if !git_available() {
        eprintln!("git not available; skipping integration test");
        return;
    }
    let repo = Repo::new();
    for (k, v) in repo.env() {
        std::env::set_var(k, v);
    }
    body(&repo);
}

#[test]
fn commit_reports_the_hash_of_a_root_commit() {
    with_repo(|repo| assert_commit_reports_the_short_head(repo, CommitOptions::default()));
}

#[test]
fn commit_reports_the_hash_on_a_dotted_branch_name() {
    with_repo(|repo| {
        repo.commit("README.md", "chore: initial");
        repo.git(&["checkout", "-q", "-b", "release/v0.8.1"]);
        assert_commit_reports_the_short_head(repo, CommitOptions::default());
    });
}

#[test]
fn commit_reports_the_hash_on_a_detached_head() {
    with_repo(|repo| {
        repo.commit("README.md", "chore: initial");
        repo.git(&["checkout", "-q", "--detach"]);
        assert_commit_reports_the_short_head(repo, CommitOptions::default());
    });
}

#[test]
fn commit_reports_the_hash_of_an_amend_no_edit() {
    with_repo(|repo| {
        repo.commit("README.md", "chore: initial");
        assert_commit_reports_the_short_head(
            repo,
            CommitOptions {
                amend: true,
                no_edit: true,
            },
        );
    });
}
