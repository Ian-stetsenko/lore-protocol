//! `lore commit`: create (or amend) a Lore-enriched commit.
//!
//! Input sources, by priority: `-i` interactive, `--file <json>`, flags
//! (`--intent` ...), JSON on stdin. `--amend` preserves the existing Lore-id;
//! `--amend --no-edit` passes straight through to git.

use serde_json::{Map, Value};

use crate::cli::CommitArgs;
use crate::commands::{Io, EXIT_OK};
use crate::interfaces::git_client::{CommitOptions, GitClient};
use crate::interfaces::output_formatter::OutputFormatter;
use crate::services::commit_builder::CommitBuilder;
use crate::services::commit_input_resolver::CommitInputResolver;
use crate::services::head_lore_id_reader::HeadLoreIdReader;
use crate::types::commit_input::CommitCommandOptions;
use crate::types::output::Severity;
use crate::util::{LoreError, Result};

pub struct CommitDeps<'a> {
    pub commit_builder: &'a CommitBuilder<'a>,
    pub git_client: &'a dyn GitClient,
    pub formatter: &'a dyn OutputFormatter,
    pub commit_input_resolver: &'a CommitInputResolver<'a>,
    pub head_lore_id_reader: &'a HeadLoreIdReader<'a>,
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
            Some(&success_data(&result.hash, lore_id.as_deref())),
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

    // Resolve and validate input
    let input = deps.commit_input_resolver.resolve(&options)?;
    let issues = deps.commit_builder.validate(&input);
    if issues.iter().any(|i| i.severity == Severity::Error) {
        return Err(LoreError::validation(
            "Commit input validation failed",
            issues,
        ));
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
        Some(&success_data(&result.hash, Some(&built.lore_id))),
    ))?;
    Ok(EXIT_OK)
}

fn success_data(hash: &str, lore_id: Option<&str>) -> Map<String, Value> {
    let mut data = Map::new();
    data.insert("hash".to_owned(), Value::String(hash.to_owned()));
    data.insert(
        "loreId".to_owned(),
        lore_id
            .map(|id| Value::String(id.to_owned()))
            .unwrap_or(Value::Null),
    );
    data
}

#[cfg(test)]
mod tests;
