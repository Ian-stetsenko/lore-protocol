//! Unit tests for `SearchFilter`. The TypeScript project has no dedicated
//! test file for this service, so these cover every filter plus the `has`
//! and text-matching helpers directly.

use indexmap::IndexMap;

use super::SearchFilter;
use crate::test_support::atom;
use crate::types::custom_trailer_collection::CustomTrailerCollection;
use crate::types::domain::{
    ConfidenceLevel, LoreAtom, ReversibilityLevel, ScopeRiskLevel, TrailerKey,
};
use crate::types::query::SearchOptions;

fn filter() -> SearchFilter {
    SearchFilter::new()
}

fn opts() -> SearchOptions {
    SearchOptions::default()
}

fn ids(atoms: &[LoreAtom]) -> Vec<&str> {
    atoms.iter().map(|a| a.lore_id.as_str()).collect()
}

fn s(v: &str) -> Option<String> {
    Some(v.to_owned())
}

/// Three atoms with distinct enum levels, authors, scopes and text.
fn sample() -> Vec<LoreAtom> {
    vec![
        atom()
            .id("aaaa0001")
            .author("alice@example.com")
            .intent("feat(auth): add login flow")
            .body("Uses OAuth2 with PKCE.")
            .constraint(&["Must use HTTPS"])
            .confidence(ConfidenceLevel::High)
            .scope_risk(ScopeRiskLevel::Narrow)
            .reversibility(ReversibilityLevel::Clean)
            .build(),
        atom()
            .id("bbbb0002")
            .author("Bob@Example.com")
            .intent("fix(db): tune connection pool")
            .body("")
            .rejected(&["MongoDB -- no transactions"])
            .tested(&["Integration suite"])
            .confidence(ConfidenceLevel::Low)
            .scope_risk(ScopeRiskLevel::Wide)
            .reversibility(ReversibilityLevel::MigrationNeeded)
            .build(),
        atom()
            .id("cccc0003")
            .author("carol@example.org")
            .intent("chore: bump dependencies")
            .body("Routine maintenance.")
            .build(),
    ]
}

// ---- apply_filters: no filters -----------------------------------------------

#[test]
fn should_return_all_atoms_in_order_when_no_filters_are_set() {
    let atoms = sample();
    let result = filter().apply_filters(&atoms, &opts());
    assert_eq!(result, atoms);
}

#[test]
fn should_return_empty_for_empty_input() {
    let result = filter().apply_filters(
        &[],
        &SearchOptions {
            text: s("anything"),
            ..opts()
        },
    );
    assert!(result.is_empty());
}

#[test]
fn should_ignore_since_until_limit_and_max_commits() {
    let atoms = sample();
    let options = SearchOptions {
        since: s("2020-01-01"),
        until: s("2030-01-01"),
        limit: Some(1),
        max_commits: Some(1),
        ..opts()
    };
    let result = filter().apply_filters(&atoms, &options);
    assert_eq!(result.len(), 3);
}

// ---- apply_filters: confidence -------------------------------------------------

#[test]
fn should_filter_by_confidence() {
    let atoms = sample();
    let options = SearchOptions {
        confidence: s("high"),
        ..opts()
    };
    let result = filter().apply_filters(&atoms, &options);
    assert_eq!(ids(&result), vec!["aaaa0001"]);
}

#[test]
fn should_exclude_atoms_without_confidence_when_filtering_by_confidence() {
    let atoms = sample();
    let options = SearchOptions {
        confidence: s("low"),
        ..opts()
    };
    let result = filter().apply_filters(&atoms, &options);
    assert_eq!(ids(&result), vec!["bbbb0002"]);
}

#[test]
fn should_match_nothing_for_unrecognised_confidence() {
    let atoms = sample();
    let options = SearchOptions {
        confidence: s("HIGH"),
        ..opts()
    };
    assert!(filter().apply_filters(&atoms, &options).is_empty());
}

// ---- apply_filters: scope_risk -------------------------------------------------

#[test]
fn should_filter_by_scope_risk() {
    let atoms = sample();
    let options = SearchOptions {
        scope_risk: s("wide"),
        ..opts()
    };
    let result = filter().apply_filters(&atoms, &options);
    assert_eq!(ids(&result), vec!["bbbb0002"]);
}

#[test]
fn should_match_nothing_for_unrecognised_scope_risk() {
    let atoms = sample();
    let options = SearchOptions {
        scope_risk: s("huge"),
        ..opts()
    };
    assert!(filter().apply_filters(&atoms, &options).is_empty());
}

// ---- apply_filters: reversibility ----------------------------------------------

#[test]
fn should_filter_by_reversibility() {
    let atoms = sample();
    let options = SearchOptions {
        reversibility: s("migration-needed"),
        ..opts()
    };
    let result = filter().apply_filters(&atoms, &options);
    assert_eq!(ids(&result), vec!["bbbb0002"]);
}

#[test]
fn should_match_nothing_for_unrecognised_reversibility() {
    let atoms = sample();
    let options = SearchOptions {
        reversibility: s("irreversable"),
        ..opts()
    };
    assert!(filter().apply_filters(&atoms, &options).is_empty());
}

// ---- apply_filters: has -------------------------------------------------------

#[test]
fn should_filter_by_has_array_trailer() {
    let atoms = sample();
    let options = SearchOptions {
        has: s("Constraint"),
        ..opts()
    };
    let result = filter().apply_filters(&atoms, &options);
    assert_eq!(ids(&result), vec!["aaaa0001"]);
}

#[test]
fn should_filter_by_has_enum_trailer() {
    let atoms = sample();
    let options = SearchOptions {
        has: s("Confidence"),
        ..opts()
    };
    let result = filter().apply_filters(&atoms, &options);
    assert_eq!(ids(&result), vec!["aaaa0001", "bbbb0002"]);
}

#[test]
fn should_filter_by_has_lore_id() {
    let atoms = sample();
    let options = SearchOptions {
        has: s("Lore-id"),
        ..opts()
    };
    let result = filter().apply_filters(&atoms, &options);
    assert_eq!(result.len(), 3);
}

#[test]
fn should_match_nothing_for_unrecognised_has_key() {
    let atoms = sample();
    for key in ["Ticket", "constraint", "", "Signed-off-by"] {
        let options = SearchOptions {
            has: s(key),
            ..opts()
        };
        assert!(
            filter().apply_filters(&atoms, &options).is_empty(),
            "key {key:?} should match nothing"
        );
    }
}

// ---- apply_filters: author ----------------------------------------------------

#[test]
fn should_filter_by_author_substring_case_insensitively() {
    let atoms = sample();
    let options = SearchOptions {
        author: s("BOB"),
        ..opts()
    };
    let result = filter().apply_filters(&atoms, &options);
    assert_eq!(ids(&result), vec!["bbbb0002"]);
}

#[test]
fn should_match_multiple_authors_by_shared_substring() {
    let atoms = sample();
    let options = SearchOptions {
        author: s("example.com"),
        ..opts()
    };
    let result = filter().apply_filters(&atoms, &options);
    assert_eq!(ids(&result), vec!["aaaa0001", "bbbb0002"]);
}

#[test]
fn should_match_nothing_for_unknown_author() {
    let atoms = sample();
    let options = SearchOptions {
        author: s("dave"),
        ..opts()
    };
    assert!(filter().apply_filters(&atoms, &options).is_empty());
}

// ---- apply_filters: scope -----------------------------------------------------

#[test]
fn should_filter_by_conventional_commit_scope() {
    let atoms = sample();
    let options = SearchOptions {
        scope: s("db"),
        ..opts()
    };
    let result = filter().apply_filters(&atoms, &options);
    assert_eq!(ids(&result), vec!["bbbb0002"]);
}

#[test]
fn should_match_scope_case_insensitively() {
    let atoms = vec![atom()
        .id("aaaa0001")
        .intent("feat(Auth): add login flow")
        .build()];
    let options = SearchOptions {
        scope: s("AUTH"),
        ..opts()
    };
    let result = filter().apply_filters(&atoms, &options);
    assert_eq!(ids(&result), vec!["aaaa0001"]);
}

#[test]
fn should_require_exact_scope_match_not_substring() {
    let atoms = sample();
    let options = SearchOptions {
        scope: s("aut"),
        ..opts()
    };
    assert!(filter().apply_filters(&atoms, &options).is_empty());
}

#[test]
fn should_exclude_intents_without_a_scope() {
    let atoms = sample();
    let options = SearchOptions {
        scope: s("chore"),
        ..opts()
    };
    // `chore: bump dependencies` has no `(scope)`; the type itself is not a scope.
    assert!(filter().apply_filters(&atoms, &options).is_empty());
}

#[test]
fn should_require_scope_pattern_at_start_of_intent() {
    let atoms = vec![
        atom().id("aaaa0001").intent("see feat(auth): x").build(),
        atom().id("bbbb0002").intent("123(auth): x").build(),
        atom().id("cccc0003").intent("feat(): empty").build(),
    ];
    let options = SearchOptions {
        scope: s("auth"),
        ..opts()
    };
    assert!(filter().apply_filters(&atoms, &options).is_empty());
}

#[test]
fn should_match_scopes_containing_punctuation() {
    let atoms = vec![atom()
        .id("aaaa0001")
        .intent("fix(api/v2-users): handle nulls")
        .build()];
    let options = SearchOptions {
        scope: s("api/v2-users"),
        ..opts()
    };
    assert_eq!(filter().apply_filters(&atoms, &options).len(), 1);
}

// ---- apply_filters: text -------------------------------------------------------

#[test]
fn should_filter_by_text_in_intent() {
    let atoms = sample();
    let options = SearchOptions {
        text: s("LOGIN"),
        ..opts()
    };
    let result = filter().apply_filters(&atoms, &options);
    assert_eq!(ids(&result), vec!["aaaa0001"]);
}

#[test]
fn should_filter_by_text_in_body() {
    let atoms = sample();
    let options = SearchOptions {
        text: s("pkce"),
        ..opts()
    };
    let result = filter().apply_filters(&atoms, &options);
    assert_eq!(ids(&result), vec!["aaaa0001"]);
}

#[test]
fn should_filter_by_text_in_array_trailers() {
    let atoms = sample();
    let options = SearchOptions {
        text: s("mongodb"),
        ..opts()
    };
    let result = filter().apply_filters(&atoms, &options);
    assert_eq!(ids(&result), vec!["bbbb0002"]);
}

#[test]
fn should_filter_by_text_in_enum_trailers() {
    let atoms = sample();
    let options = SearchOptions {
        text: s("migration"),
        ..opts()
    };
    let result = filter().apply_filters(&atoms, &options);
    assert_eq!(ids(&result), vec!["bbbb0002"]);
}

#[test]
fn empty_text_should_match_every_atom() {
    let atoms = sample();
    let options = SearchOptions {
        text: s(""),
        ..opts()
    };
    assert_eq!(filter().apply_filters(&atoms, &options).len(), 3);
}

// ---- apply_filters: combinations -----------------------------------------------

#[test]
fn should_combine_filters_with_and_semantics() {
    let atoms = sample();
    let options = SearchOptions {
        author: s("example.com"),
        has: s("Confidence"),
        confidence: s("low"),
        ..opts()
    };
    let result = filter().apply_filters(&atoms, &options);
    assert_eq!(ids(&result), vec!["bbbb0002"]);
}

#[test]
fn combined_filters_that_disagree_should_match_nothing() {
    let atoms = sample();
    let options = SearchOptions {
        confidence: s("high"),
        scope_risk: s("wide"),
        ..opts()
    };
    assert!(filter().apply_filters(&atoms, &options).is_empty());
}

#[test]
fn should_not_mutate_the_input_slice() {
    let atoms = sample();
    let before = atoms.clone();
    let _ = filter().apply_filters(
        &atoms,
        &SearchOptions {
            text: s("login"),
            ..opts()
        },
    );
    assert_eq!(atoms, before);
}

// ---- atom_has_trailer ----------------------------------------------------------

#[test]
fn atom_has_trailer_lore_id_true_when_set() {
    let a = atom().build();
    assert!(filter().atom_has_trailer(&a, TrailerKey::LoreId));
}

#[test]
fn atom_has_trailer_lore_id_false_when_empty() {
    let mut a = atom().build();
    a.trailers.lore_id = String::new();
    assert!(!filter().atom_has_trailer(&a, TrailerKey::LoreId));
}

#[test]
fn atom_has_trailer_array_keys_follow_length() {
    let f = filter();
    let empty = atom().build();
    for key in TrailerKey::ARRAY {
        assert!(!f.atom_has_trailer(&empty, key), "{key} should be absent");
    }

    let full = atom()
        .constraint(&["c"])
        .rejected(&["r"])
        .directive(&["d"])
        .tested(&["t"])
        .not_tested(&["n"])
        .supersedes(&["11112222"])
        .depends_on(&["33334444"])
        .related(&["55556666"])
        .build();
    for key in TrailerKey::ARRAY {
        assert!(f.atom_has_trailer(&full, key), "{key} should be present");
    }
}

#[test]
fn atom_has_trailer_enum_keys_follow_presence() {
    let f = filter();
    let empty = atom().build();
    for key in TrailerKey::ENUM {
        assert!(!f.atom_has_trailer(&empty, key), "{key} should be absent");
    }

    let full = atom()
        .confidence(ConfidenceLevel::Medium)
        .scope_risk(ScopeRiskLevel::Moderate)
        .reversibility(ReversibilityLevel::Irreversible)
        .build();
    for key in TrailerKey::ENUM {
        assert!(f.atom_has_trailer(&full, key), "{key} should be present");
    }
}

// ---- atom_matches_text --------------------------------------------------------

#[test]
fn atom_matches_text_checks_intent() {
    let a = atom().intent("feat(auth): Add Login").build();
    assert!(filter().atom_matches_text(&a, "add login"));
}

#[test]
fn atom_matches_text_checks_body() {
    let a = atom().body("Uses PKCE flow").build();
    assert!(filter().atom_matches_text(&a, "pkce"));
}

#[test]
fn atom_matches_text_checks_every_array_trailer() {
    let f = filter();
    let cases: [(&str, LoreAtom); 8] = [
        ("needle-c", atom().constraint(&["Needle-C"]).build()),
        ("needle-r", atom().rejected(&["Needle-R"]).build()),
        ("needle-d", atom().directive(&["Needle-D"]).build()),
        ("needle-t", atom().tested(&["Needle-T"]).build()),
        ("needle-n", atom().not_tested(&["Needle-N"]).build()),
        ("abcdef01", atom().supersedes(&["ABCDEF01"]).build()),
        ("abcdef02", atom().depends_on(&["ABCDEF02"]).build()),
        ("abcdef03", atom().related(&["ABCDEF03"]).build()),
    ];
    for (needle, a) in &cases {
        assert!(f.atom_matches_text(a, needle), "{needle} should match");
        assert!(
            !f.atom_matches_text(a, "absent"),
            "{needle}: 'absent' should not match"
        );
    }
}

#[test]
fn atom_matches_text_checks_enum_trailers() {
    let f = filter();
    // Intent/body are neutral so only the enum values can match.
    let a = atom()
        .intent("x")
        .confidence(ConfidenceLevel::High)
        .scope_risk(ScopeRiskLevel::Moderate)
        .reversibility(ReversibilityLevel::MigrationNeeded)
        .build();
    assert!(f.atom_matches_text(&a, "high"));
    assert!(f.atom_matches_text(&a, "moderate"));
    assert!(f.atom_matches_text(&a, "migration-needed"));
    assert!(!f.atom_matches_text(&a, "low"));
}

#[test]
fn atom_matches_text_does_not_search_custom_trailers() {
    let mut custom: IndexMap<String, Vec<String>> = IndexMap::new();
    custom.insert("Ticket".to_owned(), vec!["PROJ-999".to_owned()]);
    let a = atom()
        .intent("x")
        .custom(CustomTrailerCollection::new(custom))
        .build();
    assert!(!filter().atom_matches_text(&a, "proj-999"));
}

#[test]
fn atom_matches_text_returns_false_when_nothing_matches() {
    let a = atom().build();
    assert!(!filter().atom_matches_text(&a, "zzz-not-there"));
}

#[test]
fn atom_matches_text_expects_pre_lowercased_needle() {
    // The caller lower-cases the needle; an upper-case needle never matches
    // the lower-cased haystack.
    let a = atom().intent("feat(auth): add login flow").build();
    assert!(!filter().atom_matches_text(&a, "LOGIN"));
}
