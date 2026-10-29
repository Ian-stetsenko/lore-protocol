//! Scriptable `GitClient` double that records every call.

use std::cell::RefCell;

use crate::interfaces::git_client::{
    BlameLine, CommitOptions, CommitResult, GitClient, LogOptions, RawCommit,
};
use crate::util::{LoreError, Result};

/// A recorded call on [`MockGitClient`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitCall {
    Log {
        args: Vec<String>,
        options: LogOptions,
    },
    Blame {
        file: String,
        line_start: u32,
        line_end: Option<u32>,
    },
    Commit {
        message: String,
        options: CommitOptions,
    },
    HasStagedChanges,
    RepoRoot,
    IsInsideRepo,
    FilesChanged(String),
    CountCommitsSince {
        path: String,
        since: String,
    },
    ResolveRef(String),
    HeadMessage,
}

type LogFn = Box<dyn Fn(&[String], LogOptions) -> Result<Vec<RawCommit>>>;
type BlameFn = Box<dyn Fn(&str, u32, Option<u32>) -> Result<Vec<BlameLine>>>;
type CommitFn = Box<dyn Fn(&str, CommitOptions) -> Result<CommitResult>>;
type StrResultFn = Box<dyn Fn() -> Result<String>>;
type FilesFn = Box<dyn Fn(&str) -> Result<Vec<String>>>;
type CountFn = Box<dyn Fn(&str, &str) -> Result<usize>>;
type RefFn = Box<dyn Fn(&str) -> Result<String>>;

/// Defaults: `log` -> `[]`, `blame` -> `[]`, `commit` -> `abc1234`,
/// staged changes present, repo root `/repo`, inside a repo, no files
/// changed, zero commits since, `resolve_ref` -> `abc1234`, empty HEAD message.
pub struct MockGitClient {
    log_fn: RefCell<LogFn>,
    blame_fn: RefCell<BlameFn>,
    commit_fn: RefCell<CommitFn>,
    has_staged_changes: RefCell<bool>,
    repo_root_fn: RefCell<StrResultFn>,
    is_inside_repo: RefCell<bool>,
    files_changed_fn: RefCell<FilesFn>,
    count_commits_since_fn: RefCell<CountFn>,
    resolve_ref_fn: RefCell<RefFn>,
    head_message_fn: RefCell<StrResultFn>,
    calls: RefCell<Vec<GitCall>>,
}

impl Default for MockGitClient {
    fn default() -> Self {
        MockGitClient::new()
    }
}

impl MockGitClient {
    pub fn new() -> Self {
        MockGitClient {
            log_fn: RefCell::new(Box::new(|_, _| Ok(Vec::new()))),
            blame_fn: RefCell::new(Box::new(|_, _, _| Ok(Vec::new()))),
            commit_fn: RefCell::new(Box::new(|_, _| {
                Ok(CommitResult {
                    hash: "abc1234".to_owned(),
                    success: true,
                })
            })),
            has_staged_changes: RefCell::new(true),
            repo_root_fn: RefCell::new(Box::new(|| Ok("/repo".to_owned()))),
            is_inside_repo: RefCell::new(true),
            files_changed_fn: RefCell::new(Box::new(|_| Ok(Vec::new()))),
            count_commits_since_fn: RefCell::new(Box::new(|_, _| Ok(0))),
            resolve_ref_fn: RefCell::new(Box::new(|_| Ok("abc1234".to_owned()))),
            head_message_fn: RefCell::new(Box::new(|| Ok(String::new()))),
            calls: RefCell::new(Vec::new()),
        }
    }

    // ---- scripting -------------------------------------------------------

    /// Script `log` with full access to the arguments.
    pub fn set_log(&self, f: impl Fn(&[String], LogOptions) -> Result<Vec<RawCommit>> + 'static) {
        *self.log_fn.borrow_mut() = Box::new(f);
    }

    /// Every `log` call returns a clone of `commits`.
    pub fn set_log_result(&self, commits: Vec<RawCommit>) {
        self.set_log(move |_, _| Ok(commits.clone()));
    }

    /// Every `log` call fails with a git error.
    pub fn set_log_error(&self, message: &str) {
        let message = message.to_owned();
        self.set_log(move |_, _| Err(LoreError::git(message.clone())));
    }

    pub fn set_blame(
        &self,
        f: impl Fn(&str, u32, Option<u32>) -> Result<Vec<BlameLine>> + 'static,
    ) {
        *self.blame_fn.borrow_mut() = Box::new(f);
    }

    pub fn set_blame_result(&self, lines: Vec<BlameLine>) {
        self.set_blame(move |_, _, _| Ok(lines.clone()));
    }

    pub fn set_commit(&self, f: impl Fn(&str, CommitOptions) -> Result<CommitResult> + 'static) {
        *self.commit_fn.borrow_mut() = Box::new(f);
    }

    pub fn set_commit_result(&self, hash: &str) {
        let hash = hash.to_owned();
        self.set_commit(move |_, _| {
            Ok(CommitResult {
                hash: hash.clone(),
                success: true,
            })
        });
    }

    pub fn set_has_staged_changes(&self, value: bool) {
        *self.has_staged_changes.borrow_mut() = value;
    }

    pub fn set_repo_root(&self, f: impl Fn() -> Result<String> + 'static) {
        *self.repo_root_fn.borrow_mut() = Box::new(f);
    }

    pub fn set_is_inside_repo(&self, value: bool) {
        *self.is_inside_repo.borrow_mut() = value;
    }

    pub fn set_files_changed(&self, f: impl Fn(&str) -> Result<Vec<String>> + 'static) {
        *self.files_changed_fn.borrow_mut() = Box::new(f);
    }

    pub fn set_count_commits_since(&self, f: impl Fn(&str, &str) -> Result<usize> + 'static) {
        *self.count_commits_since_fn.borrow_mut() = Box::new(f);
    }

    pub fn set_resolve_ref(&self, f: impl Fn(&str) -> Result<String> + 'static) {
        *self.resolve_ref_fn.borrow_mut() = Box::new(f);
    }

    pub fn set_head_message(&self, f: impl Fn() -> Result<String> + 'static) {
        *self.head_message_fn.borrow_mut() = Box::new(f);
    }

    /// Every `head_message` call returns `message`.
    pub fn set_head_message_result(&self, message: &str) {
        let message = message.to_owned();
        self.set_head_message(move || Ok(message.clone()));
    }

    // ---- inspection ------------------------------------------------------

    pub fn calls(&self) -> Vec<GitCall> {
        self.calls.borrow().clone()
    }

    /// Arguments and options of every `log` call, in order.
    pub fn log_calls(&self) -> Vec<(Vec<String>, LogOptions)> {
        self.calls
            .borrow()
            .iter()
            .filter_map(|c| match c {
                GitCall::Log { args, options } => Some((args.clone(), *options)),
                _ => None,
            })
            .collect()
    }

    pub fn log_call_count(&self) -> usize {
        self.log_calls().len()
    }

    pub fn commit_calls(&self) -> Vec<(String, CommitOptions)> {
        self.calls
            .borrow()
            .iter()
            .filter_map(|c| match c {
                GitCall::Commit { message, options } => Some((message.clone(), *options)),
                _ => None,
            })
            .collect()
    }

    pub fn count_commits_since_calls(&self) -> Vec<(String, String)> {
        self.calls
            .borrow()
            .iter()
            .filter_map(|c| match c {
                GitCall::CountCommitsSince { path, since } => Some((path.clone(), since.clone())),
                _ => None,
            })
            .collect()
    }

    pub fn clear_calls(&self) {
        self.calls.borrow_mut().clear();
    }

    fn record(&self, call: GitCall) {
        self.calls.borrow_mut().push(call);
    }
}

impl GitClient for MockGitClient {
    fn log(&self, args: &[String], options: LogOptions) -> Result<Vec<RawCommit>> {
        self.record(GitCall::Log {
            args: args.to_vec(),
            options,
        });
        (self.log_fn.borrow())(args, options)
    }

    fn blame(&self, file: &str, line_start: u32, line_end: Option<u32>) -> Result<Vec<BlameLine>> {
        self.record(GitCall::Blame {
            file: file.to_owned(),
            line_start,
            line_end,
        });
        (self.blame_fn.borrow())(file, line_start, line_end)
    }

    fn commit(&self, message: &str, options: CommitOptions) -> Result<CommitResult> {
        self.record(GitCall::Commit {
            message: message.to_owned(),
            options,
        });
        (self.commit_fn.borrow())(message, options)
    }

    fn has_staged_changes(&self) -> bool {
        self.record(GitCall::HasStagedChanges);
        *self.has_staged_changes.borrow()
    }

    fn repo_root(&self) -> Result<String> {
        self.record(GitCall::RepoRoot);
        (self.repo_root_fn.borrow())()
    }

    fn is_inside_repo(&self) -> bool {
        self.record(GitCall::IsInsideRepo);
        *self.is_inside_repo.borrow()
    }

    fn files_changed(&self, commit_hash: &str) -> Result<Vec<String>> {
        self.record(GitCall::FilesChanged(commit_hash.to_owned()));
        (self.files_changed_fn.borrow())(commit_hash)
    }

    fn count_commits_since(&self, path: &str, since_commit_hash: &str) -> Result<usize> {
        self.record(GitCall::CountCommitsSince {
            path: path.to_owned(),
            since: since_commit_hash.to_owned(),
        });
        (self.count_commits_since_fn.borrow())(path, since_commit_hash)
    }

    fn resolve_ref(&self, reference: &str) -> Result<String> {
        self.record(GitCall::ResolveRef(reference.to_owned()));
        (self.resolve_ref_fn.borrow())(reference)
    }

    fn head_message(&self) -> Result<String> {
        self.record(GitCall::HeadMessage);
        (self.head_message_fn.borrow())()
    }
}
