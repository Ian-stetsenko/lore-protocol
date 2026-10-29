use super::*;

fn read(json: &str) -> CommitInput {
    JsonInputReader::new(json.to_owned())
        .read()
        .expect("valid JSON input")
}

fn strings(values: &[&str]) -> Option<Vec<String>> {
    Some(values.iter().map(|s| s.to_string()).collect())
}

// ---- valid JSON --------------------------------------------------------

#[test]
fn should_parse_a_complete_json_input_with_all_trailers() {
    let result = read(
        r#"{
          "intent": "fix bug in parser",
          "body": "Detailed explanation",
          "trailers": {
            "Constraint": ["must preserve backward compat"],
            "Rejected": ["approach A | too complex"],
            "Confidence": "medium",
            "Scope-risk": "narrow",
            "Reversibility": "clean",
            "Directive": ["use new API"],
            "Tested": ["unit tests pass"],
            "Not-tested": ["load testing"],
            "Supersedes": ["abcd1234"],
            "Depends-on": ["dead0000"],
            "Related": ["beef1234"]
          }
        }"#,
    );

    assert_eq!(result.intent, "fix bug in parser");
    assert_eq!(result.body.as_deref(), Some("Detailed explanation"));
    let t = result.trailers.expect("trailers");
    assert_eq!(t.constraint, strings(&["must preserve backward compat"]));
    assert_eq!(t.rejected, strings(&["approach A | too complex"]));
    assert_eq!(t.confidence.as_deref(), Some("medium"));
    assert_eq!(t.scope_risk.as_deref(), Some("narrow"));
    assert_eq!(t.reversibility.as_deref(), Some("clean"));
    assert_eq!(t.directive, strings(&["use new API"]));
    assert_eq!(t.tested, strings(&["unit tests pass"]));
    assert_eq!(t.not_tested, strings(&["load testing"]));
    assert_eq!(t.supersedes, strings(&["abcd1234"]));
    assert_eq!(t.depends_on, strings(&["dead0000"]));
    assert_eq!(t.related, strings(&["beef1234"]));
    assert!(t.custom.is_none());
}

#[test]
fn should_parse_minimal_json_with_only_intent() {
    let result = read(r#"{"intent": "minimal commit"}"#);
    assert_eq!(result.intent, "minimal commit");
    assert!(result.body.is_none());
    assert!(result.trailers.is_none());
}

#[test]
fn should_parse_json_with_intent_and_body_but_no_trailers() {
    let result = read(r#"{"intent": "with body", "body": "Some body text"}"#);
    assert_eq!(result.intent, "with body");
    assert_eq!(result.body.as_deref(), Some("Some body text"));
    assert!(result.trailers.is_none());
}

#[test]
fn should_parse_json_with_empty_trailers_object() {
    let result = read(r#"{"intent": "with empty trailers", "trailers": {}}"#);
    assert_eq!(result.intent, "with empty trailers");
    let t = result.trailers.expect("trailers defined");
    assert!(t.constraint.is_none());
    assert!(t.confidence.is_none());
    assert_eq!(t, CommitInputTrailers::default());
}

#[test]
fn should_default_intent_to_empty_string_when_not_a_string() {
    assert_eq!(read(r#"{"intent": 123}"#).intent, "");
}

#[test]
fn should_ignore_body_when_not_a_string() {
    assert!(read(r#"{"intent": "test", "body": 42}"#).body.is_none());
}

// ---- array parsing -----------------------------------------------------

#[test]
fn should_filter_non_string_values_from_arrays() {
    let result = read(
        r#"{"intent": "test", "trailers": {"Constraint": ["valid", 123, "also valid", null, true]}}"#,
    );
    assert_eq!(
        result.trailers.expect("trailers").constraint,
        strings(&["valid", "also valid"])
    );
}

#[test]
fn should_coerce_a_single_string_trailer_value_to_an_array() {
    let result = read(
        r#"{"intent": "test", "trailers": {"Constraint": "single constraint", "Directive": "[until:2026-06] Remove before release"}}"#,
    );
    let t = result.trailers.expect("trailers");
    assert_eq!(t.constraint, strings(&["single constraint"]));
    assert_eq!(
        t.directive,
        strings(&["[until:2026-06] Remove before release"])
    );
}

#[test]
fn should_return_none_for_non_string_non_array_trailer_values() {
    let result = read(r#"{"intent": "test", "trailers": {"Constraint": 42}}"#);
    assert!(result.trailers.expect("trailers").constraint.is_none());
}

// ---- custom trailers ---------------------------------------------------

#[test]
fn should_collect_unknown_trailer_keys_as_custom_trailers() {
    let result = read(
        r#"{"intent": "test", "trailers": {"Assisted-by": "Gemini:CLI", "Confidence": "high"}}"#,
    );
    let t = result.trailers.expect("trailers");
    let custom = t.custom.as_ref().expect("custom");
    assert_eq!(
        custom.get("Assisted-by"),
        Some(&["Gemini:CLI".to_owned()][..])
    );
    assert_eq!(custom.len(), 1);
    assert_eq!(t.confidence.as_deref(), Some("high"));
}

#[test]
fn should_collect_multiple_custom_trailers() {
    let result = read(
        r#"{"intent": "test", "trailers": {"Assisted-by": "Gemini:CLI", "Ticket": ["PROJ-123", "PROJ-456"], "Constraint": ["some constraint"]}}"#,
    );
    let t = result.trailers.expect("trailers");
    let custom = t.custom.as_ref().expect("custom");
    assert_eq!(
        custom.get("Assisted-by"),
        Some(&["Gemini:CLI".to_owned()][..])
    );
    assert_eq!(
        custom.get("Ticket"),
        Some(&["PROJ-123".to_owned(), "PROJ-456".to_owned()][..])
    );
    assert_eq!(t.constraint, strings(&["some constraint"]));
}

#[test]
fn should_not_include_custom_field_when_no_unknown_trailers_exist() {
    let result = read(r#"{"intent": "test", "trailers": {"Confidence": "high"}}"#);
    assert!(result.trailers.expect("trailers").custom.is_none());
}

#[test]
fn should_skip_custom_trailers_with_non_string_values() {
    let result =
        read(r#"{"intent": "test", "trailers": {"Valid-custom": "value", "Invalid-custom": 42}}"#);
    let t = result.trailers.expect("trailers");
    let custom = t.custom.as_ref().expect("custom");
    assert_eq!(custom.get("Valid-custom"), Some(&["value".to_owned()][..]));
    assert_eq!(custom.get("Invalid-custom"), None);
}

// ---- enum parsing ------------------------------------------------------

#[test]
fn should_return_string_values_for_enum_trailers() {
    let result = read(
        r#"{"intent": "test", "trailers": {"Confidence": "high", "Scope-risk": "wide", "Reversibility": "irreversible"}}"#,
    );
    let t = result.trailers.expect("trailers");
    assert_eq!(t.confidence.as_deref(), Some("high"));
    assert_eq!(t.scope_risk.as_deref(), Some("wide"));
    assert_eq!(t.reversibility.as_deref(), Some("irreversible"));
}

#[test]
fn should_return_none_for_non_string_enum_values() {
    let result = read(
        r#"{"intent": "test", "trailers": {"Confidence": 42, "Scope-risk": true, "Reversibility": null}}"#,
    );
    let t = result.trailers.expect("trailers");
    assert!(t.confidence.is_none());
    assert!(t.scope_risk.is_none());
    assert!(t.reversibility.is_none());
}

#[test]
fn invalid_enum_strings_are_passed_through_for_validation() {
    let result = read(r#"{"intent": "test", "trailers": {"Confidence": "very-high"}}"#);
    assert_eq!(
        result.trailers.expect("trailers").confidence.as_deref(),
        Some("very-high")
    );
}

// ---- invalid JSON ------------------------------------------------------

#[test]
fn should_error_on_malformed_json() {
    let err = JsonInputReader::new("not valid json {{{".to_owned())
        .read()
        .expect_err("malformed JSON must fail");
    assert!(matches!(err, crate::util::LoreError::Json(_)));
    assert_eq!(err.exit_code(), 1);
}

#[test]
fn should_error_on_empty_string() {
    assert!(JsonInputReader::new(String::new()).read().is_err());
}

#[test]
fn trailers_that_are_not_an_object_are_ignored() {
    let result = read(r#"{"intent": "test", "trailers": ["Constraint"]}"#);
    assert!(result.trailers.is_none());
}
