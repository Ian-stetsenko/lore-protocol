//! JSON output formatter.
//!
//! Produces the exact object shapes emitted by the TypeScript `JsonFormatter`:
//! snake_case keys in the same insertion order, `lore_version` first, and
//! `JSON.stringify(x, null, 2)`-style two-space indentation.

use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{json, Map, Value};

use crate::interfaces::output_formatter::{ErrorMessage, OutputFormatter};
use crate::types::domain::{LoreAtom, LoreTrailers, TrailerKey};
use crate::types::output::{
    FormattableDoctorResult, FormattableQueryResult, FormattableStalenessResult,
    FormattableTraceResult, FormattableValidationResult, VisibleTrailers,
};
use crate::util::constants::LORE_VERSION;

/// Renders results as pretty-printed JSON for machine consumption.
#[derive(Debug, Default, Clone, Copy)]
pub struct JsonFormatter;

impl JsonFormatter {
    /// Create a formatter.
    pub fn new() -> Self {
        JsonFormatter
    }

    /// Serialize the visible trailers of an atom as a snake_case object.
    ///
    /// `lore_id` is always present; every other known trailer appears only
    /// when it is visible and carries a value. Custom trailers follow, keyed
    /// by their lower-cased wire name with `-` replaced by `_`.
    fn serialize_trailers(trailers: &LoreTrailers, visible: &VisibleTrailers) -> Value {
        let mut result = Map::new();
        result.insert("lore_id".to_owned(), json!(trailers.lore_id));

        // Same order as the TS implementation (protocol order minus Lore-id).
        let keys = [
            TrailerKey::Constraint,
            TrailerKey::Rejected,
            TrailerKey::Confidence,
            TrailerKey::ScopeRisk,
            TrailerKey::Reversibility,
            TrailerKey::Directive,
            TrailerKey::Tested,
            TrailerKey::NotTested,
            TrailerKey::Supersedes,
            TrailerKey::DependsOn,
            TrailerKey::Related,
        ];

        for key in keys {
            if !visible.shows(key) {
                continue;
            }
            let json_key = snake_case_key(key.as_str());
            if let Some(values) = trailers.array_values(key) {
                if !values.is_empty() {
                    result.insert(json_key, json!(values));
                }
            } else if let Some(value) = trailers.enum_value(key) {
                result.insert(json_key, json!(value));
            }
        }

        for (key, values) in &trailers.custom {
            if !values.is_empty() {
                result.insert(snake_case_key(key), json!(values));
            }
        }

        Value::Object(result)
    }

    /// Compact atom summary used by trace output (`root` and `target_atom`).
    fn atom_summary(atom: &LoreAtom) -> Value {
        json!({
            "lore_id": atom.lore_id,
            "commit": atom.commit_hash,
            "date": iso(atom.date),
            "author": atom.author,
            "intent": atom.intent,
        })
    }
}

/// `JSON.stringify(value, null, 2)`.
///
/// Serialising these plain values cannot fail; an empty string is returned
/// rather than panicking if it somehow does.
fn stringify(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_default()
}

/// JS `Date.prototype.toISOString()`: `2025-01-15T10:00:00.000Z`.
fn iso(dt: DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(SecondsFormat::Millis, true)
}

/// `key.toLowerCase().replace(/-/g, '_')`.
fn snake_case_key(key: &str) -> String {
    key.to_lowercase().replace('-', "_")
}

impl OutputFormatter for JsonFormatter {
    fn format_query_result(&self, data: &FormattableQueryResult) -> String {
        let result = &data.result;

        let results: Vec<Value> = result
            .atoms
            .iter()
            .map(|atom| {
                let supersession = data.supersession_map.get(&atom.lore_id);
                json!({
                    "lore_id": atom.lore_id,
                    "commit": atom.commit_hash,
                    "date": iso(atom.date),
                    "author": atom.author,
                    "intent": atom.intent,
                    "body": atom.body,
                    "trailers": Self::serialize_trailers(&atom.trailers, &data.visible_trailers),
                    "files_changed": atom.files_changed,
                    "superseded": supersession.map(|s| s.superseded).unwrap_or(false),
                    "superseded_by": supersession.and_then(|s| s.superseded_by.clone()),
                })
            })
            .collect();

        stringify(&json!({
            "lore_version": LORE_VERSION,
            "command": result.command,
            "target": result.target,
            "target_type": result.target_type.as_str(),
            "meta": {
                "total_atoms": result.meta.total_atoms,
                "filtered_atoms": result.meta.filtered_atoms,
                "oldest": result.meta.oldest.map(iso),
                "newest": result.meta.newest.map(iso),
            },
            "results": results,
        }))
    }

    fn format_validation_result(&self, data: &FormattableValidationResult) -> String {
        let results: Vec<Value> = data
            .results
            .iter()
            .map(|r| {
                let issues: Vec<Value> = r
                    .issues
                    .iter()
                    .map(|issue| {
                        json!({
                            "severity": issue.severity.as_str(),
                            "rule": issue.rule,
                            "message": issue.message,
                        })
                    })
                    .collect();
                json!({
                    "commit": r.commit,
                    "lore_id": r.lore_id,
                    "valid": r.valid,
                    "issues": issues,
                })
            })
            .collect();

        stringify(&json!({
            "lore_version": LORE_VERSION,
            "valid": data.valid,
            "summary": {
                "errors": data.summary.errors,
                "warnings": data.summary.warnings,
                "commits_checked": data.summary.commits_checked,
            },
            "results": results,
        }))
    }

    fn format_staleness_result(&self, data: &FormattableStalenessResult) -> String {
        let stale_atoms: Vec<Value> = data
            .atoms
            .iter()
            .map(|report| {
                let reasons: Vec<Value> = report
                    .reasons
                    .iter()
                    .map(|r| {
                        json!({
                            "signal": r.signal.as_str(),
                            "description": r.description,
                        })
                    })
                    .collect();
                json!({
                    "lore_id": report.atom.lore_id,
                    "commit": report.atom.commit_hash,
                    "date": iso(report.atom.date),
                    "author": report.atom.author,
                    "intent": report.atom.intent,
                    "reasons": reasons,
                })
            })
            .collect();

        stringify(&json!({
            "lore_version": LORE_VERSION,
            "stale_atoms": stale_atoms,
        }))
    }

    fn format_trace_result(&self, data: &FormattableTraceResult) -> String {
        let edges: Vec<Value> = data
            .edges
            .iter()
            .map(|edge| {
                json!({
                    "from": edge.from,
                    "to": edge.to,
                    "relationship": edge.relationship.as_str(),
                    "resolved": edge.target_atom.is_some(),
                    "target_atom": edge.target_atom.as_ref().map(Self::atom_summary),
                })
            })
            .collect();

        stringify(&json!({
            "lore_version": LORE_VERSION,
            "root": Self::atom_summary(&data.root),
            "edges": edges,
        }))
    }

    fn format_doctor_result(&self, data: &FormattableDoctorResult) -> String {
        let checks: Vec<Value> = data
            .checks
            .iter()
            .map(|check| {
                json!({
                    "name": check.name,
                    "status": check.status.as_str(),
                    "message": check.message,
                    "details": check.details,
                })
            })
            .collect();

        stringify(&json!({
            "lore_version": LORE_VERSION,
            "checks": checks,
            "summary": {
                "errors": data.summary.errors,
                "warnings": data.summary.warnings,
                "info": data.summary.info,
            },
        }))
    }

    fn format_success(&self, message: &str, data: Option<&Map<String, Value>>) -> String {
        let mut object = Map::new();
        object.insert("lore_version".to_owned(), json!(LORE_VERSION));
        object.insert("success".to_owned(), json!(true));
        object.insert("message".to_owned(), json!(message));
        // Spread semantics: later keys override earlier ones, insertion order kept.
        if let Some(extra) = data {
            for (key, value) in extra {
                object.insert(key.clone(), value.clone());
            }
        }
        stringify(&Value::Object(object))
    }

    fn format_error(&self, code: i32, messages: &[ErrorMessage]) -> String {
        let messages: Vec<Value> = messages
            .iter()
            .map(|msg| {
                json!({
                    "severity": msg.severity.as_str(),
                    "field": msg.field,
                    "message": msg.message,
                })
            })
            .collect();

        stringify(&json!({
            "lore_version": LORE_VERSION,
            "error": true,
            "code": code,
            "messages": messages,
        }))
    }
}

#[cfg(test)]
mod tests;
