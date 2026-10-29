//! Port of `tests/unit/types/custom-trailer-collection.test.ts`.

use indexmap::IndexMap;
use serde_json::{json, Map, Value};

use super::CustomTrailerCollection;

fn entries(pairs: &[(&str, &[&str])]) -> IndexMap<String, Vec<String>> {
    pairs
        .iter()
        .map(|(k, vs)| (k.to_string(), vs.iter().map(|v| v.to_string()).collect()))
        .collect()
}

fn collection(pairs: &[(&str, &[&str])]) -> CustomTrailerCollection {
    CustomTrailerCollection::new(entries(pairs))
}

fn strs(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| v.to_string()).collect()
}

fn raw(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        other => panic!("expected JSON object, got {other}"),
    }
}

fn iterated(c: &CustomTrailerCollection) -> Vec<(String, Vec<String>)> {
    c.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
}

// ---- constructor and iteration --------------------------------------------

#[test]
fn should_store_entries_and_iterate_over_them() {
    let c = collection(&[
        ("Team", &["platform"]),
        ("Ticket", &["PROJ-123", "PROJ-456"]),
    ]);

    let mut result: Vec<(String, Vec<String>)> = Vec::new();
    for (k, v) in &c {
        result.push((k.clone(), v.clone()));
    }

    assert_eq!(
        result,
        vec![
            ("Team".to_owned(), strs(&["platform"])),
            ("Ticket".to_owned(), strs(&["PROJ-123", "PROJ-456"])),
        ]
    );
}

#[test]
fn should_not_be_affected_by_mutations_to_the_original_map() {
    let mut map = entries(&[("Team", &["platform"])]);
    let c = CustomTrailerCollection::new(map.clone());

    map.insert("Team".to_owned(), strs(&["changed"]));
    map.insert("New".to_owned(), strs(&["value"]));

    assert_eq!(c.get("Team"), Some(&strs(&["platform"])[..]));
    assert!(!c.has("New"));
}

// ---- empty ------------------------------------------------------------------

#[test]
fn empty_should_return_an_empty_collection() {
    let c = CustomTrailerCollection::empty();

    assert!(c.is_empty());
    assert_eq!(c.len(), 0);
    assert_eq!(c.line_count(), 0);
}

#[test]
fn empty_should_return_the_same_instance_on_repeated_calls() {
    // Rust has no shared singleton here; value equality is the equivalent
    // observable guarantee.
    let a = CustomTrailerCollection::empty();
    let b = CustomTrailerCollection::empty();

    assert_eq!(a, b);
}

// ---- from_raw ---------------------------------------------------------------

#[test]
fn from_raw_should_extract_unknown_keys_as_custom_trailers() {
    let r = raw(json!({
        "Confidence": "high",
        "Scope-risk": "narrow",
        "Assisted-by": ["Gemini:CLI"],
        "Ticket": ["PROJ-123"],
    }));

    let c = CustomTrailerCollection::from_raw(&r);

    assert_eq!(c.get("Assisted-by"), Some(&strs(&["Gemini:CLI"])[..]));
    assert_eq!(c.get("Ticket"), Some(&strs(&["PROJ-123"])[..]));
    assert!(!c.has("Confidence"));
    assert!(!c.has("Scope-risk"));
}

#[test]
fn from_raw_should_filter_out_all_known_lore_trailer_keys() {
    let r = raw(json!({
        "Lore-id": "abcd1234",
        "Constraint": ["a constraint"],
        "Rejected": ["alt A"],
        "Confidence": "high",
        "Scope-risk": "narrow",
        "Reversibility": "clean",
        "Directive": ["directive"],
        "Tested": ["tested"],
        "Not-tested": ["not tested"],
        "Supersedes": ["11223344"],
        "Depends-on": ["55667788"],
        "Related": ["aabbccdd"],
        "My-custom": ["custom value"],
    }));

    let c = CustomTrailerCollection::from_raw(&r);

    assert_eq!(c.len(), 1);
    assert_eq!(c.get("My-custom"), Some(&strs(&["custom value"])[..]));
}

#[test]
fn from_raw_should_coerce_a_single_string_to_a_string_array() {
    let r = raw(json!({ "Assisted-by": "Claude:CLI" }));

    let c = CustomTrailerCollection::from_raw(&r);

    assert_eq!(c.get("Assisted-by"), Some(&strs(&["Claude:CLI"])[..]));
}

#[test]
fn from_raw_should_skip_non_string_and_non_array_values() {
    let r = raw(json!({
        "Valid-custom": "value",
        "Number-custom": 42,
        "Bool-custom": true,
        "Null-custom": null,
        "Object-custom": { "nested": "value" },
    }));

    let c = CustomTrailerCollection::from_raw(&r);

    assert_eq!(c.len(), 1);
    assert_eq!(c.get("Valid-custom"), Some(&strs(&["value"])[..]));
}

#[test]
fn from_raw_should_filter_non_string_values_from_arrays() {
    let r = raw(json!({ "Mixed-array": ["valid", 42, "also valid", null, true] }));

    let c = CustomTrailerCollection::from_raw(&r);

    assert_eq!(
        c.get("Mixed-array"),
        Some(&strs(&["valid", "also valid"])[..])
    );
}

#[test]
fn from_raw_should_skip_empty_arrays() {
    let r = raw(json!({ "Empty-array": [] }));

    let c = CustomTrailerCollection::from_raw(&r);

    assert!(c.is_empty());
}

#[test]
fn from_raw_should_return_empty_singleton_when_no_custom_keys_exist() {
    let r = raw(json!({ "Confidence": "high" }));

    let c = CustomTrailerCollection::from_raw(&r);

    assert_eq!(c, CustomTrailerCollection::empty());
}

#[test]
fn from_raw_should_return_empty_singleton_for_empty_input() {
    let c = CustomTrailerCollection::from_raw(&Map::new());

    assert_eq!(c, CustomTrailerCollection::empty());
}

// ---- has --------------------------------------------------------------------

#[test]
fn has_should_return_true_for_an_existing_key_with_values() {
    let c = collection(&[("Team", &["platform"])]);

    assert!(c.has("Team"));
}

#[test]
fn has_should_return_false_for_a_non_existent_key() {
    let c = collection(&[("Team", &["platform"])]);

    assert!(!c.has("Missing"));
}

#[test]
fn has_should_return_false_for_a_key_with_an_empty_array() {
    let c = collection(&[("Team", &[])]);

    assert!(!c.has("Team"));
}

// ---- get --------------------------------------------------------------------

#[test]
fn get_should_return_the_values_for_an_existing_key() {
    let c = collection(&[("Team", &["platform", "infra"])]);

    assert_eq!(c.get("Team"), Some(&strs(&["platform", "infra"])[..]));
}

#[test]
fn get_should_return_undefined_for_a_non_existent_key() {
    let c = CustomTrailerCollection::empty();

    assert_eq!(c.get("Missing"), None);
}

// ---- line_count -------------------------------------------------------------

#[test]
fn line_count_should_return_0_for_empty_collection() {
    assert_eq!(CustomTrailerCollection::empty().line_count(), 0);
}

#[test]
fn line_count_should_count_total_values_across_all_keys() {
    let c = collection(&[
        ("Team", &["platform"]),
        ("Ticket", &["PROJ-123", "PROJ-456"]),
        ("Reviewer", &["alice", "bob", "carol"]),
    ]);

    assert_eq!(c.line_count(), 6);
}

#[test]
fn line_count_should_count_single_values_correctly() {
    let c = collection(&[("Team", &["platform"])]);

    assert_eq!(c.line_count(), 1);
}

// ---- size (len) -------------------------------------------------------------

#[test]
fn size_should_return_0_for_empty_collection() {
    assert_eq!(CustomTrailerCollection::empty().len(), 0);
}

#[test]
fn size_should_return_the_number_of_distinct_keys() {
    let c = collection(&[
        ("Team", &["platform"]),
        ("Ticket", &["PROJ-123", "PROJ-456"]),
    ]);

    assert_eq!(c.len(), 2);
}

// ---- is_empty ---------------------------------------------------------------

#[test]
fn is_empty_should_return_true_for_empty_collection() {
    assert!(CustomTrailerCollection::empty().is_empty());
}

#[test]
fn is_empty_should_return_false_for_non_empty_collection() {
    let c = collection(&[("Team", &["platform"])]);

    assert!(!c.is_empty());
}

// ---- to_record --------------------------------------------------------------

#[test]
fn to_record_should_convert_to_a_plain_object() {
    let c = collection(&[
        ("Team", &["platform"]),
        ("Ticket", &["PROJ-123", "PROJ-456"]),
    ]);

    assert_eq!(
        c.to_record(),
        &entries(&[
            ("Team", &["platform"]),
            ("Ticket", &["PROJ-123", "PROJ-456"])
        ])
    );
}

#[test]
fn to_record_should_return_empty_object_for_empty_collection() {
    assert_eq!(
        CustomTrailerCollection::empty().to_record(),
        &IndexMap::<String, Vec<String>>::new()
    );
}

#[test]
fn to_record_should_round_trip_through_from_raw_and_to_record() {
    let r = raw(json!({
        "Assisted-by": ["Claude:CLI"],
        "Ticket": ["PROJ-123", "PROJ-456"],
    }));

    let c = CustomTrailerCollection::from_raw(&r);
    let record = c.to_record();

    assert_eq!(
        record,
        &entries(&[
            ("Assisted-by", &["Claude:CLI"]),
            ("Ticket", &["PROJ-123", "PROJ-456"]),
        ])
    );
}

// ---- Symbol.iterator (IntoIterator / iter) ----------------------------------

#[test]
fn iterator_should_support_spread_into_array() {
    let c = collection(&[("Team", &["platform"]), ("Ticket", &["PROJ-123"])]);

    let entries = iterated(&c);

    assert_eq!(
        entries,
        vec![
            ("Team".to_owned(), strs(&["platform"])),
            ("Ticket".to_owned(), strs(&["PROJ-123"])),
        ]
    );
}

#[test]
fn iterator_should_produce_no_entries_for_empty_collection() {
    let entries = iterated(&CustomTrailerCollection::empty());

    assert!(entries.is_empty());
}

#[test]
fn iterator_should_work_with_for_of_loops() {
    let c = collection(&[("Key", &["value"])]);

    let mut keys: Vec<String> = Vec::new();
    for (key, _) in &c {
        keys.push(key.clone());
    }

    assert_eq!(keys, strs(&["Key"]));
}

#[test]
fn from_iterator_builds_the_same_collection_as_new() {
    let built: CustomTrailerCollection = vec![("Team".to_owned(), strs(&["platform"]))]
        .into_iter()
        .collect();

    assert_eq!(built, collection(&[("Team", &["platform"])]));
}
