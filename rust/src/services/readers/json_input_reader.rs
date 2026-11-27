//! Reads commit input by parsing a JSON document.
//!
//! Used for both file-based and stdin-based input; the caller fetches the raw
//! content and this reader only handles parsing.

use serde_json::Value;

use crate::interfaces::commit_input_reader::CommitInputReader;
use crate::types::commit_input::{CommitInput, CommitInputTrailers};
use crate::types::custom_trailer_collection::CustomTrailerCollection;
use crate::types::domain::TrailerKey;
use crate::util::{LoreError, Result};

/// Top-level keys accepted in commit input JSON.
const TOP_LEVEL_KEYS: [&str; 3] = ["intent", "body", "trailers"];

/// [`CommitInputReader`] over a JSON string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonInputReader {
    content: String,
}

impl JsonInputReader {
    pub fn new(content: String) -> Self {
        JsonInputReader { content }
    }

    fn parse(content: &str) -> Result<CommitInput> {
        let parsed: Value = serde_json::from_str(content)
            .map_err(|e| LoreError::new(format!("Commit input is not valid JSON: {e}")))?;
        validate_top_level(&parsed)?;

        let intent = parsed
            .get("intent")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let body = parsed
            .get("body")
            .and_then(Value::as_str)
            .map(str::to_owned);

        let trailers = parsed
            .get("trailers")
            .and_then(Value::as_object)
            .map(|raw| {
                let custom = CustomTrailerCollection::from_raw(raw);
                let array = |key: TrailerKey| raw.get(key.as_str()).and_then(as_string_vec);
                let enum_value = |key: TrailerKey| {
                    raw.get(key.as_str())
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                };

                CommitInputTrailers {
                    constraint: array(TrailerKey::Constraint),
                    rejected: array(TrailerKey::Rejected),
                    confidence: enum_value(TrailerKey::Confidence),
                    scope_risk: enum_value(TrailerKey::ScopeRisk),
                    reversibility: enum_value(TrailerKey::Reversibility),
                    directive: array(TrailerKey::Directive),
                    tested: array(TrailerKey::Tested),
                    not_tested: array(TrailerKey::NotTested),
                    supersedes: array(TrailerKey::Supersedes),
                    depends_on: array(TrailerKey::DependsOn),
                    related: array(TrailerKey::Related),
                    custom: if custom.is_empty() {
                        None
                    } else {
                        Some(custom)
                    },
                }
            });

        Ok(CommitInput {
            intent,
            body,
            trailers,
        })
    }
}

impl CommitInputReader for JsonInputReader {
    fn read(&self) -> Result<CommitInput> {
        Self::parse(&self.content)
    }
}

/// Reject malformed top-level input loudly. A misspelled or flat schema must
/// fail the commit, never silently produce a barren atom. Inner trailer
/// parsing stays lenient; only the top level is strict.
fn validate_top_level(value: &Value) -> Result<()> {
    let Value::Object(fields) = value else {
        return Err(LoreError::new(format!(
            "Commit input JSON must be an object with allowed keys intent, body, trailers; got {}.",
            json_type_of(value)
        )));
    };

    let unknown: Vec<String> = fields
        .keys()
        .filter(|key| !TOP_LEVEL_KEYS.contains(&key.as_str()))
        .map(|key| format!("\"{key}\""))
        .collect();
    if !unknown.is_empty() {
        let plural = if unknown.len() > 1 { "s" } else { "" };
        return Err(LoreError::new(format!(
            "Unknown top-level key{plural} in commit input JSON: {}. Allowed keys: intent, body, trailers. \
             Trailer values belong inside the trailers object, e.g. {{\"intent\": \"...\", \"trailers\": {{\"Tested\": [\"...\"]}}}}.",
            unknown.join(", ")
        )));
    }

    require_type(fields.get("intent"), "intent", "a string", Value::is_string)?;
    require_type(fields.get("body"), "body", "a string", Value::is_string)?;
    require_type(
        fields.get("trailers"),
        "trailers",
        "an object",
        Value::is_object,
    )
}

/// Fails when a present top-level field does not have the expected JSON type.
fn require_type(
    field: Option<&Value>,
    name: &str,
    expected: &str,
    has_expected_type: fn(&Value) -> bool,
) -> Result<()> {
    match field {
        Some(value) if !has_expected_type(value) => Err(LoreError::new(format!(
            "\"{name}\" must be {expected}, got {}.",
            json_type_of(value)
        ))),
        _ => Ok(()),
    }
}

/// Human-readable JSON type of a value, matching JavaScript's `typeof` with
/// `null` and `array` split out.
fn json_type_of(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
        Value::String(_) => "string",
        Value::Number(_) => "number",
        Value::Bool(_) => "boolean",
    }
}

/// A list keeps only its string elements; a string becomes a one-element
/// list; anything else is `None`.
fn as_string_vec(value: &Value) -> Option<Vec<String>> {
    match value {
        Value::Array(items) => Some(
            items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect(),
        ),
        Value::String(s) => Some(vec![s.clone()]),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
