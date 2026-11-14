//! Applies `lore search` filters to a collection of atoms.
//!
//! Only filtering logic lives here: no git interaction or formatting. Date
//! and limit options on [`SearchOptions`] are handled by the repository and
//! command layers, not by this filter.

use std::sync::LazyLock;

use regex::Regex;

use crate::types::domain::{LoreAtom, TrailerKey};
use crate::types::query::SearchOptions;

/// Conventional-commit scope: `type(scope): ...` -> captures `scope`.
static SCOPE_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-zA-Z]+\(([^)]+)\)").expect("valid regex"));

/// Matches atoms against search criteria.
#[derive(Debug, Clone, Copy, Default)]
pub struct SearchFilter;

impl SearchFilter {
    pub fn new() -> Self {
        SearchFilter
    }

    /// Apply every active filter in `options` to `atoms`, preserving order.
    ///
    /// Enum filters compare the raw option string with the trailer's wire
    /// value, so an unrecognised value matches nothing. `has` names a trailer
    /// key by wire name; an unknown key matches nothing. `author` and `text`
    /// are case-insensitive substring matches; `scope` is a case-insensitive
    /// match on the conventional-commit scope of the intent.
    pub fn apply_filters(&self, atoms: &[LoreAtom], options: &SearchOptions) -> Vec<LoreAtom> {
        let mut result: Vec<&LoreAtom> = atoms.iter().collect();

        if let Some(confidence) = &options.confidence {
            result.retain(|a| {
                a.trailers.enum_value(TrailerKey::Confidence) == Some(confidence.as_str())
            });
        }

        if let Some(scope_risk) = &options.scope_risk {
            result.retain(|a| {
                a.trailers.enum_value(TrailerKey::ScopeRisk) == Some(scope_risk.as_str())
            });
        }

        if let Some(reversibility) = &options.reversibility {
            result.retain(|a| {
                a.trailers.enum_value(TrailerKey::Reversibility) == Some(reversibility.as_str())
            });
        }

        if let Some(has) = &options.has {
            let key = TrailerKey::parse(has);
            result.retain(|a| key.is_some_and(|k| self.atom_has_trailer(a, k)));
        }

        if let Some(author) = &options.author {
            let author_lower = author.to_lowercase();
            result.retain(|a| a.author.to_lowercase().contains(&author_lower));
        }

        if let Some(scope) = &options.scope {
            let scope_lower = scope.to_lowercase();
            result.retain(|a| {
                SCOPE_PATTERN
                    .captures(&a.intent)
                    .is_some_and(|caps| caps[1].to_lowercase() == scope_lower)
            });
        }

        if let Some(text) = &options.text {
            let text_lower = text.to_lowercase();
            result.retain(|a| self.atom_matches_text(a, &text_lower));
        }

        result.into_iter().cloned().collect()
    }

    /// Whether the atom carries a value for `key`: a non-empty `Lore-id`, at
    /// least one array value, or a set enum value.
    pub fn atom_has_trailer(&self, atom: &LoreAtom, key: TrailerKey) -> bool {
        atom.trailers.has_value(key)
    }

    /// Whether `text_lower` (already lower-cased) occurs in the intent, body,
    /// any array trailer value or any enum trailer value. Custom trailers are
    /// not searched, matching the TypeScript implementation.
    pub fn atom_matches_text(&self, atom: &LoreAtom, text_lower: &str) -> bool {
        if atom.intent.to_lowercase().contains(text_lower) {
            return true;
        }
        if atom.body.to_lowercase().contains(text_lower) {
            return true;
        }

        let trailers = &atom.trailers;

        for key in TrailerKey::ARRAY {
            if let Some(values) = trailers.array_values(key) {
                if values.iter().any(|v| v.to_lowercase().contains(text_lower)) {
                    return true;
                }
            }
        }

        for key in TrailerKey::ENUM {
            if let Some(value) = trailers.enum_value(key) {
                if value.to_lowercase().contains(text_lower) {
                    return true;
                }
            }
        }

        false
    }
}

#[cfg(test)]
mod tests;
