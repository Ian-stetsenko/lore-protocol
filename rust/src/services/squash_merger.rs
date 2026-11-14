//! Merges several atoms into a single squash commit message.
//!
//! Array trailers are unioned and de-duplicated, reference trailers keep
//! only external references, enum trailers collapse to the most conservative
//! value, and a fresh Lore-id is generated for the merged commit.

use std::collections::HashSet;

use crate::interfaces::lore_id_generator::LoreIdGenerator;
use crate::types::domain::{ConfidenceLevel, LoreAtom, ReversibilityLevel, ScopeRiskLevel};
use crate::util::{LoreError, Result};

/// Overrides for the merged message. `None` derives the value from the atoms.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SquashOptions {
    /// Replaces the newest atom's intent as the subject line.
    pub intent: Option<String>,
    /// Replaces the concatenated body summaries. An empty string yields no body.
    pub body: Option<String>,
}

/// Builds a squash commit message from a set of atoms.
pub struct SquashMerger<'a> {
    lore_id_generator: &'a dyn LoreIdGenerator,
}

impl<'a> SquashMerger<'a> {
    pub fn new(lore_id_generator: &'a dyn LoreIdGenerator) -> Self {
        SquashMerger { lore_id_generator }
    }

    /// Merge `atoms` into one commit message.
    ///
    /// - Subject: `options.intent`, else the intent of the newest atom (by date).
    /// - Body: `options.body`, else the trimmed non-empty bodies of all atoms
    ///   in date order, separated by blank lines.
    /// - Array trailers are unioned (first occurrence wins) in input order.
    /// - Reference trailers drop any Lore-id that belongs to a merged atom.
    /// - Confidence takes the lowest level; Scope-risk and Reversibility the
    ///   highest.
    /// - Custom trailers are not carried over (matches the TypeScript port).
    ///
    /// Returns an error for an empty slice.
    pub fn merge(&self, atoms: &[LoreAtom], options: &SquashOptions) -> Result<String> {
        if atoms.is_empty() {
            return Err(LoreError::new("Cannot merge zero atoms"));
        }

        let new_lore_id = self.lore_id_generator.generate();
        let internal_ids: HashSet<&str> = atoms.iter().map(|a| a.lore_id.as_str()).collect();

        // Stable sort by date ascending so the newest is last.
        let mut sorted: Vec<&LoreAtom> = atoms.iter().collect();
        sorted.sort_by_key(|a| a.date);
        let newest = sorted[sorted.len() - 1];

        let intent = options
            .intent
            .clone()
            .unwrap_or_else(|| newest.intent.clone());

        let body = options
            .body
            .clone()
            .unwrap_or_else(|| merge_body_summaries(&sorted));

        let constraints = union_dedup(atoms.iter().map(|a| &a.trailers.constraint));
        let rejected = union_dedup(atoms.iter().map(|a| &a.trailers.rejected));
        let directives = union_dedup(atoms.iter().map(|a| &a.trailers.directive));
        let tested = union_dedup(atoms.iter().map(|a| &a.trailers.tested));
        let not_tested = union_dedup(atoms.iter().map(|a| &a.trailers.not_tested));

        let supersedes = filter_external(
            union_dedup(atoms.iter().map(|a| &a.trailers.supersedes)),
            &internal_ids,
        );
        let depends_on = filter_external(
            union_dedup(atoms.iter().map(|a| &a.trailers.depends_on)),
            &internal_ids,
        );
        let related = filter_external(
            union_dedup(atoms.iter().map(|a| &a.trailers.related)),
            &internal_ids,
        );

        let confidence = merge_confidence(atoms);
        let scope_risk = merge_scope_risk(atoms);
        let reversibility = merge_reversibility(atoms);

        let mut trailer_lines: Vec<String> = vec![format!("Lore-id: {new_lore_id}")];
        push_all(&mut trailer_lines, "Constraint", &constraints);
        push_all(&mut trailer_lines, "Rejected", &rejected);
        if let Some(level) = confidence {
            trailer_lines.push(format!("Confidence: {level}"));
        }
        if let Some(level) = scope_risk {
            trailer_lines.push(format!("Scope-risk: {level}"));
        }
        if let Some(level) = reversibility {
            trailer_lines.push(format!("Reversibility: {level}"));
        }
        push_all(&mut trailer_lines, "Directive", &directives);
        push_all(&mut trailer_lines, "Tested", &tested);
        push_all(&mut trailer_lines, "Not-tested", &not_tested);
        push_all(&mut trailer_lines, "Supersedes", &supersedes);
        push_all(&mut trailer_lines, "Depends-on", &depends_on);
        push_all(&mut trailer_lines, "Related", &related);

        let mut parts: Vec<String> = vec![intent];
        if !body.is_empty() {
            parts.push(String::new());
            parts.push(body);
        }
        parts.push(String::new());
        parts.push(trailer_lines.join("\n"));

        Ok(parts.join("\n"))
    }
}

fn merge_body_summaries(sorted_atoms: &[&LoreAtom]) -> String {
    sorted_atoms
        .iter()
        .map(|a| a.body.trim())
        .filter(|b| !b.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Concatenate value lists keeping only the first occurrence of each value.
fn union_dedup<'v>(lists: impl Iterator<Item = &'v Vec<String>>) -> Vec<String> {
    let mut seen: HashSet<&str> = HashSet::new();
    let mut result: Vec<String> = Vec::new();
    for list in lists {
        for item in list {
            if seen.insert(item.as_str()) {
                result.push(item.clone());
            }
        }
    }
    result
}

fn filter_external(values: Vec<String>, internal_ids: &HashSet<&str>) -> Vec<String> {
    values
        .into_iter()
        .filter(|v| !internal_ids.contains(v.as_str()))
        .collect()
}

fn push_all(lines: &mut Vec<String>, key: &str, values: &[String]) {
    for value in values {
        lines.push(format!("{key}: {value}"));
    }
}

/// Lowest index in `ConfidenceLevel::ALL` (most conservative / least confident).
fn merge_confidence(atoms: &[LoreAtom]) -> Option<ConfidenceLevel> {
    atoms
        .iter()
        .filter_map(|a| a.trailers.confidence)
        .min_by_key(|level| level.index())
}

/// Highest index in `ScopeRiskLevel::ALL` (widest scope).
fn merge_scope_risk(atoms: &[LoreAtom]) -> Option<ScopeRiskLevel> {
    atoms
        .iter()
        .filter_map(|a| a.trailers.scope_risk)
        .max_by_key(|level| level.index())
}

/// Highest index in `ReversibilityLevel::ALL` (least reversible).
fn merge_reversibility(atoms: &[LoreAtom]) -> Option<ReversibilityLevel> {
    atoms
        .iter()
        .filter_map(|a| a.trailers.reversibility)
        .max_by_key(|level| level.index())
}

#[cfg(test)]
mod tests;
