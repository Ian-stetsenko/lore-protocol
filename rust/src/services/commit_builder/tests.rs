use indexmap::IndexMap;

use super::*;
use crate::test_support::FixedLoreIdGenerator;
use crate::types::config::{TrailersConfig, ValidationConfig};
use crate::types::output::Severity;

fn input(intent: &str) -> CommitInput {
    CommitInput {
        intent: intent.to_owned(),
        body: None,
        trailers: None,
    }
}

fn with_trailers(intent: &str, trailers: CommitInputTrailers) -> CommitInput {
    CommitInput {
        intent: intent.to_owned(),
        body: None,
        trailers: Some(trailers),
    }
}

fn confidence(value: &str) -> CommitInputTrailers {
    CommitInputTrailers {
        confidence: Some(value.to_owned()),
        ..CommitInputTrailers::default()
    }
}

fn strings(values: &[&str]) -> Option<Vec<String>> {
    Some(values.iter().map(|v| v.to_string()).collect())
}

fn custom(entries: &[(&str, &[&str])]) -> CustomTrailerCollection {
    let map: IndexMap<String, Vec<String>> = entries
        .iter()
        .map(|(k, vs)| (k.to_string(), vs.iter().map(|v| v.to_string()).collect()))
        .collect();
    CustomTrailerCollection::new(map)
}

struct Fixture {
    parser: TrailerParser,
    generator: FixedLoreIdGenerator,
    config: LoreConfig,
}

impl Fixture {
    /// Queues `a1b2c3d4` then `second`, so the tests can tell how many ids
    /// were consumed (TS asserts on `generate` call counts).
    fn new() -> Self {
        Fixture::with_config(LoreConfig::default())
    }

    fn with_config(config: LoreConfig) -> Self {
        Fixture {
            parser: TrailerParser::new(),
            generator: FixedLoreIdGenerator::new(&["a1b2c3d4", "second"]),
            config,
        }
    }

    fn builder(&self) -> CommitBuilder<'_> {
        CommitBuilder::new(&self.parser, &self.generator, &self.config)
    }
}

mod build {
    use super::*;

    #[test]
    fn should_build_a_minimal_commit_with_intent_and_lore_id() {
        let f = Fixture::new();

        let BuiltCommit { message, lore_id } = f
            .builder()
            .build(&input("feat(auth): add login flow"), None);

        // Exactly one id consumed: the next one handed out is the second queued id.
        assert_eq!(f.generator.generate(), "second");
        assert!(message.contains("feat(auth): add login flow"));
        assert!(message.contains("Lore-id: a1b2c3d4"));
        assert_eq!(lore_id, "a1b2c3d4");
        assert_eq!(message, "feat(auth): add login flow\n\nLore-id: a1b2c3d4");
    }

    #[test]
    fn should_include_body_separated_by_blank_lines() {
        let f = Fixture::new();
        let input = CommitInput {
            intent: "feat: add feature".to_owned(),
            body: Some("This is a detailed explanation.".to_owned()),
            trailers: None,
        };

        let BuiltCommit { message, .. } = f.builder().build(&input, None);

        assert!(message.contains("feat: add feature"));
        assert!(message.contains("\n\nThis is a detailed explanation.\n\n"));
    }

    #[test]
    fn should_include_all_trailer_types() {
        let f = Fixture::new();
        let trailers = CommitInputTrailers {
            constraint: strings(&["Must use HTTPS", "No external deps"]),
            rejected: strings(&["Polling approach"]),
            confidence: Some("high".to_owned()),
            scope_risk: Some("narrow".to_owned()),
            reversibility: Some("clean".to_owned()),
            directive: strings(&["Review in 3 months"]),
            tested: strings(&["Unit tests for auth module"]),
            not_tested: strings(&["Edge case with expired tokens"]),
            supersedes: strings(&["bbccddee"]),
            depends_on: strings(&["11223344"]),
            related: strings(&["aabbccdd"]),
            custom: None,
        };

        let BuiltCommit { message, .. } = f
            .builder()
            .build(&with_trailers("feat: full commit", trailers), None);

        for expected in [
            "Constraint: Must use HTTPS",
            "Constraint: No external deps",
            "Rejected: Polling approach",
            "Confidence: high",
            "Scope-risk: narrow",
            "Reversibility: clean",
            "Directive: Review in 3 months",
            "Tested: Unit tests for auth module",
            "Not-tested: Edge case with expired tokens",
            "Supersedes: bbccddee",
            "Depends-on: 11223344",
            "Related: aabbccdd",
        ] {
            assert!(
                message.contains(expected),
                "missing {expected:?} in {message:?}"
            );
        }
    }

    #[test]
    fn should_auto_generate_lore_id() {
        let parser = TrailerParser::new();
        let generator = FixedLoreIdGenerator::single("deadbeef");
        let config = LoreConfig::default();
        let builder = CommitBuilder::new(&parser, &generator, &config);

        let BuiltCommit { message, lore_id } = builder.build(&input("test"), None);

        assert!(message.contains("Lore-id: deadbeef"));
        assert_eq!(lore_id, "deadbeef");
    }

    #[test]
    fn should_use_provided_existing_lore_id_instead_of_generating_one() {
        let f = Fixture::new();

        let BuiltCommit { message, lore_id } = f
            .builder()
            .build(&input("amend: update commit"), Some("cafebabe"));

        assert!(message.contains("Lore-id: cafebabe"));
        assert_eq!(lore_id, "cafebabe");
        // Nothing consumed: the first queued id is still next.
        assert_eq!(f.generator.generate(), "a1b2c3d4");
    }

    #[test]
    fn should_generate_new_lore_id_when_no_existing_lore_id_is_provided() {
        let f = Fixture::new();

        let BuiltCommit { message, .. } = f.builder().build(&input("new commit"), None);

        assert_eq!(f.generator.generate(), "second");
        assert!(message.contains("Lore-id: a1b2c3d4"));
    }

    #[test]
    fn should_pass_correct_trailers_to_serialize() {
        let f = Fixture::new();

        let BuiltCommit { message, .. } = f
            .builder()
            .build(&with_trailers("test", confidence("medium")), None);

        assert!(message.contains("Lore-id: a1b2c3d4"));
        assert!(message.contains("Confidence: medium"));
        assert!(!message.contains("Constraint:"));
        assert_eq!(message, "test\n\nLore-id: a1b2c3d4\nConfidence: medium");
    }

    #[test]
    fn should_pass_custom_trailers_through_to_lore_trailers_custom_map() {
        let f = Fixture::new();
        let trailers = CommitInputTrailers {
            confidence: Some("high".to_owned()),
            custom: Some(custom(&[
                ("Assisted-by", &["Gemini:CLI"]),
                ("Ticket", &["PROJ-123"]),
            ])),
            ..CommitInputTrailers::default()
        };

        let BuiltCommit { message, .. } = f
            .builder()
            .build(&with_trailers("feat: with custom trailers", trailers), None);

        assert!(message.contains("Assisted-by: Gemini:CLI"));
        assert!(message.contains("Ticket: PROJ-123"));
    }

    #[test]
    fn should_produce_empty_custom_map_when_no_custom_trailers_provided() {
        let f = Fixture::new();

        let BuiltCommit { message, .. } = f
            .builder()
            .build(&with_trailers("feat: no custom", confidence("high")), None);

        assert!(message.contains("Lore-id: a1b2c3d4"));
        assert_eq!(
            message,
            "feat: no custom\n\nLore-id: a1b2c3d4\nConfidence: high"
        );
    }

    #[test]
    fn unparsable_enum_values_are_dropped_from_the_message() {
        let f = Fixture::new();

        let BuiltCommit { message, .. } = f
            .builder()
            .build(&with_trailers("test", confidence("super-high")), None);

        assert!(!message.contains("Confidence:"));
    }
}

mod validate {
    use super::*;

    fn find<'a>(issues: &'a [ValidationIssue], rule: &str) -> Option<&'a ValidationIssue> {
        issues.iter().find(|i| i.rule == rule)
    }

    fn filter<'a>(issues: &'a [ValidationIssue], rule: &str) -> Vec<&'a ValidationIssue> {
        issues.iter().filter(|i| i.rule == rule).collect()
    }

    fn required(required: &[&str], strict: bool) -> LoreConfig {
        LoreConfig {
            trailers: TrailersConfig {
                required: required.iter().map(|r| r.to_string()).collect(),
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
    fn should_return_no_issues_for_valid_input() {
        let f = Fixture::new();

        let issues = f.builder().validate(&with_trailers(
            "feat: valid commit message",
            confidence("medium"),
        ));

        assert!(issues.is_empty());
    }

    #[test]
    fn should_warn_when_intent_exceeds_max_length() {
        let f = Fixture::new();

        let issues = f.builder().validate(&input(&"a".repeat(100)));

        let issue = find(&issues, "intent-length").expect("intent-length issue");
        assert_eq!(issue.severity, Severity::Warning);
        assert!(issue.message.contains("72"));
        assert_eq!(issue.message, "Intent exceeds 72 characters (got 100)");
    }

    #[test]
    fn should_error_when_intent_is_empty() {
        let f = Fixture::new();

        let issues = f.builder().validate(&input("   "));

        let issue = find(&issues, "intent-required").expect("intent-required issue");
        assert_eq!(issue.severity, Severity::Error);
        assert_eq!(issue.message, "Intent must not be empty");
    }

    #[test]
    fn should_error_on_invalid_confidence_enum() {
        let f = Fixture::new();

        let issues = f
            .builder()
            .validate(&with_trailers("test", confidence("super-high")));

        let issue = issues
            .iter()
            .find(|i| i.rule == "invalid-enum" && i.message.contains("Confidence"))
            .expect("invalid-enum issue");
        assert_eq!(issue.severity, Severity::Error);
        assert_eq!(
            issue.message,
            "Invalid Confidence value: \"super-high\". Expected one of: low, medium, high"
        );
    }

    #[test]
    fn should_error_on_invalid_scope_risk_enum() {
        let f = Fixture::new();
        let trailers = CommitInputTrailers {
            scope_risk: Some("huge".to_owned()),
            ..CommitInputTrailers::default()
        };

        let issues = f.builder().validate(&with_trailers("test", trailers));

        let issue = issues
            .iter()
            .find(|i| i.rule == "invalid-enum" && i.message.contains("Scope-risk"))
            .expect("invalid-enum issue");
        assert_eq!(
            issue.message,
            "Invalid Scope-risk value: \"huge\". Expected one of: narrow, moderate, wide"
        );
    }

    #[test]
    fn should_error_on_invalid_reversibility_enum() {
        let f = Fixture::new();
        let trailers = CommitInputTrailers {
            reversibility: Some("maybe".to_owned()),
            ..CommitInputTrailers::default()
        };

        let issues = f.builder().validate(&with_trailers("test", trailers));

        assert!(issues
            .iter()
            .any(|i| i.rule == "invalid-enum" && i.message.contains("Reversibility")));
    }

    #[test]
    fn should_error_on_invalid_lore_id_format_in_references() {
        let f = Fixture::new();
        let trailers = CommitInputTrailers {
            supersedes: strings(&["not-hex!"]),
            depends_on: strings(&["aabbccdd"]),
            related: strings(&["toolong12"]),
            ..CommitInputTrailers::default()
        };

        let issues = f.builder().validate(&with_trailers("test", trailers));

        let ref_issues = filter(&issues, "invalid-lore-id-ref");
        assert_eq!(ref_issues.len(), 2); // not-hex! and toolong12
        assert_eq!(
            ref_issues[0].message,
            "Invalid Lore-id reference in Supersedes: \"not-hex!\". Must be 8-character hex."
        );
        assert_eq!(
            ref_issues[1].message,
            "Invalid Lore-id reference in Related: \"toolong12\". Must be 8-character hex."
        );
    }

    #[test]
    fn should_accept_valid_8_char_hex_references() {
        let f = Fixture::new();
        let trailers = CommitInputTrailers {
            supersedes: strings(&["aabbccdd"]),
            depends_on: strings(&["11223344"]),
            ..CommitInputTrailers::default()
        };

        let issues = f.builder().validate(&with_trailers("test", trailers));

        assert!(filter(&issues, "invalid-lore-id-ref").is_empty());
    }

    #[test]
    fn should_check_required_trailers_from_config() {
        let f = Fixture::with_config(required(&["Confidence", "Constraint"], false));

        let issues = f.builder().validate(&input("test"));

        let required_issues = filter(&issues, "required-trailer");
        assert_eq!(required_issues.len(), 2);
        assert_eq!(required_issues[0].severity, Severity::Warning);
        assert_eq!(
            required_issues[0].message,
            "Required trailer \"Confidence\" is missing"
        );
    }

    #[test]
    fn should_error_on_missing_required_trailers_in_strict_mode() {
        let f = Fixture::with_config(required(&["Confidence"], true));

        let issues = f.builder().validate(&input("test"));

        let required_issues = filter(&issues, "required-trailer");
        assert_eq!(required_issues[0].severity, Severity::Error);
    }

    #[test]
    fn should_warn_when_message_exceeds_max_lines() {
        let f = Fixture::new();
        let long_body = (1..=60)
            .map(|i| format!("Line {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let input = CommitInput {
            intent: "test".to_owned(),
            body: Some(long_body),
            trailers: None,
        };

        let issues = f.builder().validate(&input);

        let issue = find(&issues, "message-length").expect("message-length issue");
        assert_eq!(issue.severity, Severity::Warning);
        // 1 intent + 1 blank + 60 body + 1 blank = 63 (no trailers object)
        assert_eq!(issue.message, "Message exceeds 50 lines (estimated 63)");
    }

    #[test]
    fn should_not_warn_when_message_is_within_line_limit() {
        let f = Fixture::new();
        let input = CommitInput {
            intent: "test".to_owned(),
            body: Some("Short body.".to_owned()),
            trailers: None,
        };

        let issues = f.builder().validate(&input);

        assert!(find(&issues, "message-length").is_none());
    }

    #[test]
    fn should_pass_with_valid_required_trailer_present() {
        let f = Fixture::with_config(required(&["Confidence"], false));

        let issues = f
            .builder()
            .validate(&with_trailers("test", confidence("medium")));

        assert!(filter(&issues, "required-trailer").is_empty());
    }

    #[test]
    fn should_report_missing_required_custom_trailer() {
        let f = Fixture::with_config(required(&["Assisted-by"], true));

        let issues = f
            .builder()
            .validate(&with_trailers("test", confidence("high")));

        let required_issues = filter(&issues, "required-trailer");
        assert_eq!(required_issues.len(), 1);
        assert!(required_issues[0].message.contains("Assisted-by"));
        assert_eq!(required_issues[0].severity, Severity::Error);
    }

    #[test]
    fn should_not_report_missing_required_trailer_when_custom_trailer_is_present() {
        let f = Fixture::with_config(required(&["Assisted-by"], true));
        let trailers = CommitInputTrailers {
            confidence: Some("high".to_owned()),
            custom: Some(custom(&[("Assisted-by", &["Gemini:CLI"])])),
            ..CommitInputTrailers::default()
        };

        let issues = f.builder().validate(&with_trailers("test", trailers));

        assert!(filter(&issues, "required-trailer").is_empty());
    }

    #[test]
    fn line_estimate_counts_trailer_lines_and_custom_trailers() {
        let config = LoreConfig {
            validation: ValidationConfig {
                max_message_lines: 5,
                ..ValidationConfig::default()
            },
            ..LoreConfig::default()
        };
        let f = Fixture::with_config(config);
        let trailers = CommitInputTrailers {
            constraint: strings(&["a", "b"]),
            confidence: Some("high".to_owned()),
            custom: Some(custom(&[("Ticket", &["X-1"])])),
            ..CommitInputTrailers::default()
        };

        let issues = f.builder().validate(&with_trailers("test", trailers));

        // 1 intent + 1 blank + 1 Lore-id + 2 constraints + 1 enum + 1 custom = 7
        let issue = find(&issues, "message-length").expect("message-length issue");
        assert_eq!(issue.message, "Message exceeds 5 lines (estimated 7)");
    }
}
