//! Port of `tests/unit/services/trailer-parser.test.ts`.

use indexmap::IndexMap;

use super::TrailerParser;
use crate::types::custom_trailer_collection::CustomTrailerCollection;
use crate::types::domain::{ConfidenceLevel, LoreTrailers, ReversibilityLevel, ScopeRiskLevel};

fn parser() -> TrailerParser {
    TrailerParser::new()
}

fn strs(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| v.to_string()).collect()
}

fn no_custom() -> Vec<String> {
    Vec::new()
}

/// Equivalent of the TS `makeTrailers` helper: defaults everywhere, with
/// field overrides applied by the caller via struct update syntax.
fn make_trailers() -> LoreTrailers {
    LoreTrailers::default()
}

// ---- parse ----------------------------------------------------------------

#[test]
fn parse_should_parse_a_lore_id_trailer() {
    let result = parser().parse("Lore-id: a1b2c3d4", &no_custom());
    assert_eq!(result.lore_id, "a1b2c3d4");
}

#[test]
fn parse_should_parse_array_trailers_into_arrays() {
    let raw = [
        "Lore-id: abcd1234",
        "Constraint: Must use UTF-8 encoding",
        "Constraint: Max 1000 records per batch",
    ]
    .join("\n");
    let result = parser().parse(&raw, &no_custom());
    assert_eq!(
        result.constraint,
        strs(&["Must use UTF-8 encoding", "Max 1000 records per batch"])
    );
}

#[test]
fn parse_should_parse_all_array_trailer_types() {
    let raw = [
        "Lore-id: abcd1234",
        "Constraint: constraint value",
        "Rejected: rejected value",
        "Directive: directive value",
        "Tested: tested value",
        "Not-tested: not-tested value",
        "Supersedes: 11112222",
        "Depends-on: 33334444",
        "Related: 55556666",
    ]
    .join("\n");
    let result = parser().parse(&raw, &no_custom());
    assert_eq!(result.constraint, strs(&["constraint value"]));
    assert_eq!(result.rejected, strs(&["rejected value"]));
    assert_eq!(result.directive, strs(&["directive value"]));
    assert_eq!(result.tested, strs(&["tested value"]));
    assert_eq!(result.not_tested, strs(&["not-tested value"]));
    assert_eq!(result.supersedes, strs(&["11112222"]));
    assert_eq!(result.depends_on, strs(&["33334444"]));
    assert_eq!(result.related, strs(&["55556666"]));
}

#[test]
fn parse_should_parse_enum_trailers() {
    let raw = [
        "Lore-id: abcd1234",
        "Confidence: high",
        "Scope-risk: narrow",
        "Reversibility: clean",
    ]
    .join("\n");
    let result = parser().parse(&raw, &no_custom());
    assert_eq!(result.confidence, Some(ConfidenceLevel::High));
    assert_eq!(result.scope_risk, Some(ScopeRiskLevel::Narrow));
    assert_eq!(result.reversibility, Some(ReversibilityLevel::Clean));
}

#[test]
fn parse_should_accept_all_valid_confidence_values() {
    for val in ["low", "medium", "high"] {
        let raw = format!("Lore-id: abcd1234\nConfidence: {val}");
        let result = parser().parse(&raw, &no_custom());
        assert_eq!(result.confidence.map(ConfidenceLevel::as_str), Some(val));
    }
}

#[test]
fn parse_should_accept_all_valid_scope_risk_values() {
    for val in ["narrow", "moderate", "wide"] {
        let raw = format!("Lore-id: abcd1234\nScope-risk: {val}");
        let result = parser().parse(&raw, &no_custom());
        assert_eq!(result.scope_risk.map(ScopeRiskLevel::as_str), Some(val));
    }
}

#[test]
fn parse_should_accept_all_valid_reversibility_values() {
    for val in ["clean", "migration-needed", "irreversible"] {
        let raw = format!("Lore-id: abcd1234\nReversibility: {val}");
        let result = parser().parse(&raw, &no_custom());
        assert_eq!(
            result.reversibility.map(ReversibilityLevel::as_str),
            Some(val)
        );
    }
}

#[test]
fn parse_should_ignore_invalid_enum_values() {
    let raw = [
        "Lore-id: abcd1234",
        "Confidence: INVALID",
        "Scope-risk: bogus",
        "Reversibility: nope",
    ]
    .join("\n");
    let result = parser().parse(&raw, &no_custom());
    assert_eq!(result.confidence, None);
    assert_eq!(result.scope_risk, None);
    assert_eq!(result.reversibility, None);
}

#[test]
fn parse_should_return_null_for_missing_enum_trailers() {
    let result = parser().parse("Lore-id: abcd1234", &no_custom());
    assert_eq!(result.confidence, None);
    assert_eq!(result.scope_risk, None);
    assert_eq!(result.reversibility, None);
}

#[test]
fn parse_should_return_empty_arrays_for_missing_array_trailers() {
    let result = parser().parse("Lore-id: abcd1234", &no_custom());
    assert!(result.constraint.is_empty());
    assert!(result.rejected.is_empty());
    assert!(result.directive.is_empty());
    assert!(result.tested.is_empty());
    assert!(result.not_tested.is_empty());
    assert!(result.supersedes.is_empty());
    assert!(result.depends_on.is_empty());
    assert!(result.related.is_empty());
}

#[test]
fn parse_should_handle_continuation_lines() {
    let raw = [
        "Lore-id: abcd1234",
        "Constraint: This is a long constraint that",
        "  continues on the next line",
    ]
    .join("\n");
    let result = parser().parse(&raw, &no_custom());
    assert_eq!(
        result.constraint,
        strs(&["This is a long constraint that continues on the next line"])
    );
}

#[test]
fn parse_should_handle_continuation_lines_with_tabs() {
    let raw = [
        "Lore-id: abcd1234",
        "Constraint: First part",
        "\tsecond part",
    ]
    .join("\n");
    let result = parser().parse(&raw, &no_custom());
    assert_eq!(result.constraint, strs(&["First part second part"]));
}

#[test]
fn parse_should_handle_multiple_continuation_lines() {
    let raw = [
        "Lore-id: abcd1234",
        "Constraint: Line 1",
        "  Line 2",
        "  Line 3",
    ]
    .join("\n");
    let result = parser().parse(&raw, &no_custom());
    assert_eq!(result.constraint, strs(&["Line 1 Line 2 Line 3"]));
}

#[test]
fn parse_should_parse_custom_trailers_when_custom_keys_is_provided() {
    let raw = [
        "Lore-id: abcd1234",
        "My-custom: value1",
        "My-custom: value2",
    ]
    .join("\n");
    let result = parser().parse(&raw, &strs(&["My-custom"]));
    assert_eq!(
        result.custom.get("My-custom"),
        Some(&strs(&["value1", "value2"])[..])
    );
}

#[test]
fn parse_should_not_parse_custom_trailers_when_they_are_not_in_custom_keys() {
    let raw = ["Lore-id: abcd1234", "Unknown-key: value1"].join("\n");
    let result = parser().parse(&raw, &strs(&["Other-key"]));
    assert!(!result.custom.has("Unknown-key"));
}

#[test]
fn parse_should_accept_any_non_lore_trailer_when_custom_keys_is_empty() {
    let raw = ["Lore-id: abcd1234", "Whatever: value1"].join("\n");
    let result = parser().parse(&raw, &no_custom());
    assert_eq!(result.custom.get("Whatever"), Some(&strs(&["value1"])[..]));
}

#[test]
fn parse_should_handle_empty_input() {
    let result = parser().parse("", &no_custom());
    assert_eq!(result.lore_id, "");
    assert!(result.constraint.is_empty());
    assert_eq!(result.custom.len(), 0);
}

#[test]
fn parse_should_handle_whitespace_only_input() {
    let result = parser().parse("   \n  \n  ", &no_custom());
    assert_eq!(result.lore_id, "");
}

#[test]
fn parse_should_trim_trailer_values() {
    let result = parser().parse("Lore-id:   abcd1234   ", &no_custom());
    assert_eq!(result.lore_id, "abcd1234");
}

#[test]
fn parse_should_handle_unicode_in_trailer_values() {
    let raw = [
        "Lore-id: abcd1234",
        "Constraint: Must support emoji \u{1F680} and CJK \u{4E16}\u{754C}",
    ]
    .join("\n");
    let result = parser().parse(&raw, &no_custom());
    assert_eq!(
        result.constraint,
        strs(&["Must support emoji \u{1F680} and CJK \u{4E16}\u{754C}"])
    );
}

#[test]
fn parse_should_handle_trailers_with_colons_in_the_value() {
    let raw = ["Lore-id: abcd1234", "Constraint: Time format: HH:MM:SS"].join("\n");
    let result = parser().parse(&raw, &no_custom());
    assert_eq!(result.constraint, strs(&["Time format: HH:MM:SS"]));
}

#[test]
fn parse_should_skip_blank_lines_between_trailers() {
    let raw = ["Lore-id: abcd1234", "", "Constraint: value"].join("\n");
    let result = parser().parse(&raw, &no_custom());
    assert_eq!(result.lore_id, "abcd1234");
    assert_eq!(result.constraint, strs(&["value"]));
}

#[test]
fn parse_should_handle_a_full_realistic_trailer_block() {
    let raw = [
        "Lore-id: a7f3b2c1",
        "Constraint: PostgreSQL >= 14 required for JSONB subscript syntax",
        "Constraint: All timestamps must be stored as UTC",
        "Rejected: MongoDB -- lacks transactional guarantees across collections",
        "Confidence: high",
        "Scope-risk: moderate",
        "Reversibility: migration-needed",
        "Directive: [until:2025-06] Review when PostgreSQL 17 releases",
        "Tested: Integration test: test_db_connection_pool",
        "Supersedes: b3e4f5a6",
        "Depends-on: c1d2e3f4",
        "Related: d4e5f6a7",
    ]
    .join("\n");
    let result = parser().parse(&raw, &no_custom());
    assert_eq!(result.lore_id, "a7f3b2c1");
    assert_eq!(result.constraint.len(), 2);
    assert_eq!(result.rejected.len(), 1);
    assert_eq!(result.confidence, Some(ConfidenceLevel::High));
    assert_eq!(result.scope_risk, Some(ScopeRiskLevel::Moderate));
    assert_eq!(
        result.reversibility,
        Some(ReversibilityLevel::MigrationNeeded)
    );
    assert_eq!(result.directive.len(), 1);
    assert_eq!(result.tested.len(), 1);
    assert_eq!(result.supersedes, strs(&["b3e4f5a6"]));
    assert_eq!(result.depends_on, strs(&["c1d2e3f4"]));
    assert_eq!(result.related, strs(&["d4e5f6a7"]));
}

// ---- serialize ------------------------------------------------------------

#[test]
fn serialize_should_serialize_lore_id() {
    let trailers = LoreTrailers {
        lore_id: "abcd1234".to_owned(),
        ..make_trailers()
    };
    let result = parser().serialize(&trailers);
    assert!(result.contains("Lore-id: abcd1234"));
}

#[test]
fn serialize_should_serialize_array_trailers() {
    let trailers = LoreTrailers {
        constraint: strs(&["First constraint", "Second constraint"]),
        ..make_trailers()
    };
    let result = parser().serialize(&trailers);
    assert!(result.contains("Constraint: First constraint"));
    assert!(result.contains("Constraint: Second constraint"));
}

#[test]
fn serialize_should_serialize_enum_trailers() {
    let trailers = LoreTrailers {
        confidence: Some(ConfidenceLevel::High),
        scope_risk: Some(ScopeRiskLevel::Wide),
        reversibility: Some(ReversibilityLevel::Irreversible),
        ..make_trailers()
    };
    let result = parser().serialize(&trailers);
    assert!(result.contains("Confidence: high"));
    assert!(result.contains("Scope-risk: wide"));
    assert!(result.contains("Reversibility: irreversible"));
}

#[test]
fn serialize_should_not_serialize_null_enum_trailers() {
    let trailers = LoreTrailers {
        confidence: None,
        ..make_trailers()
    };
    let result = parser().serialize(&trailers);
    assert!(!result.contains("Confidence:"));
}

#[test]
fn serialize_should_not_serialize_empty_array_trailers() {
    let result = parser().serialize(&make_trailers());
    assert!(!result.contains("Constraint:"));
    assert!(!result.contains("Rejected:"));
}

#[test]
fn serialize_should_serialize_custom_trailers() {
    let mut custom_map: IndexMap<String, Vec<String>> = IndexMap::new();
    custom_map.insert("Team".to_owned(), strs(&["platform"]));
    custom_map.insert("Ticket".to_owned(), strs(&["PROJ-123", "PROJ-456"]));
    let trailers = LoreTrailers {
        custom: CustomTrailerCollection::new(custom_map),
        ..make_trailers()
    };
    let result = parser().serialize(&trailers);
    assert!(result.contains("Team: platform"));
    assert!(result.contains("Ticket: PROJ-123"));
    assert!(result.contains("Ticket: PROJ-456"));
}

#[test]
fn serialize_should_not_serialize_empty_lore_id() {
    let trailers = LoreTrailers {
        lore_id: String::new(),
        ..make_trailers()
    };
    let result = parser().serialize(&trailers);
    assert!(!result.contains("Lore-id:"));
}

#[test]
fn serialize_should_output_lore_id_first() {
    let trailers = LoreTrailers {
        lore_id: "abcd1234".to_owned(),
        constraint: strs(&["a constraint"]),
        ..make_trailers()
    };
    let result = parser().serialize(&trailers);
    let lines: Vec<&str> = result.split('\n').collect();
    assert_eq!(lines[0], "Lore-id: abcd1234");
}

#[test]
fn serialize_should_produce_one_line_per_array_entry() {
    let trailers = LoreTrailers {
        lore_id: "abcd1234".to_owned(),
        rejected: strs(&["Option A", "Option B", "Option C"]),
        ..make_trailers()
    };
    let result = parser().serialize(&trailers);
    let rejected_lines: Vec<&str> = result
        .split('\n')
        .filter(|l| l.starts_with("Rejected:"))
        .collect();
    assert_eq!(rejected_lines.len(), 3);
}

// ---- parse/serialize roundtrip --------------------------------------------

#[test]
fn roundtrip_should_roundtrip_a_full_trailer_block() {
    let original = [
        "Lore-id: a7f3b2c1",
        "Constraint: PostgreSQL >= 14 required",
        "Constraint: All timestamps UTC",
        "Rejected: MongoDB -- no transactions",
        "Directive: Review in Q3",
        "Tested: integration test suite",
        "Not-tested: performance under load",
        "Supersedes: b3e4f5a6",
        "Depends-on: c1d2e3f4",
        "Related: d4e5f6a7",
        "Confidence: high",
        "Scope-risk: moderate",
        "Reversibility: clean",
    ]
    .join("\n");

    let p = parser();
    let parsed = p.parse(&original, &no_custom());
    let serialized = p.serialize(&parsed);

    let reparsed = p.parse(&serialized, &no_custom());

    assert_eq!(reparsed.lore_id, parsed.lore_id);
    assert_eq!(reparsed.constraint, parsed.constraint);
    assert_eq!(reparsed.rejected, parsed.rejected);
    assert_eq!(reparsed.confidence, parsed.confidence);
    assert_eq!(reparsed.scope_risk, parsed.scope_risk);
    assert_eq!(reparsed.reversibility, parsed.reversibility);
    assert_eq!(reparsed.directive, parsed.directive);
    assert_eq!(reparsed.tested, parsed.tested);
    assert_eq!(reparsed.not_tested, parsed.not_tested);
    assert_eq!(reparsed.supersedes, parsed.supersedes);
    assert_eq!(reparsed.depends_on, parsed.depends_on);
    assert_eq!(reparsed.related, parsed.related);
}

#[test]
fn roundtrip_should_roundtrip_with_custom_trailers() {
    let original = ["Lore-id: abcd1234", "My-trailer: custom value"].join("\n");

    let p = parser();
    let parsed = p.parse(&original, &no_custom());
    let serialized = p.serialize(&parsed);
    let reparsed = p.parse(&serialized, &no_custom());

    assert_eq!(
        reparsed.custom.get("My-trailer"),
        Some(&strs(&["custom value"])[..])
    );
}

// ---- contains_lore_trailers -----------------------------------------------

#[test]
fn contains_should_return_true_when_text_contains_lore_id() {
    assert!(parser().contains_lore_trailers("Lore-id: abcd1234"));
}

#[test]
fn contains_should_return_true_when_text_contains_a_constraint_trailer() {
    assert!(parser().contains_lore_trailers("Constraint: Must be fast"));
}

#[test]
fn contains_should_return_true_when_text_contains_a_confidence_trailer() {
    assert!(parser().contains_lore_trailers("Confidence: high"));
}

#[test]
fn contains_should_return_false_for_plain_text() {
    assert!(!parser().contains_lore_trailers("This is just regular text"));
}

#[test]
fn contains_should_return_false_for_empty_text() {
    assert!(!parser().contains_lore_trailers(""));
}

#[test]
fn contains_should_return_false_for_non_lore_trailers() {
    assert!(!parser().contains_lore_trailers("Signed-off-by: Someone"));
}

#[test]
fn contains_should_return_true_when_lore_trailers_are_mixed_with_non_lore() {
    let text = ["Signed-off-by: Someone", "Lore-id: abcd1234"].join("\n");
    assert!(parser().contains_lore_trailers(&text));
}

#[test]
fn contains_should_detect_trailers_in_a_full_commit_message() {
    let text = [
        "feat(db): add connection pooling",
        "",
        "Added PgBouncer-based connection pooling.",
        "",
        "Lore-id: a1b2c3d4",
        "Confidence: high",
    ]
    .join("\n");
    assert!(parser().contains_lore_trailers(&text));
}

// ---- extract_trailer_block ------------------------------------------------

#[test]
fn extract_should_extract_the_trailer_block_from_a_full_commit_message() {
    let message = [
        "feat(db): add connection pooling",
        "",
        "Added PgBouncer-based connection pooling.",
        "",
        "Lore-id: a1b2c3d4",
        "Constraint: PostgreSQL >= 14",
    ]
    .join("\n");
    let result = parser().extract_trailer_block(&message);
    assert_eq!(result, "Lore-id: a1b2c3d4\nConstraint: PostgreSQL >= 14");
}

#[test]
fn extract_should_return_empty_string_when_there_are_no_trailers() {
    let message = [
        "feat(db): add connection pooling",
        "",
        "Added PgBouncer-based connection pooling.",
    ]
    .join("\n");
    assert_eq!(parser().extract_trailer_block(&message), "");
}

#[test]
fn extract_should_return_empty_string_for_empty_input() {
    assert_eq!(parser().extract_trailer_block(""), "");
}

#[test]
fn extract_should_handle_message_with_only_trailers_no_body() {
    let message = [
        "feat(db): add connection pooling",
        "",
        "Lore-id: a1b2c3d4",
        "Confidence: high",
    ]
    .join("\n");
    let result = parser().extract_trailer_block(&message);
    assert_eq!(result, "Lore-id: a1b2c3d4\nConfidence: high");
}

#[test]
fn extract_should_handle_trailing_whitespace() {
    let message = ["feat: something", "", "Lore-id: a1b2c3d4", "  "].join("\n");
    // After trim_end, the trailing whitespace paragraph disappears
    let result = parser().extract_trailer_block(&message);
    assert!(result.contains("Lore-id: a1b2c3d4"));
}

#[test]
fn extract_should_handle_multiple_blank_line_separators() {
    let message = [
        "feat: something",
        "",
        "",
        "Body text here.",
        "",
        "",
        "Lore-id: a1b2c3d4",
    ]
    .join("\n");
    let result = parser().extract_trailer_block(&message);
    assert_eq!(result, "Lore-id: a1b2c3d4");
}

#[test]
fn extract_should_return_empty_if_last_paragraph_is_not_all_trailers() {
    let message = [
        "feat: something",
        "",
        "This is a regular paragraph, not trailers.",
        "Just some body text.",
    ]
    .join("\n");
    assert_eq!(parser().extract_trailer_block(&message), "");
}

#[test]
fn extract_should_handle_trailer_block_with_continuation_lines() {
    let message = [
        "feat: something",
        "",
        "Lore-id: a1b2c3d4",
        "Constraint: A long constraint",
        "  that continues here",
    ]
    .join("\n");
    let result = parser().extract_trailer_block(&message);
    assert!(result.contains("Lore-id: a1b2c3d4"));
    assert!(result.contains("Constraint: A long constraint"));
    assert!(result.contains("  that continues here"));
}
