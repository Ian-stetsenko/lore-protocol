//! Hermetic git fixtures shared by the integration test crates.
//!
//! Every repository runs git with an empty global config that lives in its
//! own temporary directory, outside the work tree, so the developer's config
//! (signing, hooks, templates) never leaks in and the config file is never
//! committed into fixture history. Author, committer and dates are fixed, and
//! committed file content is deterministic, so two repositories built with
//! the same steps have identical commit hashes.

// Each test crate uses a different subset of these helpers.
#![allow(dead_code)]

use std::cell::Cell;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command as Proc;

use assert_cmd::Command;
use tempfile::TempDir;

pub const DATE_RECENT: &str = "2026-10-01T10:00:00+00:00";
pub const DATE_OLD: &str = "2024-01-01T10:00:00+00:00";

/// Whether a `git` binary is on the PATH.
pub fn git_available() -> bool {
    Proc::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// A commit message with a trailer block.
pub fn atom_message(subject: &str, trailers: &[&str]) -> String {
    format!("{subject}\n\n{}", trailers.join("\n"))
}

/// A throwaway repository on branch `main` with an unborn HEAD.
pub struct Repo {
    work_tree: TempDir,
    /// Holds the empty global gitconfig; kept apart from the work tree.
    config_home: TempDir,
    /// Makes every committed file's content unique without a clock.
    writes: Cell<usize>,
}

impl Default for Repo {
    fn default() -> Self {
        Repo::new()
    }
}

impl Repo {
    pub fn new() -> Repo {
        let config_home = tempfile::tempdir().expect("config tempdir");
        fs::write(Self::gitconfig_in(config_home.path()), "").expect("write gitconfig");
        let repo = Repo {
            work_tree: tempfile::tempdir().expect("work tree tempdir"),
            config_home,
            writes: Cell::new(0),
        };
        repo.git(&["init", "-q"]);
        repo.git(&["symbolic-ref", "HEAD", "refs/heads/main"]);
        repo
    }

    fn gitconfig_in(dir: &Path) -> PathBuf {
        dir.join("gitconfig")
    }

    pub fn path(&self) -> &Path {
        self.work_tree.path()
    }

    /// The hermetic environment for git and for `lore` processes.
    pub fn env(&self) -> Vec<(&'static str, String)> {
        vec![
            (
                "GIT_CONFIG_GLOBAL",
                Self::gitconfig_in(self.config_home.path())
                    .display()
                    .to_string(),
            ),
            ("GIT_CONFIG_NOSYSTEM", "1".into()),
            ("GIT_AUTHOR_NAME", "Lore Test".into()),
            ("GIT_AUTHOR_EMAIL", "lore@example.com".into()),
            ("GIT_COMMITTER_NAME", "Lore Test".into()),
            ("GIT_COMMITTER_EMAIL", "lore@example.com".into()),
            ("GIT_AUTHOR_DATE", DATE_RECENT.into()),
            ("GIT_COMMITTER_DATE", DATE_RECENT.into()),
            ("LORE_NO_UPDATE_CHECK", "1".into()),
        ]
    }

    /// Run git with the recent fixed date; returns stdout.
    pub fn git(&self, args: &[&str]) -> String {
        self.git_at(args, DATE_RECENT)
    }

    pub fn git_at(&self, args: &[&str], date: &str) -> String {
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

    pub fn write(&self, rel: &str, content: &str) {
        let full = self.path().join(rel);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).expect("mkdir");
        }
        fs::write(full, content).expect("write file");
    }

    /// Write `file`, stage everything and commit with `message` (which may
    /// contain a trailer block). Returns the new HEAD hash.
    pub fn commit(&self, file: &str, message: &str) -> String {
        self.commit_at(file, message, DATE_RECENT)
    }

    pub fn commit_at(&self, file: &str, message: &str, date: &str) -> String {
        let write = self.writes.get() + 1;
        self.writes.set(write);
        self.write(file, &format!("{message}\n{write}\n"));
        self.git_at(&["add", "-A"], date);
        self.git_at(&["commit", "-q", "-m", message], date);
        self.head()
    }

    pub fn head(&self) -> String {
        self.git(&["rev-parse", "HEAD"]).trim().to_owned()
    }

    /// The Rust `lore` binary, run in the work tree.
    pub fn lore(&self) -> Command {
        let mut cmd = Command::cargo_bin("lore").expect("lore binary built");
        cmd.current_dir(self.path()).envs(self.env());
        cmd
    }
}
