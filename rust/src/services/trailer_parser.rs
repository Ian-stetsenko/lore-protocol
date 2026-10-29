//! Parses raw trailer text into [`LoreTrailers`] and serializes back.
//!
//! Only parsing and serialization live here: no git interaction and no
//! validation (the parser silently drops invalid enum values; the
//! `Validator` reports them).

use std::sync::LazyLock;

use indexmap::IndexMap;
use regex::Regex;

use crate::types::custom_trailer_collection::CustomTrailerCollection;
use crate::types::domain::{
    ConfidenceLevel, LoreTrailers, ReversibilityLevel, ScopeRiskLevel, TrailerKey,
};

static TRAILER_LINE_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$").expect("valid regex"));
static CONTINUATION_LINE_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[ \t]+(.*)$").expect("valid regex"));
static PARAGRAPH_BREAK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\n\n+").expect("valid regex"));

/// A `Key: value` pair extracted from a trailer block, with continuation
/// lines already folded in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrailerEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct TrailerParser;

impl TrailerParser {
    pub fn new() -> Self {
        TrailerParser
    }

    /// Parse a raw trailer block (multi-line) into [`LoreTrailers`].
    ///
    /// Lines in `Key: Value` format are trailers; lines starting with
    /// whitespace continue the previous value. Array trailers may repeat;
    /// enum trailers keep the last *valid* value seen; `Lore-id` keeps the
    /// last value. Unknown keys go to `custom` when `custom_keys` is empty
    /// (accept all) or lists the key.
    pub fn parse(&self, raw_trailers: &str, custom_keys: &[String]) -> LoreTrailers {
        let mut trailers = LoreTrailers::default();
        let mut custom: IndexMap<String, Vec<String>> = IndexMap::new();

        for TrailerEntry { key, value } in self.parse_lines_to_entries(raw_trailers.split('\n')) {
            let value = value.trim();
            match TrailerKey::parse(&key) {
                Some(TrailerKey::LoreId) => trailers.lore_id = value.to_owned(),
                Some(k) if k.is_array() => {
                    if let Some(values) = trailers.array_values_mut(k) {
                        values.push(value.to_owned());
                    }
                }
                Some(TrailerKey::Confidence) => {
                    if let Some(level) = ConfidenceLevel::parse(value) {
                        trailers.confidence = Some(level);
                    }
                }
                Some(TrailerKey::ScopeRisk) => {
                    if let Some(level) = ScopeRiskLevel::parse(value) {
                        trailers.scope_risk = Some(level);
                    }
                }
                Some(TrailerKey::Reversibility) => {
                    if let Some(level) = ReversibilityLevel::parse(value) {
                        trailers.reversibility = Some(level);
                    }
                }
                Some(_) => {}
                None => {
                    if custom_keys.is_empty() || custom_keys.iter().any(|k| *k == key) {
                        custom.entry(key).or_default().push(value.to_owned());
                    }
                }
            }
        }

        trailers.custom = CustomTrailerCollection::new(custom);
        trailers
    }

    /// Serialize trailers to git trailer format, one `Key: Value` per line.
    /// Order: `Lore-id`, array trailers, enum trailers, custom trailers.
    pub fn serialize(&self, trailers: &LoreTrailers) -> String {
        let mut lines: Vec<String> = Vec::new();

        if !trailers.lore_id.is_empty() {
            lines.push(format!("Lore-id: {}", trailers.lore_id));
        }

        for key in TrailerKey::ARRAY {
            if let Some(values) = trailers.array_values(key) {
                for value in values {
                    lines.push(format!("{key}: {value}"));
                }
            }
        }

        for key in TrailerKey::ENUM {
            if let Some(value) = trailers.enum_value(key) {
                lines.push(format!("{key}: {value}"));
            }
        }

        for (key, values) in &trailers.custom {
            for value in values {
                lines.push(format!("{key}: {value}"));
            }
        }

        lines.join("\n")
    }

    /// Whether any line of `text` is a trailer with a known Lore key.
    pub fn contains_lore_trailers(&self, text: &str) -> bool {
        text.split('\n').any(|line| {
            TRAILER_LINE_PATTERN
                .captures(line)
                .map(|c| TrailerKey::parse(&c[1]).is_some())
                .unwrap_or(false)
        })
    }

    /// Extract the trailer block (last paragraph) from a full commit message.
    ///
    /// Returns an empty string when the last paragraph has no `Key: Value`
    /// line or contains a line that is neither a trailer nor a continuation.
    pub fn extract_trailer_block(&self, full_message: &str) -> String {
        let trimmed = full_message.trim_end();
        if trimmed.is_empty() {
            return String::new();
        }

        let last_paragraph = PARAGRAPH_BREAK.split(trimmed).last().unwrap_or("");
        let lines: Vec<&str> = last_paragraph.split('\n').collect();

        let has_trailer_line = lines.iter().any(|l| TRAILER_LINE_PATTERN.is_match(l));
        if !has_trailer_line {
            return String::new();
        }

        let all_trailer_shaped = lines.iter().all(|l| {
            TRAILER_LINE_PATTERN.is_match(l)
                || CONTINUATION_LINE_PATTERN.is_match(l)
                || l.trim().is_empty()
        });
        if !all_trailer_shaped {
            return String::new();
        }

        last_paragraph.to_owned()
    }

    /// Fold lines into `Key: Value` entries. A continuation line (leading
    /// whitespace) appends to the previous entry with a single space.
    pub fn parse_lines_to_entries<'a>(
        &self,
        lines: impl IntoIterator<Item = &'a str>,
    ) -> Vec<TrailerEntry> {
        let mut entries: Vec<TrailerEntry> = Vec::new();

        for line in lines {
            if line.trim().is_empty() {
                continue;
            }

            if let Some(cont) = CONTINUATION_LINE_PATTERN.captures(line) {
                if let Some(last) = entries.last_mut() {
                    last.value = format!("{} {}", last.value, &cont[1]);
                    continue;
                }
            }

            if let Some(caps) = TRAILER_LINE_PATTERN.captures(line) {
                entries.push(TrailerEntry {
                    key: caps[1].to_owned(),
                    value: caps[2].to_owned(),
                });
            }
        }

        entries
    }
}

#[cfg(test)]
mod tests;
