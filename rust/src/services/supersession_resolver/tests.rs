//! Port of `tests/unit/services/supersession-resolver.test.ts`.

use std::collections::HashMap;

use super::SupersessionResolver;
use crate::test_support::atom;
use crate::types::domain::{LoreAtom, SupersessionStatus};

/// Equivalent of the TS `makeAtom({ loreId, supersedes })` helper.
fn make_atom(lore_id: &str, supersedes: &[&str]) -> LoreAtom {
    atom()
        .id(lore_id)
        .hash(&format!("hash-{lore_id}"))
        .author("dev@example.com")
        .intent("test commit")
        .files(&[])
        .supersedes(supersedes)
        .build()
}

fn resolver() -> SupersessionResolver {
    SupersessionResolver::new()
}

fn status<'a>(map: &'a HashMap<String, SupersessionStatus>, id: &str) -> &'a SupersessionStatus {
    map.get(id)
        .unwrap_or_else(|| panic!("{id} missing from supersession map"))
}

// ---- resolve ----------------------------------------------------------------

#[test]
fn should_return_all_atoms_as_active_when_no_supersession_exists() {
    let atoms = [
        make_atom("aaaa1111", &[]),
        make_atom("bbbb2222", &[]),
        make_atom("cccc3333", &[]),
    ];

    let result = resolver().resolve(&atoms);

    assert_eq!(result.len(), 3);
    for s in result.values() {
        assert!(!s.superseded);
        assert_eq!(s.superseded_by, None);
    }
}

#[test]
fn should_mark_a_directly_superseded_atom() {
    let atoms = [
        make_atom("aaaa1111", &["bbbb2222"]),
        make_atom("bbbb2222", &[]),
    ];

    let result = resolver().resolve(&atoms);

    assert!(!status(&result, "aaaa1111").superseded);
    assert!(status(&result, "bbbb2222").superseded);
    assert_eq!(
        status(&result, "bbbb2222").superseded_by.as_deref(),
        Some("aaaa1111")
    );
}

#[test]
fn should_handle_multiple_atoms_superseded_by_one() {
    let atoms = [
        make_atom("aaaa1111", &["bbbb2222", "cccc3333"]),
        make_atom("bbbb2222", &[]),
        make_atom("cccc3333", &[]),
    ];

    let result = resolver().resolve(&atoms);

    assert!(!status(&result, "aaaa1111").superseded);
    assert!(status(&result, "bbbb2222").superseded);
    assert_eq!(
        status(&result, "bbbb2222").superseded_by.as_deref(),
        Some("aaaa1111")
    );
    assert!(status(&result, "cccc3333").superseded);
    assert_eq!(
        status(&result, "cccc3333").superseded_by.as_deref(),
        Some("aaaa1111")
    );
}

#[test]
fn should_handle_transitive_chains_a_supersedes_b_b_supersedes_c() {
    let atoms = [
        make_atom("aaaa1111", &["bbbb2222"]),
        make_atom("bbbb2222", &["cccc3333"]),
        make_atom("cccc3333", &[]),
    ];

    let result = resolver().resolve(&atoms);

    assert!(!status(&result, "aaaa1111").superseded);
    assert!(status(&result, "bbbb2222").superseded);
    assert!(status(&result, "cccc3333").superseded);
}

#[test]
fn should_handle_circular_references_without_infinite_loop() {
    let atoms = [
        make_atom("aaaa1111", &["bbbb2222"]),
        make_atom("bbbb2222", &["aaaa1111"]),
    ];

    let result = resolver().resolve(&atoms);

    // Both should be marked as superseded since each supersedes the other
    assert!(status(&result, "aaaa1111").superseded);
    assert!(status(&result, "bbbb2222").superseded);
}

#[test]
fn should_handle_supersession_of_atoms_not_in_the_set() {
    let atoms = [make_atom("aaaa1111", &["zzzz9999"])];

    let result = resolver().resolve(&atoms);

    // aaaa1111 should be active
    assert!(!status(&result, "aaaa1111").superseded);
    // zzzz9999 should not be in the map since it's not in the atom set
    assert!(!result.contains_key("zzzz9999"));
}

#[test]
fn should_handle_empty_atom_list() {
    let result = resolver().resolve(&[]);

    assert_eq!(result.len(), 0);
}

#[test]
fn should_handle_single_atom_with_no_supersession() {
    let atoms = [make_atom("aaaa1111", &[])];

    let result = resolver().resolve(&atoms);

    assert_eq!(result.len(), 1);
    assert!(!status(&result, "aaaa1111").superseded);
}

#[test]
fn should_handle_deep_transitive_chain_a_b_c_d() {
    let atoms = [
        make_atom("aaaa1111", &["bbbb2222"]),
        make_atom("bbbb2222", &["cccc3333"]),
        make_atom("cccc3333", &["dddd4444"]),
        make_atom("dddd4444", &[]),
    ];

    let result = resolver().resolve(&atoms);

    assert!(!status(&result, "aaaa1111").superseded);
    assert!(status(&result, "bbbb2222").superseded);
    assert!(status(&result, "cccc3333").superseded);
    assert!(status(&result, "dddd4444").superseded);
}

#[test]
fn should_skip_invalid_lore_id_references() {
    let atoms = [
        make_atom("aaaa1111", &["not-valid", "bbbb2222"]),
        make_atom("bbbb2222", &[]),
    ];

    let result = resolver().resolve(&atoms);

    assert!(status(&result, "bbbb2222").superseded);
    assert!(!status(&result, "aaaa1111").superseded);
}

#[test]
fn should_handle_diamond_supersession_pattern() {
    // A supersedes B, A supersedes C, both B and C supersede D
    let atoms = [
        make_atom("aaaa1111", &["bbbb2222", "cccc3333"]),
        make_atom("bbbb2222", &["dddd4444"]),
        make_atom("cccc3333", &["dddd4444"]),
        make_atom("dddd4444", &[]),
    ];

    let result = resolver().resolve(&atoms);

    assert!(!status(&result, "aaaa1111").superseded);
    assert!(status(&result, "bbbb2222").superseded);
    assert!(status(&result, "cccc3333").superseded);
    assert!(status(&result, "dddd4444").superseded);
}

#[test]
fn transitive_marking_preserves_the_first_superseder() {
    // B directly supersedes C; A supersedes B. C stays "superseded by B".
    let atoms = [
        make_atom("aaaa1111", &["bbbb2222"]),
        make_atom("bbbb2222", &["cccc3333"]),
        make_atom("cccc3333", &[]),
    ];

    let result = resolver().resolve(&atoms);

    assert_eq!(
        status(&result, "cccc3333").superseded_by.as_deref(),
        Some("bbbb2222")
    );
    assert_eq!(
        status(&result, "bbbb2222").superseded_by.as_deref(),
        Some("aaaa1111")
    );
}

// ---- filter_active ----------------------------------------------------------

#[test]
fn should_return_only_active_non_superseded_atoms() {
    let atoms = [
        make_atom("aaaa1111", &["bbbb2222"]),
        make_atom("bbbb2222", &[]),
        make_atom("cccc3333", &[]),
    ];

    let r = resolver();
    let supersession_map = r.resolve(&atoms);
    let active = r.filter_active(&atoms, &supersession_map);

    assert_eq!(active.len(), 2);
    let active_ids: Vec<&str> = active.iter().map(|a| a.lore_id.as_str()).collect();
    assert!(active_ids.contains(&"aaaa1111"));
    assert!(active_ids.contains(&"cccc3333"));
    assert!(!active_ids.contains(&"bbbb2222"));
}

#[test]
fn should_return_all_atoms_when_none_are_superseded() {
    let atoms = [make_atom("aaaa1111", &[]), make_atom("bbbb2222", &[])];

    let r = resolver();
    let supersession_map = r.resolve(&atoms);
    let active = r.filter_active(&atoms, &supersession_map);

    assert_eq!(active.len(), 2);
}

#[test]
fn should_return_empty_array_when_all_atoms_are_superseded() {
    let atoms = [
        make_atom("aaaa1111", &["bbbb2222"]),
        make_atom("bbbb2222", &["aaaa1111"]),
    ];

    let r = resolver();
    let supersession_map = r.resolve(&atoms);
    let active = r.filter_active(&atoms, &supersession_map);

    assert_eq!(active.len(), 0);
}

#[test]
fn should_handle_atoms_not_in_the_supersession_map() {
    let atoms = [make_atom("aaaa1111", &[])];

    // Empty map -- atom not found means active by default
    let supersession_map: HashMap<String, SupersessionStatus> = HashMap::new();
    let active = resolver().filter_active(&atoms, &supersession_map);

    assert_eq!(active.len(), 1);
}

#[test]
fn filter_active_should_handle_empty_atom_list() {
    let supersession_map: HashMap<String, SupersessionStatus> = HashMap::new();
    let active = resolver().filter_active(&[], &supersession_map);

    assert_eq!(active.len(), 0);
}
