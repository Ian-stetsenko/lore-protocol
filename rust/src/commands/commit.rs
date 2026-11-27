//! `lore commit`: create (or amend) a Lore-enriched commit.
//!
//! Input sources, by priority: `-i` interactive, `--file <json>`, flags
//! (`--intent` ...), JSON on stdin. `--amend` preserves the existing Lore-id;
//! `--amend --no-edit` passes straight through to git. Reference trailers
//! must resolve on some ref unless `--no-verify-refs` is passed.

use std::collections::HashMap;

use indexmap::IndexSet;
use serde_json::{json, Map, Value};

use crate::cli::CommitArgs;
use crate::commands::{Io, EXIT_OK};
use crate::interfaces::git_client::{CommitOptions, GitClient};
use crate::interfaces::output_formatter::{ErrorMessage, OutputFormatter};
use crate::services::atom_repository::AtomRepository;
use crate::services::commit_builder::CommitBuilder;
use crate::services::commit_input_resolver::CommitInputResolver;
use crate::services::head_lore_id_reader::HeadLoreIdReader;
use crate::types::commit_input::{CommitCommandOptions, CommitInput};
use crate::types::domain::{LoreId, TrailerKey};
use crate::types::output::{Severity, ValidationIssue};
use crate::util::constants::is_valid_lore_id;
use crate::util::{LoreError, Result};

/// Warning printed when the reference gate cannot run ("could not check").
const REFERENCE_CHECK_SKIPPED: &str = "validation skipped: the Lore-id index could not be built";

pub struct CommitDeps<'a> {
    pub commit_builder: &'a CommitBuilder<'a>,
    pub git_client: &'a dyn GitClient,
    pub formatter: &'a dyn OutputFormatter,
    pub commit_input_resolver: &'a CommitInputResolver<'a>,
    pub head_lore_id_reader: &'a HeadLoreIdReader<'a>,
    pub atom_repository: &'a AtomRepository<'a>,
}

pub fn run(args: &CommitArgs, deps: &CommitDeps<'_>, io: &mut Io<'_>) -> Result<i32> {
    let options = CommitCommandOptions::from(args);

    // --no-edit without --amend is invalid
    if options.no_edit && !options.amend {
        return Err(LoreError::new("--no-edit can only be used with --amend"));
    }

    // --amend --no-edit: pass through to git, no Lore processing
    if options.amend && options.no_edit {
        if options.has_input() {
            return Err(LoreError::new(
                "--no-edit keeps the existing message unchanged. Remove --no-edit to update trailers, or remove the input flags/payload to keep the message as-is.",
            ));
        }
        let lore_id = deps.head_lore_id_reader.read();
        let result = deps.git_client.commit(
            "",
            CommitOptions {
                amend: true,
                no_edit: true,
            },
        )?;
        let message = match &lore_id {
            Some(id) => format!("Commit amended: {} | Lore-id: {id}", result.hash),
            None => format!("Commit amended: {}", result.hash),
        };
        io.print(&deps.formatter.format_success(
            &message,
            Some(&success_data(&result.hash, lore_id.as_deref(), &[])),
        ))?;
        return Ok(EXIT_OK);
    }

    // Staged-changes guard (skipped when amending)
    if !options.amend && !deps.git_client.has_staged_changes() {
        return Err(LoreError::NoStagedChanges);
    }

    // Existing Lore-id when amending
    let existing_lore_id = if options.amend {
        deps.head_lore_id_reader.read()
    } else {
        None
    };

    // Resolve input, then validate format and references as one batched
    // pass: malformed and unresolvable ids fail together, once.
    let input = deps.commit_input_resolver.resolve(&options)?;
    let mut issues = deps.commit_builder.validate(&input);
    if !options.no_verify_refs {
        issues.extend(check_references(&input, deps)?);
    }
    if issues.iter().any(|i| i.severity == Severity::Error) {
        return Err(LoreError::validation(
            "Commit input validation failed",
            issues,
        ));
    }

    // Warnings never block the commit, but they must reach the user: text
    // mode prints them on stderr, structured formats carry them in the
    // success payload below.
    let warnings: Vec<ValidationIssue> = issues
        .into_iter()
        .filter(|issue| issue.severity == Severity::Warning)
        .collect();
    let warning_messages: Vec<ErrorMessage> = warnings
        .iter()
        .map(|issue| ErrorMessage::warning(issue.message.clone()))
        .collect();
    let warning_output = deps.formatter.format_warnings(&warning_messages);
    if !warning_output.is_empty() {
        io.eprint(&warning_output)?;
    }

    // Build the message (reusing the Lore-id on amend) and commit
    let built = deps
        .commit_builder
        .build(&input, existing_lore_id.as_deref());
    let result = deps.git_client.commit(
        &built.message,
        CommitOptions {
            amend: options.amend,
            no_edit: false,
        },
    )?;

    let verb = if options.amend { "amended" } else { "created" };
    let message = format!(
        "Commit {verb}: {} | Lore-id: {}",
        result.hash, built.lore_id
    );
    io.print(&deps.formatter.format_success(
        &message,
        Some(&success_data(&result.hash, Some(&built.lore_id), &warnings)),
    ))?;
    Ok(EXIT_OK)
}

/// `reference-resolves` issues for reference ids that resolve on no ref.
///
/// Best-effort: a git failure building the index means "could not check",
/// not "check failed", so it yields one `reference-check-skipped` warning,
/// an advisory issue like any other. Every other error propagates.
fn check_references(input: &CommitInput, deps: &CommitDeps<'_>) -> Result<Vec<ValidationIssue>> {
    match unresolved_reference_issues(input, deps.atom_repository) {
        Err(LoreError::Git(_)) => Ok(vec![ValidationIssue::warning(
            "reference-check-skipped",
            REFERENCE_CHECK_SKIPPED,
        )]),
        result => result,
    }
}

fn unresolved_reference_issues(
    input: &CommitInput,
    repository: &AtomRepository<'_>,
) -> Result<Vec<ValidationIssue>> {
    let pairs = collect_reference_pairs(input);
    if pairs.is_empty() {
        return Ok(Vec::new());
    }

    let unique_ids: Vec<LoreId> = pairs
        .iter()
        .map(|(_, id)| id.clone())
        .collect::<IndexSet<_>>()
        .into_iter()
        .collect();
    let resolved = repository.resolve_reference_ids(&unique_ids)?;

    // Near matches are fetched once per unresolved id; pairs sharing an id
    // share its candidate list.
    let mut near_matches: HashMap<&str, Vec<LoreId>> = HashMap::new();
    for id in &unique_ids {
        if resolved.get(id).is_none_or(Option::is_none) {
            near_matches.insert(id, repository.find_near_match_ids(id)?);
        }
    }

    Ok(pairs
        .iter()
        .filter_map(|(trailer, id)| {
            let candidates = near_matches.get(id.as_str())?;
            let suggestion = if candidates.is_empty() {
                String::new()
            } else {
                format!(" Did you mean one of: {}?", candidates.join(", "))
            };
            Some(ValidationIssue::error(
                "reference-resolves",
                format!("{trailer} references Lore-id {id}, which resolves on no ref.{suggestion}"),
            ))
        })
        .collect())
}

/// Pattern-valid reference ids as (trailer, id) pairs, deduplicated on the
/// pair: an id repeated under one trailer reports once, the same id under
/// two trailers reports twice. Invalid ids belong to the format check.
fn collect_reference_pairs(input: &CommitInput) -> Vec<(TrailerKey, LoreId)> {
    let Some(trailers) = &input.trailers else {
        return Vec::new();
    };
    TrailerKey::REFERENCE
        .iter()
        .flat_map(|key| {
            trailers
                .array(*key)
                .into_iter()
                .flatten()
                .filter(|id| is_valid_lore_id(id))
                .map(move |id| (*key, id.clone()))
        })
        .collect::<IndexSet<_>>()
        .into_iter()
        .collect()
}

/// The success payload: `warnings` is always present, `[]` when empty.
fn success_data(
    hash: &str,
    lore_id: Option<&str>,
    warnings: &[ValidationIssue],
) -> Map<String, Value> {
    let mut data = Map::new();
    data.insert("hash".to_owned(), Value::String(hash.to_owned()));
    data.insert(
        "loreId".to_owned(),
        lore_id
            .map(|id| Value::String(id.to_owned()))
            .unwrap_or(Value::Null),
    );
    let warnings: Vec<Value> = warnings
        .iter()
        .map(|issue| {
            json!({
                "severity": issue.severity.as_str(),
                "rule": issue.rule,
                "message": issue.message,
            })
        })
        .collect();
    data.insert("warnings".to_owned(), Value::Array(warnings));
    data
}

#[cfg(test)]
mod tests;
