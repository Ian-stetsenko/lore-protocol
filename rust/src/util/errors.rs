//! Error type with process exit-code semantics.

use crate::types::output::ValidationIssue;

use super::constants::{
    EXIT_CODE_GIT_ERROR, EXIT_CODE_NO_STAGED_CHANGES, EXIT_CODE_VALIDATION_ERROR,
};

/// All failures surfaced by the CLI. Each variant maps to a process exit code.
#[derive(Debug, thiserror::Error)]
pub enum LoreError {
    /// A user-facing error with an explicit exit code (default 1).
    #[error("{message}")]
    General { message: String, exit_code: i32 },

    /// Input validation failed; carries the individual issues. Exit code 1.
    #[error("{message}")]
    Validation {
        message: String,
        issues: Vec<ValidationIssue>,
    },

    /// A git command failed. Exit code 2.
    #[error("{0}")]
    Git(String),

    /// `lore commit` without staged changes. Exit code 3.
    #[error("No staged changes. Stage files with `git add` before running `lore commit`.")]
    NoStagedChanges,

    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Json(#[from] serde_json::Error),

    #[error("{0}")]
    Toml(#[from] toml::de::Error),
}

impl LoreError {
    /// A general error with exit code 1.
    pub fn new(message: impl Into<String>) -> Self {
        LoreError::General {
            message: message.into(),
            exit_code: EXIT_CODE_VALIDATION_ERROR,
        }
    }

    pub fn with_code(message: impl Into<String>, exit_code: i32) -> Self {
        LoreError::General {
            message: message.into(),
            exit_code,
        }
    }

    pub fn git(message: impl Into<String>) -> Self {
        LoreError::Git(message.into())
    }

    pub fn validation(message: impl Into<String>, issues: Vec<ValidationIssue>) -> Self {
        LoreError::Validation {
            message: message.into(),
            issues,
        }
    }

    pub fn exit_code(&self) -> i32 {
        match self {
            LoreError::General { exit_code, .. } => *exit_code,
            LoreError::Validation { .. } => EXIT_CODE_VALIDATION_ERROR,
            LoreError::Git(_) => EXIT_CODE_GIT_ERROR,
            LoreError::NoStagedChanges => EXIT_CODE_NO_STAGED_CHANGES,
            LoreError::Io(_) | LoreError::Json(_) | LoreError::Toml(_) => {
                EXIT_CODE_VALIDATION_ERROR
            }
        }
    }

    /// Validation issues attached to the error, if any.
    pub fn issues(&self) -> &[ValidationIssue] {
        match self {
            LoreError::Validation { issues, .. } => issues,
            _ => &[],
        }
    }
}

pub type Result<T> = std::result::Result<T, LoreError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_codes_follow_protocol() {
        assert_eq!(LoreError::new("x").exit_code(), 1);
        assert_eq!(LoreError::with_code("x", 7).exit_code(), 7);
        assert_eq!(LoreError::git("x").exit_code(), 2);
        assert_eq!(LoreError::NoStagedChanges.exit_code(), 3);
        assert_eq!(LoreError::validation("x", vec![]).exit_code(), 1);
        let io: LoreError = std::io::Error::other("boom").into();
        assert_eq!(io.exit_code(), 1);
        assert_eq!(io.to_string(), "boom");
    }

    #[test]
    fn no_staged_changes_message_is_stable() {
        assert_eq!(
            LoreError::NoStagedChanges.to_string(),
            "No staged changes. Stage files with `git add` before running `lore commit`."
        );
    }
}
