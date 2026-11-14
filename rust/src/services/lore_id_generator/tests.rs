//! Port of `tests/unit/services/lore-id-generator.test.ts`.

use std::collections::HashSet;

use super::RandomLoreIdGenerator;
use crate::interfaces::lore_id_generator::LoreIdGenerator;
use crate::util::constants::{is_valid_lore_id, LORE_ID_LENGTH};

fn generator() -> RandomLoreIdGenerator {
    RandomLoreIdGenerator::new()
}

// ---- generate ----------------------------------------------------------------

#[test]
fn should_return_an_8_character_string() {
    let id = generator().generate();
    assert_eq!(id.len(), LORE_ID_LENGTH);
}

#[test]
fn should_return_only_lowercase_hex_characters() {
    let id = generator().generate();
    assert!(is_valid_lore_id(&id), "{id}");
}

#[test]
fn should_generate_unique_ids_across_multiple_calls() {
    let g = generator();
    let mut ids: HashSet<String> = HashSet::new();
    for _ in 0..100 {
        ids.insert(g.generate());
    }
    // With 4 bytes of randomness (2^32 possibilities), 100 IDs should all be unique
    assert_eq!(ids.len(), 100);
}

#[test]
fn should_match_the_lore_id_pattern_constant() {
    let g = generator();
    for _ in 0..50 {
        let id = g.generate();
        assert!(is_valid_lore_id(&id), "{id}");
    }
}

#[test]
fn should_not_contain_uppercase_characters() {
    let g = generator();
    for _ in 0..50 {
        let id = g.generate();
        assert_eq!(id, id.to_lowercase());
    }
}

#[test]
fn should_produce_different_ids_on_consecutive_calls() {
    let g = generator();
    let id1 = g.generate();
    let id2 = g.generate();
    assert_ne!(id1, id2);
}

#[test]
fn should_be_a_string_type() {
    // `LoreId` is a `String` alias; the type system enforces this, so the
    // runtime check reduces to "it is valid UTF-8 of the right shape".
    let id: String = generator().generate();
    assert!(id.is_ascii());
}

#[test]
fn default_constructs_a_working_generator() {
    let g: RandomLoreIdGenerator = Default::default();
    assert!(is_valid_lore_id(&g.generate()));
}
