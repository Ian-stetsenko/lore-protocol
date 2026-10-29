//! Ported case-for-case from `tests/unit/services/validator.test.ts`.
//!
//! The TS suite mocks the parser and the repository. Here the real
//! `TrailerParser` parses the raw trailer block of each commit, and a real
//! `AtomRepository` over a `MockGitClient` (empty history unless scripted)
//! backs the reference index.

use super::*;
use crate::test_support::{raw_commit, MockGitClient};
use crate::types::config::{TrailersConfig, ValidationConfig};

const PARSER: TrailerParser = TrailerParser;

/// Everything a `Validator` borrows, kept alive for the test's duration.
struct Harness {
    git: MockGitClient,
    config: LoreConfig,
}

impl Harness {
    fn new() -> Self {
        Harness {
            git: MockGitClient::new(),
            config: LoreConfig::default(),
        }
    }

    fn with_config(config: LoreConfig) -> Self {
        Harness {
            git: MockGitClient::new(),
            config,
        }
    }

    fn validate(&self, commits: &[RawCommit]) -> Vec<CommitValidationResult> {
        let repo = AtomRepository::new(&self.git, &PARSER, vec![]);
        let validator = Validator::new(&PARSER, &repo, &self.config);
        validator.validate(commits).unwrap()
    }
}

/// Mirrors `makeCommit`: default trailers `Lore-id: a1b2c3d4`.
fn commit() -> RawCommit {
    raw_commit()
        .hash("abc1234567890")
        .date("2025-01-15T10:00:00Z")
        .author("alice@example.com")
        .subject("feat(auth): add login flow")
        .body("")
        .trailers("Lore-id: a1b2c3d4")
        .build()
}

fn commit_with_trailers(trailers: &str) -> RawCommit {
    raw_commit()
        .hash("abc1234567890")
        .subject("feat(auth): add login flow")
        .body("")
        .trailers(trailers)
        .build()
}

fn find<'r>(result: &'r CommitValidationResult, rule: &str) -> Option<&'r ValidationIssue> {
    result.issues.iter().find(|i| i.rule == rule)
}

fn filter<'r>(result: &'r CommitValidationResult, rule: &str) -> Vec<&'r ValidationIssue> {
    result.issues.iter().filter(|i| i.rule == rule).collect()
}

// ---------------------------------------------------------------------------
// describe('basic validation')
// ---------------------------------------------------------------------------
mod basic_validation {
    use super::*;

    #[test]
    fn should_return_valid_for_a_correct_commit() {
        let h = Harness::new();

        let results = h.validate(&[commit()]);

        assert_eq!(results.len(), 1);
        assert!(results[0].valid);
        assert!(results[0].issues.is_empty());
        assert_eq!(results[0].lore_id, Some("a1b2c3d4".to_owned()));
    }

    #[test]
    fn should_validate_multiple_commits() {
        let h = Harness::new();
        let commit1 = raw_commit().hash("aaa111").build();
        let commit2 = raw_commit().hash("bbb222").build();

        let results = h.validate(&[commit1, commit2]);

        assert_eq!(results.len(), 2);
    }
}

// ---------------------------------------------------------------------------
// describe('Rule 1: trailer format')
// ---------------------------------------------------------------------------
mod rule_1_trailer_format {
    use super::*;

    /// TS: "should error when trailers cannot be parsed". The Rust parser is
    /// infallible, so the `trailer-format` rule is unreachable: unparseable
    /// text simply yields no trailers (and thus a missing Lore-id).
    #[test]
    fn trailer_format_rule_is_unreachable_because_the_parser_never_fails() {
        let h = Harness::new();

        let results = h.validate(&[commit_with_trailers("this is not a trailer block")]);

        assert!(find(&results[0], "trailer-format").is_none());
        assert!(find(&results[0], "lore-id-present").is_some());
        assert!(!results[0].valid);
    }
}

// ---------------------------------------------------------------------------
// describe('Rule 2: Lore-id present')
// ---------------------------------------------------------------------------
mod rule_2_lore_id_present {
    use super::*;

    #[test]
    fn should_error_when_lore_id_is_missing() {
        let h = Harness::new();

        let results = h.validate(&[commit_with_trailers("Confidence: high")]);

        let issue = find(&results[0], "lore-id-present").expect("lore-id-present issue");
        assert_eq!(issue.severity, Severity::Error);
        assert_eq!(issue.message, "Lore-id trailer is missing");
    }
}

// ---------------------------------------------------------------------------
// describe('Rule 3: Lore-id format')
// ---------------------------------------------------------------------------
mod rule_3_lore_id_format {
    use super::*;

    #[test]
    fn should_error_when_lore_id_is_not_8_char_hex() {
        let h = Harness::new();

        let results = h.validate(&[commit_with_trailers("Lore-id: not-hex!")]);

        let issue = find(&results[0], "lore-id-format").expect("lore-id-format issue");
        assert_eq!(issue.severity, Severity::Error);
        assert_eq!(
            issue.message,
            "Lore-id \"not-hex!\" is not a valid 8-character hex string"
        );
    }

    #[test]
    fn should_pass_for_valid_8_char_hex_lore_id() {
        let h = Harness::new();

        let results = h.validate(&[commit_with_trailers("Lore-id: abcd1234")]);

        assert!(find(&results[0], "lore-id-format").is_none());
    }

    #[test]
    fn should_error_for_too_short_lore_id() {
        let h = Harness::new();

        let results = h.validate(&[commit_with_trailers("Lore-id: abc123")]);

        assert!(find(&results[0], "lore-id-format").is_some());
    }

    #[test]
    fn should_error_for_uppercase_hex_lore_id() {
        let h = Harness::new();

        let results = h.validate(&[commit_with_trailers("Lore-id: ABCD1234")]);

        assert!(find(&results[0], "lore-id-format").is_some());
    }
}

// ---------------------------------------------------------------------------
// describe('Rule 4: valid enum values')
//
// The TS tests inject invalid enum strings through a mocked parser. With
// typed enum fields the real parser drops invalid values, so `invalid-enum`
// cannot fire; these tests pin that behaviour instead.
// ---------------------------------------------------------------------------
mod rule_4_valid_enum_values {
    use super::*;

    #[test]
    fn invalid_confidence_is_dropped_by_the_parser_so_no_invalid_enum_issue_is_raised() {
        let h = Harness::new();

        let results = h.validate(&[commit_with_trailers(
            "Lore-id: a1b2c3d4\nConfidence: super-high",
        )]);

        assert!(find(&results[0], "invalid-enum").is_none());
        assert!(results[0].valid);
    }

    #[test]
    fn invalid_scope_risk_is_dropped_by_the_parser_so_no_invalid_enum_issue_is_raised() {
        let h = Harness::new();

        let results = h.validate(&[commit_with_trailers("Lore-id: a1b2c3d4\nScope-risk: huge")]);

        assert!(find(&results[0], "invalid-enum").is_none());
    }

    #[test]
    fn invalid_reversibility_is_dropped_by_the_parser_so_no_invalid_enum_issue_is_raised() {
        let h = Harness::new();

        let results = h.validate(&[commit_with_trailers(
            "Lore-id: a1b2c3d4\nReversibility: maybe",
        )]);

        assert!(find(&results[0], "invalid-enum").is_none());
    }

    #[test]
    fn should_accept_valid_enum_values() {
        let h = Harness::new();

        let results = h.validate(&[commit_with_trailers(
            "Lore-id: a1b2c3d4\nConfidence: medium\nScope-risk: narrow\nReversibility: clean",
        )]);

        assert!(filter(&results[0], "invalid-enum").is_empty());
        assert!(results[0].valid);
    }

    #[test]
    fn should_not_error_when_enum_trailers_are_null() {
        let h = Harness::new();

        let results = h.validate(&[commit()]);

        assert!(filter(&results[0], "invalid-enum").is_empty());
    }
}

// ---------------------------------------------------------------------------
// describe('Rule 5: intent length')
// ---------------------------------------------------------------------------
mod rule_5_intent_length {
    use super::*;

    #[test]
    fn should_warn_when_intent_exceeds_max_length() {
        let h = Harness::new();

        let results = h.validate(&[raw_commit().subject(&"a".repeat(100)).build()]);

        let issue = find(&results[0], "intent-length").expect("intent-length issue");
        assert_eq!(issue.severity, Severity::Warning);
        assert_eq!(issue.message, "Intent exceeds 72 characters (got 100)");
    }

    #[test]
    fn should_not_warn_when_intent_is_within_limit() {
        let h = Harness::new();

        let results = h.validate(&[raw_commit().subject("feat: short intent").build()]);

        assert!(find(&results[0], "intent-length").is_none());
    }

    #[test]
    fn should_use_config_value_for_max_length() {
        let h = Harness::with_config(LoreConfig {
            validation: ValidationConfig {
                intent_max_length: 50,
                ..ValidationConfig::default()
            },
            ..LoreConfig::default()
        });

        let results = h.validate(&[raw_commit().subject(&"a".repeat(51)).build()]);

        let issue = find(&results[0], "intent-length").expect("intent-length issue");
        assert!(issue.message.contains("50"));
    }
}

// ---------------------------------------------------------------------------
// describe('Rule 6: required trailers')
// ---------------------------------------------------------------------------
mod rule_6_required_trailers {
    use super::*;

    fn required(keys: &[&str], strict: bool) -> LoreConfig {
        LoreConfig {
            trailers: TrailersConfig {
                required: keys.iter().map(|k| k.to_string()).collect(),
                custom: vec![],
            },
            validation: ValidationConfig {
                strict,
                ..ValidationConfig::default()
            },
            ..LoreConfig::default()
        }
    }

    #[test]
    fn should_warn_on_missing_required_trailers_non_strict() {
        let h = Harness::with_config(required(&["Confidence", "Constraint"], false));

        let results = h.validate(&[commit()]);

        let issues = filter(&results[0], "required-trailer");
        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0].severity, Severity::Warning);
        assert_eq!(
            issues[0].message,
            "Required trailer \"Confidence\" is missing"
        );
        assert_eq!(
            issues[1].message,
            "Required trailer \"Constraint\" is missing"
        );
    }

    #[test]
    fn should_error_on_missing_required_trailers_strict() {
        let h = Harness::with_config(required(&["Confidence"], true));

        let results = h.validate(&[commit()]);

        let issues = filter(&results[0], "required-trailer");
        assert_eq!(issues[0].severity, Severity::Error);
        assert!(!results[0].valid);
    }

    #[test]
    fn should_not_warn_when_required_trailers_are_present() {
        let h = Harness::with_config(required(&["Confidence"], false));

        let results = h.validate(&[commit_with_trailers(
            "Lore-id: a1b2c3d4\nConfidence: medium",
        )]);

        assert!(filter(&results[0], "required-trailer").is_empty());
    }

    #[test]
    fn should_accept_a_required_custom_trailer_when_present() {
        let mut config = required(&["Ticket"], false);
        config.trailers.custom = vec!["Ticket".to_owned()];
        let h = Harness::with_config(config);

        let results = h.validate(&[commit_with_trailers("Lore-id: a1b2c3d4\nTicket: JIRA-1")]);

        assert!(filter(&results[0], "required-trailer").is_empty());
    }
}

// ---------------------------------------------------------------------------
// describe('Rule 7: message line count')
// ---------------------------------------------------------------------------
mod rule_7_message_line_count {
    use super::*;

    #[test]
    fn should_warn_when_message_exceeds_max_lines() {
        let h = Harness::new();
        let long_body = (0..55)
            .map(|i| format!("Line {i}"))
            .collect::<Vec<_>>()
            .join("\n");

        let results = h.validate(&[raw_commit().body(&long_body).build()]);

        let issue = find(&results[0], "message-length").expect("message-length issue");
        assert_eq!(issue.severity, Severity::Warning);
        // 1 subject + 1 blank + 55 body + 1 blank + 1 trailer = 59
        assert_eq!(issue.message, "Message exceeds 50 lines (got 59)");
    }

    #[test]
    fn should_not_warn_when_within_line_limit() {
        let h = Harness::new();

        let results = h.validate(&[raw_commit().body("Short body").build()]);

        assert!(find(&results[0], "message-length").is_none());
    }
}

// ---------------------------------------------------------------------------
// describe('Rule 8: reference format')
// ---------------------------------------------------------------------------
mod rule_8_reference_format {
    use super::*;

    #[test]
    fn should_warn_on_invalid_reference_format() {
        let h = Harness::new();

        let results = h.validate(&[commit_with_trailers(
            "Lore-id: a1b2c3d4\nSupersedes: not-hex!\nRelated: toolong12",
        )]);

        let issues = filter(&results[0], "reference-format");
        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0].severity, Severity::Warning);
        assert_eq!(
            issues[0].message,
            "Invalid reference format in Supersedes: \"not-hex!\". Expected 8-character hex."
        );
        assert_eq!(
            issues[1].message,
            "Invalid reference format in Related: \"toolong12\". Expected 8-character hex."
        );
    }

    #[test]
    fn should_not_warn_on_valid_reference_format() {
        let h = Harness::new();

        let results = h.validate(&[commit_with_trailers(
            "Lore-id: a1b2c3d4\nSupersedes: aabbccdd\nDepends-on: 11223344",
        )]);

        assert!(filter(&results[0], "reference-format").is_empty());
    }
}

// ---------------------------------------------------------------------------
// describe('Rule 9: trailer count')
// ---------------------------------------------------------------------------
mod rule_9_trailer_count {
    use super::*;

    #[test]
    fn should_warn_when_more_than_5_of_any_trailer_type() {
        let h = Harness::new();
        let constraints = ["a", "b", "c", "d", "e", "f"]
            .iter()
            .map(|v| format!("Constraint: {v}"))
            .collect::<Vec<_>>()
            .join("\n");

        let results = h.validate(&[commit_with_trailers(&format!(
            "Lore-id: a1b2c3d4\n{constraints}"
        ))]);

        let issue = find(&results[0], "trailer-count").expect("trailer-count issue");
        assert_eq!(issue.severity, Severity::Warning);
        assert!(issue.message.contains("Constraint"));
        assert!(issue.message.contains('6'));
        assert_eq!(issue.message, "More than 5 values for Constraint (got 6)");
    }

    #[test]
    fn should_not_warn_when_5_or_fewer_of_each_type() {
        let h = Harness::new();

        let results = h.validate(&[commit_with_trailers(
            "Lore-id: a1b2c3d4\nConstraint: a\nConstraint: b\nConstraint: c\nConstraint: d\nConstraint: e\nRejected: x\nRejected: y",
        )]);

        assert!(filter(&results[0], "trailer-count").is_empty());
    }
}

// ---------------------------------------------------------------------------
// describe('overall validity')
// ---------------------------------------------------------------------------
mod overall_validity {
    use super::*;

    #[test]
    fn should_be_invalid_if_any_error_exists() {
        let h = Harness::new();

        let results = h.validate(&[commit_with_trailers("")]);

        assert!(!results[0].valid);
    }

    #[test]
    fn should_be_valid_even_with_warnings() {
        let h = Harness::new();

        let results = h.validate(&[raw_commit().subject(&"a".repeat(100)).build()]);

        let warnings = results[0]
            .issues
            .iter()
            .filter(|i| i.severity == Severity::Warning)
            .count();
        let errors = results[0]
            .issues
            .iter()
            .filter(|i| i.severity == Severity::Error)
            .count();
        assert!(warnings > 0);
        assert_eq!(errors, 0);
        assert!(results[0].valid);
    }
}

// ---------------------------------------------------------------------------
// describe('commit hash and lore-id reporting')
// ---------------------------------------------------------------------------
mod commit_hash_and_lore_id_reporting {
    use super::*;

    #[test]
    fn should_report_commit_hash() {
        let h = Harness::new();

        let results = h.validate(&[raw_commit().hash("specific_hash_123").build()]);

        assert_eq!(results[0].commit, "specific_hash_123");
    }

    #[test]
    fn should_report_lore_id_when_present() {
        let h = Harness::new();

        let results = h.validate(&[commit_with_trailers("Lore-id: deadbeef")]);

        assert_eq!(results[0].lore_id, Some("deadbeef".to_owned()));
    }

    /// TS: "should report null lore-id when parse fails". The parser never
    /// fails; the `None` case is a trailer block without a Lore-id.
    #[test]
    fn should_report_null_lore_id_when_no_lore_id_is_parsed() {
        let h = Harness::new();

        let results = h.validate(&[commit_with_trailers("Signed-off-by: Someone")]);

        assert_eq!(results[0].lore_id, None);
    }
}

// ---------------------------------------------------------------------------
// describe('Rule 10: reference existence')
// ---------------------------------------------------------------------------
mod rule_10_reference_existence {
    use super::*;

    #[test]
    fn should_warn_when_referenced_atom_does_not_exist() {
        let h = Harness::new();

        let results = h.validate(&[commit_with_trailers(
            "Lore-id: a1b2c3d4\nSupersedes: aabbccdd",
        )]);

        let issues = filter(&results[0], "reference-exists");
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].severity, Severity::Warning);
        assert!(issues[0].message.contains("aabbccdd"));
        assert_eq!(
            issues[0].message,
            "Referenced atom \"aabbccdd\" in Supersedes not found in repository"
        );
    }

    #[test]
    fn should_not_warn_when_referenced_atom_exists() {
        let h = Harness::new();
        h.git.set_log_result(vec![raw_commit()
            .hash("abc")
            .trailers("Lore-id: aabbccdd")
            .build()]);

        let results = h.validate(&[commit_with_trailers("Lore-id: a1b2c3d4\nRelated: aabbccdd")]);

        assert!(filter(&results[0], "reference-exists").is_empty());
    }

    #[test]
    fn should_not_query_the_repository_when_no_valid_references_exist() {
        let h = Harness::new();

        h.validate(&[commit_with_trailers("Lore-id: a1b2c3d4\nRelated: not-hex!")]);

        assert_eq!(h.git.log_call_count(), 0);
    }

    #[test]
    fn should_propagate_git_errors_from_the_index_build() {
        let h = Harness::new();
        h.git.set_log_error("boom");
        let repo = AtomRepository::new(&h.git, &PARSER, vec![]);
        let validator = Validator::new(&PARSER, &repo, &h.config);

        let result = validator.validate(&[commit_with_trailers(
            "Lore-id: a1b2c3d4\nDepends-on: aabbccdd",
        )]);

        assert!(matches!(result, Err(crate::util::LoreError::Git(_))));
    }
}
