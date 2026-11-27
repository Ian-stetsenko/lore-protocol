//! Shared test doubles and fixtures. Compiled only under `cfg(test)`.
//!
//! Tests should use these rather than hand-rolling mocks so that behaviour
//! expectations stay consistent across modules.

pub mod fixtures;
pub mod mock_git_client;
pub mod mock_prompt;

pub use fixtures::{
    atom, date, raw_commit, trailers, AtomBuilder, FixedLoreIdGenerator, RawCommitBuilder,
};
pub use mock_git_client::{GitCall, MockGitClient};
pub use mock_prompt::{MockPrompt, PromptCall};
