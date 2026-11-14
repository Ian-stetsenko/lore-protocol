//! Reads commit input by parsing a JSON document.
//!
//! Used for both file-based and stdin-based input; the caller fetches the raw
//! content and this reader only handles parsing.

use serde_json::Value;

use crate::interfaces::commit_input_reader::CommitInputReader;
use crate::types::commit_input::{CommitInput, CommitInputTrailers};
use crate::types::custom_trailer_collection::CustomTrailerCollection;
use crate::types::domain::TrailerKey;
use crate::util::Result;

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
        let parsed: Value = serde_json::from_str(content)?;

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
