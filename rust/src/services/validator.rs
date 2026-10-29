//! Rule-based validation of commits against the Lore protocol.
//!
//! Rule names and message strings are kept byte-identical to the
//! TypeScript implementation so JSON output stays compatible.

use crate::interfaces::git_client::RawCommit;
use crate::types::config::LoreConfig;
use crate::types::domain::{LoreTrailers, TrailerKey};
use crate::types::output::{CommitValidationResult, Severity, ValidationIssue};
use crate::util::constants::{enum_values_for, is_valid_lore_id};
use crate::util::Result;

use super::atom_repository::AtomRepository;
use super::trailer_parser::TrailerParser;

/// Maximum number of values of one array trailer before `trailer-count` warns.
const MAX_TRAILER_VALUES: usize = 5;

/// Validates raw commits and reports per-commit issues.
///
/// Rule 1 of the TypeScript implementation (`trailer-format`, "Failed to
/// parse trailer block") is unreachable because the parser never fails, so
/// it is not implemented here; the rule name is kept for reference.
pub struct Validator<'a> {
    parser: &'a TrailerParser,
    repo: &'a AtomRepository<'a>,
    config: &'a LoreConfig,
}

impl<'a> Validator<'a> {
    pub fn new(
        parser: &'a TrailerParser,
        repo: &'a AtomRepository<'a>,
        config: &'a LoreConfig,
    ) -> Self {
        Validator {
            parser,
            repo,
            config,
        }
    }

    /// Validate every commit in order. Fails only when the reference index
    /// (a `git log --all` pass) cannot be built.
    pub fn validate(&self, commits: &[RawCommit]) -> Result<Vec<CommitValidationResult>> {
        commits
            .iter()
            .map(|commit| self.validate_commit(commit))
            .collect()
    }

    fn validate_commit(&self, commit: &RawCommit) -> Result<CommitValidationResult> {
        let mut issues: Vec<ValidationIssue> = Vec::new();

        // Rule 1 (`trailer-format`): the parser is infallible, see type docs.
        let trailers = self
            .parser
            .parse(&commit.trailers, &self.config.trailers.custom);
        let lore_id = if trailers.lore_id.is_empty() {
            None
        } else {
            Some(trailers.lore_id.clone())
        };

        // Rule 2: Lore-id present
        if trailers.lore_id.is_empty() {
            issues.push(ValidationIssue::error(
                "lore-id-present",
                "Lore-id trailer is missing",
            ));
        }

        // Rule 3: Lore-id format (8-char hex)
        if !trailers.lore_id.is_empty() && !is_valid_lore_id(&trailers.lore_id) {
            issues.push(ValidationIssue::error(
                "lore-id-format",
                format!(
                    "Lore-id \"{}\" is not a valid 8-character hex string",
                    trailers.lore_id
                ),
            ));
        }

        // Rule 4: Valid enum values
        Self::validate_enum_values(&trailers, &mut issues);

        // Rule 5: Intent length (JS string length = UTF-16 code units)
        let subject_len = commit.subject.encode_utf16().count();
        let intent_max = self.config.validation.intent_max_length;
        if subject_len > intent_max {
            issues.push(ValidationIssue::warning(
                "intent-length",
                format!("Intent exceeds {intent_max} characters (got {subject_len})"),
            ));
        }

        // Rule 6: Required trailers present
        self.validate_required_trailers(&trailers, &mut issues);

        // Rule 7: Message line count
        let total_lines = Self::count_message_lines(commit);
        let max_lines = self.config.validation.max_message_lines;
        if total_lines > max_lines {
            issues.push(ValidationIssue::warning(
                "message-length",
                format!("Message exceeds {max_lines} lines (got {total_lines})"),
            ));
        }

        // Rule 8: Reference format valid (8-char hex)
        Self::validate_reference_formats(&trailers, &mut issues);

        // Rule 9: More than 5 of any trailer type
        Self::validate_trailer_counts(&trailers, &mut issues);

        // Rule 10: Reference existence
        self.validate_reference_existence(&trailers, &mut issues)?;

        let has_errors = issues.iter().any(|i| i.severity == Severity::Error);

        Ok(CommitValidationResult {
            commit: commit.hash.clone(),
            lore_id,
            valid: !has_errors,
            issues,
        })
    }

    /// With typed enum fields this can never fire (the parser drops
    /// unrecognised values), but the check and its message are kept so the
    /// rule set mirrors the TypeScript validator.
    fn validate_enum_values(trailers: &LoreTrailers, issues: &mut Vec<ValidationIssue>) {
        for key in TrailerKey::ENUM {
            let (Some(value), Some(allowed)) = (trailers.enum_value(key), enum_values_for(key))
            else {
                continue;
            };
            if !allowed.contains(&value) {
                issues.push(ValidationIssue::error(
                    "invalid-enum",
                    format!(
                        "Invalid {key} value: \"{value}\". Expected one of: {}",
                        allowed.join(", ")
                    ),
                ));
            }
        }
    }

    fn validate_required_trailers(
        &self,
        trailers: &LoreTrailers,
        issues: &mut Vec<ValidationIssue>,
    ) {
        for required in &self.config.trailers.required {
            if trailers.has_named(required) {
                continue;
            }
            let message = format!("Required trailer \"{required}\" is missing");
            issues.push(if self.config.validation.strict {
                ValidationIssue::error("required-trailer", message)
            } else {
                ValidationIssue::warning("required-trailer", message)
            });
        }
    }

    fn validate_reference_formats(trailers: &LoreTrailers, issues: &mut Vec<ValidationIssue>) {
        for key in TrailerKey::REFERENCE {
            let Some(values) = trailers.array_values(key) else {
                continue;
            };
            for value in values {
                if !is_valid_lore_id(value) {
                    issues.push(ValidationIssue::warning(
                        "reference-format",
                        format!(
                            "Invalid reference format in {key}: \"{value}\". Expected 8-character hex."
                        ),
                    ));
                }
            }
        }
    }

    fn validate_trailer_counts(trailers: &LoreTrailers, issues: &mut Vec<ValidationIssue>) {
        for key in TrailerKey::ARRAY {
            let count = trailers.array_values(key).map(Vec::len).unwrap_or(0);
            if count > MAX_TRAILER_VALUES {
                issues.push(ValidationIssue::warning(
                    "trailer-count",
                    format!("More than {MAX_TRAILER_VALUES} values for {key} (got {count})"),
                ));
            }
        }
    }

    /// Subject line, plus (blank line + body lines) and (blank line +
    /// trailer lines) when each block is non-empty.
    fn count_message_lines(commit: &RawCommit) -> usize {
        let mut count = 1; // subject line
        if !commit.body.trim().is_empty() {
            count += 1; // blank line between subject and body
            count += commit.body.split('\n').count();
        }
        if !commit.trailers.trim().is_empty() {
            count += 1; // blank line before trailers
            count += commit.trailers.split('\n').count();
        }
        count
    }

    /// Warn for every well-formed referenced Lore-id (`Supersedes`,
    /// `Depends-on`, `Related`) that is not in the repository. Malformed ids
    /// are skipped here; `reference-format` already reported them.
    fn validate_reference_existence(
        &self,
        trailers: &LoreTrailers,
        issues: &mut Vec<ValidationIssue>,
    ) -> Result<()> {
        let ref_sets: Vec<(TrailerKey, &Vec<String>)> = TrailerKey::REFERENCE
            .iter()
            .filter_map(|key| trailers.array_values(*key).map(|v| (*key, v)))
            .filter(|(_, values)| !values.is_empty())
            .collect();

        let has_valid_ids = ref_sets
            .iter()
            .flat_map(|(_, values)| values.iter())
            .any(|id| is_valid_lore_id(id));

        // One shared index pass replaces one full-history grep per id.
        let index = if has_valid_ids {
            Some(self.repo.lore_id_index()?)
        } else {
            None
        };

        for (key, values) in ref_sets {
            for id in values {
                if !is_valid_lore_id(id) {
                    continue;
                }
                let found = index.as_ref().is_some_and(|idx| idx.contains_key(id));
                if !found {
                    issues.push(ValidationIssue::warning(
                        "reference-exists",
                        format!("Referenced atom \"{id}\" in {key} not found in repository"),
                    ));
                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests;
