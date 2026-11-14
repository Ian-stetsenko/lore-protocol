//! Runs the real git binary against a throwaway repository. Covers behaviour
//! that cannot be asserted through a mocked `GitClient`: how git itself
//! interprets the arguments `ProcessGitClient` builds.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use lore::interfaces::git_client::{GitClient, LogOptions};
use lore::services::git_client::ProcessGitClient;
use tempfile::TempDir;

struct Fixture {
    root: TempDir,
    env: Vec<(&'static str, String)>,
    initial: String,
    atom: String,
    no_space: String,
    body_mention: String,
}

fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

impl Fixture {
    fn new() -> Fixture {
        let root = tempfile::tempdir().expect("tempdir");
        // Isolate from the developer's global config (signing, hooks, templates).
        let empty_config = root.path().join(".empty-gitconfig");
        fs::write(&empty_config, "").expect("write config");
        let env = vec![
            ("GIT_CONFIG_GLOBAL", empty_config.display().to_string()),
            ("GIT_CONFIG_NOSYSTEM", "1".to_owned()),
            ("GIT_AUTHOR_NAME", "Lore Test".to_owned()),
            ("GIT_AUTHOR_EMAIL", "lore@example.com".to_owned()),
            ("GIT_COMMITTER_NAME", "Lore Test".to_owned()),
            ("GIT_COMMITTER_EMAIL", "lore@example.com".to_owned()),
        ];
        let mut f = Fixture {
            root,
            env,
            initial: String::new(),
            atom: String::new(),
            no_space: String::new(),
            body_mention: String::new(),
        };
        f.git(f.root.path(), &["init", "-q"]);
        f.git(f.root.path(), &["symbolic-ref", "HEAD", "refs/heads/main"]);

        f.initial = f.commit("README.md", "chore: initial commit");
        f.atom = f.commit(
            "project/src/file.ts",
            "feat: first atom\n\nLore-id: aaaa1111\nConfidence: high",
        );
        f.no_space = f.commit(
            "project/src/other.ts",
            "feat: no-space trailer\n\nLore-id:bbbb2222",
        );
        f.body_mention = f.commit(
            "project/src/file.ts",
            "docs: mentions an id in the body\n\nLore-id: cccc3333 appears here but this paragraph is not the trailer block.\n\nSigned-off-by: Lore Test <lore@example.com>",
        );
        f
    }

    fn git(&self, cwd: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .envs(self.env.iter().cloned())
            .output()
            .expect("git runs");
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).into_owned()
    }

    fn commit(&self, file: &str, message: &str) -> String {
        let full = self.root.path().join(file);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).expect("mkdir");
        }
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        fs::write(&full, format!("{message}\n{stamp}\n")).expect("write");
        self.git(self.root.path(), &["add", "-A"]);
        self.git(self.root.path(), &["commit", "-q", "-m", message]);
        self.git(self.root.path(), &["rev-parse", "HEAD"])
            .trim()
            .to_owned()
    }

    fn client(&self) -> ProcessGitClient {
        ProcessGitClient::new(Some(self.root.path().to_path_buf()))
    }

    fn subdir_client(&self, sub: &str) -> ProcessGitClient {
        let path: PathBuf = self.root.path().join(sub);
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
    // SAFETY-ish: tests in this binary run in threads of one process; the
    // variables are identical across tests, so concurrent sets are benign.
    for (k, v) in &fixture.env {
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
        assert_eq!(root.canonicalize().ok(), f.root.path().canonicalize().ok());

        let blame = client
            .blame("project/src/file.ts", 1, Some(1))
            .expect("blame");
        assert_eq!(blame.len(), 1);
        assert_eq!(blame[0].commit_hash, f.body_mention);
        assert_eq!(blame[0].line_number, 1);
        assert_eq!(blame[0].content, "docs: mentions an id in the body");

        assert!(!client.has_staged_changes());
        fs::write(f.root.path().join("new.txt"), "x\n").expect("write");
        f.git(f.root.path(), &["add", "new.txt"]);
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
