//! `lore validate [range]`: Lore protocol compliance for commits.
//!
//! Default is the last commit. `--since <ref>`, `--last <n>` or an explicit
//! range select history; `--commit-msg-file` validates a message before the
//! commit exists (hook mode). Exit codes: 0 clean, 1 errors, 2 warnings only.

use std::fs;

use chrono::{SecondsFormat, Utc};

use crate::cli::ValidateArgs;
use crate::commands::{Io, EXIT_OK};
use crate::interfaces::git_client::{GitClient, LogOptions, RawCommit};
use crate::interfaces::output_formatter::OutputFormatter;
use crate::services::trailer_parser::TrailerParser;
use crate::services::validator::Validator;
use crate::types::output::{
    CommitValidationResult, FormattableValidationResult, Severity, ValidationIssue,
    ValidationSummary,
};
use crate::util::constants::{EXIT_CODE_GIT_ERROR, EXIT_CODE_VALIDATION_ERROR};
use crate::util::Result;

pub struct ValidateDeps<'a> {
    pub validator: &'a Validator<'a>,
    pub git_client: &'a dyn GitClient,
    pub trailer_parser: &'a TrailerParser,
    pub formatter: &'a dyn OutputFormatter,
}

pub fn run(args: &ValidateArgs, deps: &ValidateDeps<'_>, io: &mut Io<'_>) -> Result<i32> {
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
        None => {
            let log_args: Vec<String> = if let Some(range) = &args.range {
                vec![range.clone()]
            } else if let Some(since) = &args.since {
                vec![format!("{since}..HEAD")]
            } else if let Some(last) = args.last.filter(|n| *n > 0) {
                vec![format!("-{last}")]
            } else {
                vec!["-1".to_owned()]
            };
            deps.git_client.log(&log_args, LogOptions::default())?
        }
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

    Ok(if total_errors > 0 {
        EXIT_CODE_VALIDATION_ERROR
    } else if total_warnings > 0 {
        EXIT_CODE_GIT_ERROR
    } else {
        EXIT_OK
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
