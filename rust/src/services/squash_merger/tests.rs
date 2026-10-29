//! Port of `tests/unit/services/squash-merger.test.ts`.

use std::cell::Cell;

use super::{SquashMerger, SquashOptions};
use crate::interfaces::lore_id_generator::LoreIdGenerator;
use crate::test_support::{atom, FixedLoreIdGenerator};
use crate::types::domain::{ConfidenceLevel, LoreAtom, LoreId, ReversibilityLevel, ScopeRiskLevel};

/// `vi.fn(() => 'deadbeef')` equivalent: a fixed generator that also counts calls.
struct CountingGenerator {
    inner: FixedLoreIdGenerator,
    calls: Cell<usize>,
}

impl CountingGenerator {
    fn new() -> Self {
        CountingGenerator {
            inner: FixedLoreIdGenerator::single("deadbeef"),
            calls: Cell::new(0),
        }
    }
}

impl LoreIdGenerator for CountingGenerator {
    fn generate(&self) -> LoreId {
        self.calls.set(self.calls.get() + 1);
        self.inner.generate()
    }
}

fn no_options() -> SquashOptions {
    SquashOptions::default()
}

fn merge(atoms: &[LoreAtom], options: &SquashOptions) -> String {
    let generator = FixedLoreIdGenerator::single("deadbeef");
    SquashMerger::new(&generator)
        .merge(atoms, options)
        .unwrap_or_else(|e| panic!("merge failed: {e}"))
}

fn count(haystack: &str, needle: &str) -> usize {
    haystack.matches(needle).count()
}

#[test]
fn should_throw_for_empty_atoms() {
    let generator = FixedLoreIdGenerator::single("deadbeef");
    let err = SquashMerger::new(&generator)
        .merge(&[], &no_options())
        .err()
        .unwrap_or_else(|| panic!("expected an error for zero atoms"));
    assert_eq!(err.to_string(), "Cannot merge zero atoms");
}

#[test]
fn should_generate_a_new_lore_id() {
    let generator = CountingGenerator::new();
    let a = atom().build();
    let result = SquashMerger::new(&generator)
        .merge(&[a], &no_options())
        .unwrap_or_else(|e| panic!("merge failed: {e}"));

    assert_eq!(generator.calls.get(), 1);
    assert!(result.contains("Lore-id: deadbeef"));
}

// ---- intent merging -----------------------------------------------------------

#[test]
fn should_use_options_intent_when_provided() {
    let a = atom().intent("old intent").build();
    let result = merge(
        &[a],
        &SquashOptions {
            intent: Some("new intent".to_owned()),
            ..no_options()
        },
    );

    assert!(result.starts_with("new intent"));
}

#[test]
fn should_use_newest_atom_intent_when_no_option_provided() {
    let older = atom()
        .id("aaaa0001")
        .date("2025-01-01T00:00:00Z")
        .intent("older intent")
        .build();
    let newer = atom()
        .id("aaaa0002")
        .date("2025-06-01T00:00:00Z")
        .intent("newer intent")
        .build();

    let result = merge(&[older, newer], &no_options());

    assert!(result.starts_with("newer intent"));
}

#[test]
fn should_pick_newest_regardless_of_input_order() {
    let older = atom()
        .id("aaaa0001")
        .date("2025-01-01T00:00:00Z")
        .intent("older intent")
        .build();
    let newer = atom()
        .id("aaaa0002")
        .date("2025-06-01T00:00:00Z")
        .intent("newer intent")
        .build();

    let result = merge(&[newer, older], &no_options());

    assert!(result.starts_with("newer intent"));
}

// ---- body merging ---------------------------------------------------------------

#[test]
fn should_use_options_body_when_provided() {
    let a = atom().body("original body").build();
    let result = merge(
        &[a],
        &SquashOptions {
            body: Some("override body".to_owned()),
            ..no_options()
        },
    );

    assert!(result.contains("override body"));
    assert!(!result.contains("original body"));
}

#[test]
fn should_concatenate_body_summaries_from_all_atoms() {
    let a1 = atom()
        .id("aaaa0001")
        .body("First body")
        .date("2025-01-01T00:00:00Z")
        .build();
    let a2 = atom()
        .id("aaaa0002")
        .body("Second body")
        .date("2025-02-01T00:00:00Z")
        .build();

    let result = merge(&[a1, a2], &no_options());

    assert!(result.contains("First body"));
    assert!(result.contains("Second body"));
    assert!(result.contains("First body\n\nSecond body"));
}

#[test]
fn should_skip_empty_bodies() {
    let a1 = atom()
        .id("aaaa0001")
        .body("")
        .date("2025-01-01T00:00:00Z")
        .build();
    let a2 = atom()
        .id("aaaa0002")
        .body("Has body")
        .date("2025-02-01T00:00:00Z")
        .build();

    let result = merge(&[a1, a2], &no_options());

    assert!(result.contains("Has body"));
    assert!(!result.contains("\n\n\n"));
}

#[test]
fn empty_body_override_should_omit_the_body_section() {
    let a = atom().body("original body").build();
    let result = merge(
        &[a],
        &SquashOptions {
            intent: Some("subject".to_owned()),
            body: Some(String::new()),
        },
    );

    let lines: Vec<&str> = result.split('\n').collect();
    assert_eq!(lines[0], "subject");
    assert_eq!(lines[1], "");
    assert!(lines[2].starts_with("Lore-id: "));
}

// ---- array trailer merging -------------------------------------------------------

#[test]
fn should_union_and_deduplicate_array_trailers() {
    let a1 = atom()
        .id("aaaa0001")
        .constraint(&["Must use HTTPS", "No external deps"])
        .tested(&["Unit tests"])
        .build();
    let a2 = atom()
        .id("aaaa0002")
        .constraint(&["Must use HTTPS", "Max 100ms latency"])
        .tested(&["Integration tests"])
        .build();

    let result = merge(&[a1, a2], &no_options());

    assert!(result.contains("Constraint: Must use HTTPS"));
    assert!(result.contains("Constraint: No external deps"));
    assert!(result.contains("Constraint: Max 100ms latency"));
    // Ensure "Must use HTTPS" appears only once
    assert_eq!(count(&result, "Constraint: Must use HTTPS"), 1);
    assert!(result.contains("Tested: Unit tests"));
    assert!(result.contains("Tested: Integration tests"));
}

// ---- enum trailer merging --------------------------------------------------------

#[test]
fn should_pick_lowest_confidence_most_conservative() {
    let a1 = atom()
        .id("aaaa0001")
        .confidence(ConfidenceLevel::High)
        .build();
    let a2 = atom()
        .id("aaaa0002")
        .confidence(ConfidenceLevel::Low)
        .build();

    let result = merge(&[a1, a2], &no_options());
    assert!(result.contains("Confidence: low"));
}

#[test]
fn should_pick_widest_scope_risk() {
    let a1 = atom()
        .id("aaaa0001")
        .scope_risk(ScopeRiskLevel::Narrow)
        .build();
    let a2 = atom()
        .id("aaaa0002")
        .scope_risk(ScopeRiskLevel::Wide)
        .build();

    let result = merge(&[a1, a2], &no_options());
    assert!(result.contains("Scope-risk: wide"));
}

#[test]
fn should_pick_least_reversible() {
    let a1 = atom()
        .id("aaaa0001")
        .reversibility(ReversibilityLevel::Clean)
        .build();
    let a2 = atom()
        .id("aaaa0002")
        .reversibility(ReversibilityLevel::Irreversible)
        .build();

    let result = merge(&[a1, a2], &no_options());
    assert!(result.contains("Reversibility: irreversible"));
}

#[test]
fn should_handle_null_enum_values_gracefully() {
    let a1 = atom()
        .id("aaaa0001")
        .confidence(ConfidenceLevel::Medium)
        .build();
    let a2 = atom().id("aaaa0002").build();

    let result = merge(&[a1, a2], &no_options());
    assert!(result.contains("Confidence: medium"));
}

#[test]
fn should_return_null_when_all_enum_values_are_null() {
    let a1 = atom().id("aaaa0001").build();

    let result = merge(&[a1], &no_options());
    assert!(!result.contains("Confidence:"));
    assert!(!result.contains("Scope-risk:"));
    assert!(!result.contains("Reversibility:"));
}

#[test]
fn should_pick_medium_over_high_for_confidence() {
    let a1 = atom()
        .id("aaaa0001")
        .confidence(ConfidenceLevel::High)
        .build();
    let a2 = atom()
        .id("aaaa0002")
        .confidence(ConfidenceLevel::Medium)
        .build();

    let result = merge(&[a1, a2], &no_options());
    assert!(result.contains("Confidence: medium"));
}

#[test]
fn should_pick_moderate_over_narrow_for_scope_risk() {
    let a1 = atom()
        .id("aaaa0001")
        .scope_risk(ScopeRiskLevel::Narrow)
        .build();
    let a2 = atom()
        .id("aaaa0002")
        .scope_risk(ScopeRiskLevel::Moderate)
        .build();

    let result = merge(&[a1, a2], &no_options());
    assert!(result.contains("Scope-risk: moderate"));
}

#[test]
fn should_pick_migration_needed_over_clean_for_reversibility() {
    let a1 = atom()
        .id("aaaa0001")
        .reversibility(ReversibilityLevel::Clean)
        .build();
    let a2 = atom()
        .id("aaaa0002")
        .reversibility(ReversibilityLevel::MigrationNeeded)
        .build();

    let result = merge(&[a1, a2], &no_options());
    assert!(result.contains("Reversibility: migration-needed"));
}

// ---- reference trailer merging -----------------------------------------------------

#[test]
fn should_drop_internal_references_lore_ids_within_merged_set() {
    let a1 = atom()
        .id("aaaa0001")
        .related(&["aaaa0002"]) // internal reference
        .build();
    let a2 = atom()
        .id("aaaa0002")
        .depends_on(&["aaaa0001"]) // internal reference
        .build();

    let result = merge(&[a1, a2], &no_options());
    assert!(!result.contains("Related: aaaa0002"));
    assert!(!result.contains("Depends-on: aaaa0001"));
}

#[test]
fn should_keep_external_references() {
    let a1 = atom()
        .id("aaaa0001")
        .related(&["external1"])
        .supersedes(&["external2"])
        .build();

    let result = merge(&[a1], &no_options());
    assert!(result.contains("Related: external1"));
    assert!(result.contains("Supersedes: external2"));
}

#[test]
fn should_deduplicate_external_references_across_atoms() {
    let a1 = atom().id("aaaa0001").related(&["external1"]).build();
    let a2 = atom()
        .id("aaaa0002")
        .related(&["external1", "external2"])
        .build();

    let result = merge(&[a1, a2], &no_options());
    assert_eq!(count(&result, "Related: external1"), 1);
    assert!(result.contains("Related: external2"));
}

// ---- single atom merge ---------------------------------------------------------------

#[test]
fn should_work_with_a_single_atom() {
    let a = atom()
        .intent("single atom intent")
        .constraint(&["Some constraint"])
        .confidence(ConfidenceLevel::High)
        .build();

    let result = merge(&[a], &no_options());

    assert!(result.contains("single atom intent"));
    assert!(result.contains("Lore-id: deadbeef")); // new generated id
    assert!(result.contains("Constraint: Some constraint"));
    assert!(result.contains("Confidence: high"));
}

// ---- message structure -----------------------------------------------------------------

#[test]
fn should_have_proper_structure_intent_blank_body_blank_trailers() {
    let a = atom()
        .id("aaaa0001")
        .body("Atom body text")
        .confidence(ConfidenceLevel::High)
        .build();

    let result = merge(
        &[a],
        &SquashOptions {
            intent: Some("Merged intent".to_owned()),
            ..no_options()
        },
    );
    let lines: Vec<&str> = result.split('\n').collect();

    assert_eq!(lines[0], "Merged intent");
    assert_eq!(lines[1], "");
    assert_eq!(lines[2], "Atom body text");
    assert_eq!(lines[3], "");
    assert!(lines[4].contains("Lore-id: deadbeef"));
}

#[test]
fn trailer_lines_follow_protocol_order() {
    let a = atom()
        .id("aaaa0001")
        .constraint(&["c"])
        .rejected(&["r"])
        .confidence(ConfidenceLevel::High)
        .scope_risk(ScopeRiskLevel::Narrow)
        .reversibility(ReversibilityLevel::Clean)
        .directive(&["d"])
        .tested(&["t"])
        .not_tested(&["n"])
        .supersedes(&["11112222"])
        .depends_on(&["33334444"])
        .related(&["55556666"])
        .build();

    let result = merge(&[a], &no_options());
    let trailer_block = result
        .split("\n\n")
        .last()
        .unwrap_or_else(|| panic!("no trailer block"));
    let keys: Vec<&str> = trailer_block
        .lines()
        .map(|l| l.split(':').next().unwrap_or(""))
        .collect();

    assert_eq!(
        keys,
        vec![
            "Lore-id",
            "Constraint",
            "Rejected",
            "Confidence",
            "Scope-risk",
            "Reversibility",
            "Directive",
            "Tested",
            "Not-tested",
            "Supersedes",
            "Depends-on",
            "Related",
        ]
    );
}
