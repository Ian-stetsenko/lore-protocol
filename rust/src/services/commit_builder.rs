//! Builds a Lore commit message from resolved input and validates the input
//! against the configuration before committing.

use crate::interfaces::lore_id_generator::LoreIdGenerator;
use crate::types::commit_input::{CommitInput, CommitInputTrailers};
use crate::types::config::LoreConfig;
use crate::types::custom_trailer_collection::CustomTrailerCollection;
use crate::types::domain::{
    ConfidenceLevel, LoreId, LoreTrailers, ReversibilityLevel, ScopeRiskLevel, TrailerKey,
};
use crate::types::output::ValidationIssue;
use crate::util::constants::{
    is_valid_lore_id, CONFIDENCE_VALUES, REVERSIBILITY_VALUES, SCOPE_RISK_VALUES,
};

use super::trailer_parser::TrailerParser;

/// The message assembled by [`CommitBuilder::build`] and the Lore-id it carries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BuiltCommit {
    pub message: String,
    pub lore_id: LoreId,
}

/// Assembles `intent / body / trailers` into a commit message.
pub struct CommitBuilder<'a> {
    parser: &'a TrailerParser,
    generator: &'a dyn LoreIdGenerator,
    config: &'a LoreConfig,
}

impl<'a> CommitBuilder<'a> {
    pub fn new(
        parser: &'a TrailerParser,
        generator: &'a dyn LoreIdGenerator,
        config: &'a LoreConfig,
    ) -> Self {
        CommitBuilder {
            parser,
            generator,
            config,
        }
    }

    /// Build the full commit message. Reuses `existing_lore_id` when given
    /// (amend), otherwise generates a fresh id.
    pub fn build(&self, input: &CommitInput, existing_lore_id: Option<&str>) -> BuiltCommit {
        let lore_id: LoreId = match existing_lore_id {
            Some(id) => id.to_owned(),
            None => self.generator.generate(),
        };
        let trailers = Self::build_trailers(&lore_id, input);
        let serialized = self.parser.serialize(&trailers);

        let mut parts: Vec<&str> = vec![input.intent.as_str()];

        // JS: `if (input.body)` -- an empty body is omitted.
        if let Some(body) = input.body.as_deref().filter(|b| !b.is_empty()) {
            parts.push("");
            parts.push(body);
        }

        parts.push("");
        parts.push(&serialized);

        BuiltCommit {
            message: parts.join("\n"),
            lore_id,
        }
    }

    /// Validate the input against the protocol rules and the configuration.
    pub fn validate(&self, input: &CommitInput) -> Vec<ValidationIssue> {
        let mut issues: Vec<ValidationIssue> = Vec::new();
        let validation = &self.config.validation;

        // 1. Intent length. Counted in chars (JS counts UTF-16 code units;
        //    they differ only outside the Basic Multilingual Plane).
        let intent_length = input.intent.chars().count();
        if intent_length > validation.intent_max_length {
            issues.push(ValidationIssue::warning(
                "intent-length",
                format!(
                    "Intent exceeds {} characters (got {intent_length})",
                    validation.intent_max_length
                ),
            ));
        }

        // 2. Intent must not be empty
        if input.intent.trim().is_empty() {
            issues.push(ValidationIssue::error(
                "intent-required",
                "Intent must not be empty",
            ));
        }

        if let Some(trailers) = &input.trailers {
            // 3. Validate enum values
            let enum_checks: [(TrailerKey, Option<&str>, &[&str]); 3] = [
                (
                    TrailerKey::Confidence,
                    trailers.confidence.as_deref(),
                    &CONFIDENCE_VALUES,
                ),
                (
                    TrailerKey::ScopeRisk,
                    trailers.scope_risk.as_deref(),
                    &SCOPE_RISK_VALUES,
                ),
                (
                    TrailerKey::Reversibility,
                    trailers.reversibility.as_deref(),
                    &REVERSIBILITY_VALUES,
                ),
            ];
            for (key, value, allowed) in enum_checks {
                if let Some(value) = value {
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

            // 4. Validate lore-id format in reference trailers
            for key in TrailerKey::REFERENCE {
                if let Some(values) = trailers.array(key) {
                    for value in values {
                        if !is_valid_lore_id(value) {
                            issues.push(ValidationIssue::error(
                                "invalid-lore-id-ref",
                                format!(
                                    "Invalid Lore-id reference in {key}: \"{value}\". Must be 8-character hex."
                                ),
                            ));
                        }
                    }
                }
            }
        }

        // 5. Required trailers from config
        for required in &self.config.trailers.required {
            if !Self::has_trailer(input, required) {
                let message = format!("Required trailer \"{required}\" is missing");
                issues.push(if validation.strict {
                    ValidationIssue::error("required-trailer", message)
                } else {
                    ValidationIssue::warning("required-trailer", message)
                });
            }
        }

        // 6. Total message line count
        let line_count = Self::estimate_line_count(input);
        if line_count > validation.max_message_lines {
            issues.push(ValidationIssue::warning(
                "message-length",
                format!(
                    "Message exceeds {} lines (estimated {line_count})",
                    validation.max_message_lines
                ),
            ));
        }

        issues
    }

    /// Map the raw input trailers onto the typed [`LoreTrailers`]. Enum
    /// values that do not parse become `None` (`validate` reports them).
    fn build_trailers(lore_id: &str, input: &CommitInput) -> LoreTrailers {
        let empty = CommitInputTrailers::default();
        let t = input.trailers.as_ref().unwrap_or(&empty);
        let array = |key: TrailerKey| t.array(key).cloned().unwrap_or_default();

        LoreTrailers {
            lore_id: lore_id.to_owned(),
            constraint: array(TrailerKey::Constraint),
            rejected: array(TrailerKey::Rejected),
            confidence: t.confidence.as_deref().and_then(ConfidenceLevel::parse),
            scope_risk: t.scope_risk.as_deref().and_then(ScopeRiskLevel::parse),
            reversibility: t
                .reversibility
                .as_deref()
                .and_then(ReversibilityLevel::parse),
            directive: array(TrailerKey::Directive),
            tested: array(TrailerKey::Tested),
            not_tested: array(TrailerKey::NotTested),
            supersedes: array(TrailerKey::Supersedes),
            depends_on: array(TrailerKey::DependsOn),
            related: array(TrailerKey::Related),
            custom: t
                .custom
                .clone()
                .unwrap_or_else(CustomTrailerCollection::empty),
        }
    }

    fn has_trailer(input: &CommitInput, key: &str) -> bool {
        input.trailers.as_ref().map(|t| t.has(key)).unwrap_or(false)
    }

    fn estimate_line_count(input: &CommitInput) -> usize {
        let mut count = 1; // intent line
        if let Some(body) = input.body.as_deref().filter(|b| !b.is_empty()) {
            count += 1; // blank line
            count += body.split('\n').count();
        }
        count += 1; // blank line before trailers
        if let Some(t) = &input.trailers {
            count += 1; // Lore-id
            for key in TrailerKey::ARRAY {
                if let Some(values) = t.array(key) {
                    count += values.len();
                }
            }
            for key in TrailerKey::ENUM {
                if t.enum_value(key).is_some() {
                    count += 1;
                }
            }
            if let Some(custom) = &t.custom {
                count += custom.line_count();
            }
        }
        count
    }
}

#[cfg(test)]
mod tests;
