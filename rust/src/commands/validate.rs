//! `lore validate [range]`: Lore protocol compliance for commits.
//!
//! Default is the last commit. `--from <ref>` (for `<ref>..HEAD`), `--last <n>`
//! or an explicit range select history (`--since`, deprecated in TS 0.7.0, was
//! removed in 0.8.0); `--commit-msg-file` validates a message before the
//! commit exists (hook mode).
//!
//! Exit codes:
//! - Range modes (positional range, `--from`, `--last`, default): 1 on errors,
//!   2 on warnings only, 0 when clean.
//! - Hook mode (`--commit-msg-file`): 1 on errors, 0 otherwise. Warnings are
//!   advisory so they never block a commit; `--strict` upgrades them to
//!   errors (which `[hooks] enforce = true` does).

use std::fs;

use chrono::{SecondsFormat, Utc};

use crate::cli::ValidateArgs;
use crate::commands::Io;
use crate::interfaces::git_client::{GitClient, LogOptions, RawCommit};
use crate::interfaces::output_formatter::OutputFormatter;
use crate::services::trailer_parser::TrailerParser;
use crate::services::validator::Validator;
use crate::types::output::{
    CommitValidationResult, FormattableValidationResult, Severity, ValidationIssue,
    ValidationSummary,
};
use crate::util::constants::{
    EXIT_CODE_SUCCESS, EXIT_CODE_VALIDATION_ERROR, EXIT_CODE_VALIDATION_WARNINGS,
};
use crate::util::{LoreError, Result};

pub struct ValidateDeps<'a> {
    pub validator: &'a Validator<'a>,
    pub git_client: &'a dyn GitClient,
    pub trailer_parser: &'a TrailerParser,
    pub formatter: &'a dyn OutputFormatter,
}

pub fn run(args: &ValidateArgs, deps: &ValidateDeps<'_>, io: &mut Io<'_>) -> Result<i32> {
    let is_hook_mode = args.commit_msg_file.is_some();
    let raw_commits: Vec<RawCommit> = match &args.commit_msg_file {
        Some(path) => {
            // Hook mode: validate a commit message file before the commit exists
            let content = fs::read_to_string(path)?;
            let trailer_block = deps.trailer_parser.extract_trailer_block(&content);
            let subject = content.split('\n').next().unwrap_or("").to_owned();
            vec![RawCommit {
                hash: "(pending)".to_owned(),
                date: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
                author: String::new(),
                subject,
                body: content,
                trailers: trailer_block,
                files_changed: Vec::new(),
            }]
        }
        None => deps
            .git_client
            .log(&history_log_args(args)?, LogOptions::default())?,
    };

    let mut results = deps.validator.validate(&raw_commits)?;

    // Strict mode: every warning becomes an error
    if args.strict {
        results = results.into_iter().map(upgrade_warnings).collect();
    }

    let mut total_errors = 0;
    let mut total_warnings = 0;
    for result in &results {
        for issue in &result.issues {
            match issue.severity {
                Severity::Error => total_errors += 1,
                Severity::Warning => total_warnings += 1,
            }
        }
    }

    let validation_result = FormattableValidationResult {
        valid: total_errors == 0,
        summary: ValidationSummary {
            errors: total_errors,
            warnings: total_warnings,
            commits_checked: results.len(),
        },
        results,
    };

    io.print(&deps.formatter.format_validation_result(&validation_result))?;

    Ok(resolve_exit_code(
        total_errors,
        total_warnings,
        is_hook_mode,
    ))
}

/// Maps the (post-`--strict`) issue counts to a process exit code. Hook mode
/// treats warnings as advisory: only errors block the commit.
fn resolve_exit_code(total_errors: usize, total_warnings: usize, is_hook_mode: bool) -> i32 {
    if total_errors > 0 {
        EXIT_CODE_VALIDATION_ERROR
    } else if total_warnings > 0 && !is_hook_mode {
        EXIT_CODE_VALIDATION_WARNINGS
    } else {
        EXIT_CODE_SUCCESS
    }
}

/// The `git log` arguments selecting the commits to validate. A positional
/// range and `--from` are mutually exclusive whenever both are given (even
/// empty, like TS's `!== undefined`); an empty value is otherwise ignored
/// (JS truthiness).
fn history_log_args(args: &ValidateArgs) -> Result<Vec<String>> {
    if let (Some(range), Some(from)) = (&args.range, &args.from) {
        return Err(LoreError::new(format!(
            "Conflicting range specifiers: positional range \"{range}\" and --from {from}. Pass one or the other."
        )));
    }

    let range = args.range.as_deref().filter(|s| !s.is_empty());
    let from = args.from.as_deref().filter(|s| !s.is_empty());
    Ok(if let Some(range) = range {
        vec![range.to_owned()]
    } else if let Some(from) = from {
        vec![format!("{from}..HEAD")]
    } else if let Some(last) = args.last.filter(|n| *n > 0) {
        vec![format!("-{last}")]
    } else {
        vec!["-1".to_owned()]
    })
}

fn upgrade_warnings(result: CommitValidationResult) -> CommitValidationResult {
    let issues: Vec<ValidationIssue> = result
        .issues
        .into_iter()
        .map(|issue| ValidationIssue {
            severity: Severity::Error,
            ..issue
        })
        .collect();
    let has_errors = issues.iter().any(|i| i.severity == Severity::Error);
    CommitValidationResult {
        commit: result.commit,
        lore_id: result.lore_id,
        valid: !has_errors,
        issues,
    }
}

#[cfg(test)]
mod tests;
