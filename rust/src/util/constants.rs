//! Protocol constants shared across layers.

use crate::types::domain::{ConfidenceLevel, ReversibilityLevel, ScopeRiskLevel, TrailerKey};

pub const LORE_TRAILER_KEYS: [TrailerKey; 12] = TrailerKey::ALL;
pub const ARRAY_TRAILER_KEYS: [TrailerKey; 8] = TrailerKey::ARRAY;
pub const ENUM_TRAILER_KEYS: [TrailerKey; 3] = TrailerKey::ENUM;
pub const REFERENCE_TRAILER_KEYS: [TrailerKey; 3] = TrailerKey::REFERENCE;

pub const CONFIDENCE_VALUES: [&str; 3] = ["low", "medium", "high"];
pub const SCOPE_RISK_VALUES: [&str; 3] = ["narrow", "moderate", "wide"];
pub const REVERSIBILITY_VALUES: [&str; 3] = ["clean", "migration-needed", "irreversible"];

/// Length of a Lore-id in hex characters.
pub const LORE_ID_LENGTH: usize = 8;

/// Whether `s` is a well-formed Lore-id: exactly 8 lowercase hex characters.
pub fn is_valid_lore_id(s: &str) -> bool {
    s.len() == LORE_ID_LENGTH
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Wire values accepted for an enum trailer key; `None` for non-enum keys.
pub fn enum_values_for(key: TrailerKey) -> Option<&'static [&'static str]> {
    match key {
        TrailerKey::Confidence => Some(&CONFIDENCE_VALUES),
        TrailerKey::ScopeRisk => Some(&SCOPE_RISK_VALUES),
        TrailerKey::Reversibility => Some(&REVERSIBILITY_VALUES),
        _ => None,
    }
}

pub const DEFAULT_QUERY_LIMIT: usize = 100;
pub const DEFAULT_STALE_OLDER_THAN: &str = "6m";
pub const DEFAULT_STALE_DRIFT_THRESHOLD: usize = 20;

pub const CONFIG_FILENAME: &str = "config.toml";
pub const CONFIG_DIR: &str = ".lore";

pub const EXIT_CODE_SUCCESS: i32 = 0;
pub const EXIT_CODE_VALIDATION_ERROR: i32 = 1;
pub const EXIT_CODE_GIT_ERROR: i32 = 2;
pub const EXIT_CODE_NO_STAGED_CHANGES: i32 = 3;

/// Protocol version reported in JSON output.
pub const LORE_VERSION: &str = "1.0";

/// Prompt text for `lore commit -i`.
pub mod prompt_strings {
    pub const INTENT: &str = "Intent (why the change was made):";
    pub const ADD_BODY: &str = "Add a body? (narrative context)";
    pub const BODY_INPUT: &str = "Body (press Enter on empty line to finish):";
    pub const ADD_CONSTRAINT: &str = "Add a Constraint?";
    pub const CONSTRAINT_INPUT: &str = "Constraint:";
    pub const ADD_REJECTED: &str = "Add a Rejected alternative?";
    pub const REJECTED_INPUT: &str = "Rejected (format: alternative | reason):";
    pub const SET_CONFIDENCE: &str = "Set Confidence?";
    pub const CONFIDENCE_CHOICE: &str = "Confidence:";
    pub const SET_SCOPE_RISK: &str = "Set Scope-risk?";
    pub const SCOPE_RISK_CHOICE: &str = "Scope-risk:";
    pub const SET_REVERSIBILITY: &str = "Set Reversibility?";
    pub const REVERSIBILITY_CHOICE: &str = "Reversibility:";
    pub const ADD_DIRECTIVE: &str = "Add a Directive?";
    pub const DIRECTIVE_INPUT: &str = "Directive:";
    pub const ADD_TESTED: &str = "Add a Tested entry?";
    pub const TESTED_INPUT: &str = "Tested:";
    pub const ADD_NOT_TESTED: &str = "Add a Not-tested entry?";
    pub const NOT_TESTED_INPUT: &str = "Not-tested:";
    pub const ADD_SUPERSEDES: &str = "Add a Supersedes reference?";
    pub const SUPERSEDES_INPUT: &str = "Supersedes (8-char hex Lore-id):";
    pub const ADD_DEPENDS_ON: &str = "Add a Depends-on reference?";
    pub const DEPENDS_ON_INPUT: &str = "Depends-on (8-char hex Lore-id):";
    pub const ADD_RELATED: &str = "Add a Related reference?";
    pub const RELATED_INPUT: &str = "Related (8-char hex Lore-id):";
}

// Keep the string tables and the typed enums in lock-step.
const _: () = {
    assert!(CONFIDENCE_VALUES.len() == ConfidenceLevel::ALL.len());
    assert!(SCOPE_RISK_VALUES.len() == ScopeRiskLevel::ALL.len());
    assert!(REVERSIBILITY_VALUES.len() == ReversibilityLevel::ALL.len());
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lore_id_pattern_is_strict() {
        assert!(is_valid_lore_id("a1b2c3d4"));
        assert!(is_valid_lore_id("00000000"));
        assert!(!is_valid_lore_id("A1B2C3D4"));
        assert!(!is_valid_lore_id("a1b2c3d"));
        assert!(!is_valid_lore_id("a1b2c3d4e"));
        assert!(!is_valid_lore_id("a1b2c3dg"));
        assert!(!is_valid_lore_id(""));
        assert!(!is_valid_lore_id("a1b2c3d4\n"));
    }

    #[test]
    fn enum_value_tables_match_typed_enums() {
        for (s, l) in CONFIDENCE_VALUES.iter().zip(ConfidenceLevel::ALL) {
            assert_eq!(*s, l.as_str());
        }
        for (s, l) in SCOPE_RISK_VALUES.iter().zip(ScopeRiskLevel::ALL) {
            assert_eq!(*s, l.as_str());
        }
        for (s, l) in REVERSIBILITY_VALUES.iter().zip(ReversibilityLevel::ALL) {
            assert_eq!(*s, l.as_str());
        }
        assert_eq!(
            enum_values_for(TrailerKey::Confidence),
            Some(&CONFIDENCE_VALUES[..])
        );
        assert_eq!(enum_values_for(TrailerKey::Tested), None);
    }
}
