//! Port of `tests/unit/formatters/text-formatter.test.ts`, plus colour-on
//! cases asserting the exact chalk level-1 escape sequences.

use std::collections::HashMap;

use super::TextFormatter;
use crate::interfaces::output_formatter::{ErrorMessage, OutputFormatter};
use crate::test_support::atom;
use crate::types::domain::{ConfidenceLevel, LoreAtom, SupersessionStatus, TrailerKey};
use crate::types::output::{
    CommitValidationResult, DoctorCheck, DoctorStatus, DoctorSummary, FormattableDoctorResult,
    FormattableQueryResult, FormattableStalenessResult, FormattableTraceResult,
    FormattableValidationResult, Severity, StaleAtomReport, StaleReason, StaleSignal, TraceEdge,
    ValidationIssue, ValidationSummary, VisibleTrailers,
};
use crate::types::query::{QueryMeta, QueryResult, ResultTargetType, TargetType};

fn formatter() -> TextFormatter {
    TextFormatter::new(false)
}

fn colored() -> TextFormatter {
    TextFormatter::new(true)
}

/// A file-target query over `atoms` with the given meta totals.
fn query(
    command: &str,
    atoms: Vec<LoreAtom>,
    total: usize,
    filtered: usize,
    supersession_map: HashMap<String, SupersessionStatus>,
    visible_trailers: VisibleTrailers,
) -> FormattableQueryResult {
    let first_date = atoms.first().map(|a| a.date);
    FormattableQueryResult {
        result: QueryResult {
            command: command.to_owned(),
            target: "src/auth.ts".to_owned(),
            target_type: ResultTargetType::Target(TargetType::File),
            atoms,
            meta: QueryMeta {
                total_atoms: total,
                filtered_atoms: filtered,
                oldest: first_date,
                newest: first_date,
            },
        },
        supersession_map,
        visible_trailers,
    }
}

fn error_message(severity: Severity, field: Option<&str>, message: &str) -> ErrorMessage {
    ErrorMessage {
        severity,
        field: field.map(str::to_owned),
        message: message.to_owned(),
    }
}

fn has_ansi(s: &str) -> bool {
    s.contains("\x1b[")
}

// ---------------------------------------------------------------------------
// formatQueryResult
// ---------------------------------------------------------------------------
mod format_query_result {
    use super::*;

    #[test]
    fn should_show_no_lore_atoms_found_when_empty() {
        let data = query(
            "context",
            vec![],
            0,
            0,
            HashMap::new(),
            VisibleTrailers::All,
        );

        let output = formatter().format_query_result(&data);
        assert!(output.contains("No lore atoms found"));
        assert_eq!(output, "No lore atoms found.");
    }

    #[test]
    fn should_format_atoms_with_header_and_trailers() {
        let a = atom()
            .constraint(&["Must use OAuth2"])
            .confidence(ConfidenceLevel::High)
            .build();
        let data = query(
            "constraints",
            vec![a],
            1,
            1,
            HashMap::new(),
            VisibleTrailers::All,
        );

        let output = formatter().format_query_result(&data);
        assert!(output.contains("a1b2c3d4"));
        assert!(output.contains("2025-01-15"));
        assert!(output.contains("alice@example.com"));
        assert!(output.contains("Constraint:"));
        assert!(output.contains("Must use OAuth2"));
        assert!(output.contains("Confidence:"));
        assert!(output.contains("high"));
    }

    #[test]
    fn should_render_the_exact_layout_without_colour() {
        let a = atom()
            .constraint(&["Must use OAuth2"])
            .confidence(ConfidenceLevel::High)
            .build();
        let data = query(
            "constraints",
            vec![a],
            1,
            1,
            HashMap::new(),
            VisibleTrailers::All,
        );

        let output = formatter().format_query_result(&data);
        let header = "\u{2500}\u{2500} a1b2c3d4 (2025-01-15, alice@example.com) ";
        let rule = "\u{2500}".repeat(60 - header.chars().count());
        let expected = format!(
            "{header}{rule}\n  Constraint: Must use OAuth2\n  Confidence: high\n\n1 of 1 atoms shown"
        );
        assert_eq!(output, expected);
        let first_line = output.lines().next().unwrap_or_default();
        assert_eq!(first_line.chars().count(), 60);
    }

    #[test]
    fn should_not_pad_a_header_longer_than_60_chars() {
        let long_author = "a-very-long-author-address-that-overflows@example.com";
        let a = atom().author(long_author).build();
        let data = query(
            "context",
            vec![a],
            1,
            1,
            HashMap::new(),
            VisibleTrailers::All,
        );

        let output = formatter().format_query_result(&data);
        let header = format!("\u{2500}\u{2500} a1b2c3d4 (2025-01-15, {long_author}) ");
        assert!(header.chars().count() > 60);
        assert_eq!(output.lines().next(), Some(header.as_str()));
    }

    #[test]
    fn should_show_supersession_info_for_superseded_atoms() {
        let mut supersession_map = HashMap::new();
        supersession_map.insert(
            "a1b2c3d4".to_owned(),
            SupersessionStatus::superseded_by("e5f6a7b8"),
        );
        let data = query(
            "context",
            vec![atom().build()],
            1,
            1,
            supersession_map,
            VisibleTrailers::All,
        );

        let output = formatter().format_query_result(&data);
        assert!(output.contains("superseded by e5f6a7b8"));
        assert!(output.contains("\n  (superseded by e5f6a7b8)\n"));
    }

    #[test]
    fn should_filter_visible_trailers() {
        let a = atom()
            .constraint(&["Must use OAuth2"])
            .confidence(ConfidenceLevel::High)
            .rejected(&["Session tokens"])
            .build();
        let data = query(
            "constraints",
            vec![a],
            1,
            1,
            HashMap::new(),
            VisibleTrailers::Only(vec![TrailerKey::Constraint]),
        );

        let output = formatter().format_query_result(&data);
        assert!(output.contains("Constraint:"));
        assert!(output.contains("Must use OAuth2"));
        assert!(!output.contains("Confidence:"));
        assert!(!output.contains("Rejected:"));
    }

    #[test]
    fn should_show_body_text_when_present() {
        let a = atom().body("Detailed explanation here.").build();
        let data = query(
            "context",
            vec![a],
            1,
            1,
            HashMap::new(),
            VisibleTrailers::All,
        );

        let output = formatter().format_query_result(&data);
        assert!(output.contains("Detailed explanation here."));
        assert!(output.contains("\n  Detailed explanation here.\n"));
    }

    #[test]
    fn should_show_meta_summary_at_bottom() {
        let data = query(
            "context",
            vec![atom().build()],
            5,
            1,
            HashMap::new(),
            VisibleTrailers::All,
        );

        let output = formatter().format_query_result(&data);
        assert!(output.contains("1 of 5 atoms shown"));
        assert!(output.ends_with("\n\n1 of 5 atoms shown"));
    }

    #[test]
    fn should_list_every_trailer_kind_in_protocol_order() {
        let a = atom()
            .constraint(&["c1", "c2"])
            .rejected(&["r1"])
            .confidence(ConfidenceLevel::Low)
            .scope_risk(crate::types::domain::ScopeRiskLevel::Wide)
            .reversibility(crate::types::domain::ReversibilityLevel::MigrationNeeded)
            .directive(&["d1"])
            .tested(&["t1"])
            .not_tested(&["n1"])
            .supersedes(&["11111111"])
            .depends_on(&["22222222"])
            .related(&["33333333"])
            .build();
        let data = query(
            "context",
            vec![a],
            1,
            1,
            HashMap::new(),
            VisibleTrailers::All,
        );

        let output = formatter().format_query_result(&data);
        let trailer_lines: Vec<&str> = output.lines().skip(1).take(12).collect();
        assert_eq!(
            trailer_lines,
            [
                "  Constraint: c1",
                "  Constraint: c2",
                "  Rejected: r1",
                "  Confidence: low",
                "  Scope-risk: wide",
                "  Reversibility: migration-needed",
                "  Directive: d1",
                "  Tested: t1",
                "  Not-tested: n1",
                "  Supersedes: 11111111",
                "  Depends-on: 22222222",
                "  Related: 33333333",
            ]
        );
    }
}

// ---------------------------------------------------------------------------
// formatValidationResult
// ---------------------------------------------------------------------------
mod format_validation_result {
    use super::*;

    #[test]
    fn should_show_checkmark_for_valid_commits() {
        let data = FormattableValidationResult {
            valid: true,
            summary: ValidationSummary {
                errors: 0,
                warnings: 0,
                commits_checked: 1,
            },
            results: vec![CommitValidationResult {
                commit: "abc1234567890".to_owned(),
                lore_id: Some("a1b2c3d4".to_owned()),
                valid: true,
                issues: vec![],
            }],
        };

        let output = formatter().format_validation_result(&data);
        assert!(output.contains('\u{2713}'));
        assert!(output.contains("a1b2c3d4"));
        assert!(output.contains("all valid"));
        assert_eq!(output, "\u{2713} a1b2c3d4\n\n1 commits checked, all valid");
    }

    #[test]
    fn should_show_x_marks_for_invalid_commits() {
        let data = FormattableValidationResult {
            valid: false,
            summary: ValidationSummary {
                errors: 1,
                warnings: 1,
                commits_checked: 1,
            },
            results: vec![CommitValidationResult {
                commit: "abc1234567890".to_owned(),
                lore_id: None,
                valid: false,
                issues: vec![
                    ValidationIssue::error("lore-id-present", "Lore-id trailer is missing"),
                    ValidationIssue::warning("intent-length", "Intent too long"),
                ],
            }],
        };

        let output = formatter().format_validation_result(&data);
        assert!(output.contains('\u{2717}'));
        assert!(output.contains("lore-id-present"));
        assert!(output.contains("Lore-id trailer is missing"));
        assert!(output.contains('\u{26A0}'));
        assert!(output.contains("Intent too long"));
        assert!(output.contains("1 errors"));
        assert!(output.contains("1 warnings"));
        assert_eq!(
            output,
            "\u{2717} abc12345\n  \u{2717} [lore-id-present] Lore-id trailer is missing\n  \u{26A0} [intent-length] Intent too long\n\n1 commits checked, 1 errors, 1 warnings"
        );
    }

    #[test]
    fn should_use_commit_hash_prefix_when_no_lore_id() {
        let data = FormattableValidationResult {
            valid: false,
            summary: ValidationSummary {
                errors: 1,
                warnings: 0,
                commits_checked: 1,
            },
            results: vec![CommitValidationResult {
                commit: "abc1234567890".to_owned(),
                lore_id: None,
                valid: false,
                issues: vec![ValidationIssue::error("lore-id-present", "Missing Lore-id")],
            }],
        };

        let output = formatter().format_validation_result(&data);
        assert!(output.contains("abc12345"));
        assert!(!output.contains("abc123456"));
    }
}

// ---------------------------------------------------------------------------
// formatStalenessResult
// ---------------------------------------------------------------------------
mod format_staleness_result {
    use super::*;

    #[test]
    fn should_show_message_when_no_stale_atoms() {
        let data = FormattableStalenessResult { atoms: vec![] };
        let output = formatter().format_staleness_result(&data);
        assert!(output.contains("No stale atoms found"));
        assert_eq!(output, "No stale atoms found.");
    }

    #[test]
    fn should_show_stale_label_with_reasons() {
        let data = FormattableStalenessResult {
            atoms: vec![StaleAtomReport {
                atom: atom().build(),
                reasons: vec![
                    StaleReason {
                        signal: StaleSignal::Age,
                        description: "Older than 6 months".to_owned(),
                    },
                    StaleReason {
                        signal: StaleSignal::LowConfidence,
                        description: "Low confidence".to_owned(),
                    },
                ],
            }],
        };

        let output = formatter().format_staleness_result(&data);
        assert!(output.contains("STALE"));
        assert!(output.contains("a1b2c3d4"));
        assert!(output.contains("2025-01-15"));
        assert!(output.contains("Older than 6 months"));
        assert!(output.contains("Low confidence"));
        assert_eq!(
            output,
            "STALE  a1b2c3d4 (2025-01-15)\n  feat(auth): add login flow\n  \u{26A0} Older than 6 months\n  \u{26A0} Low confidence\n"
        );
    }
}

// ---------------------------------------------------------------------------
// formatTraceResult
// ---------------------------------------------------------------------------
mod format_trace_result {
    use super::*;

    #[test]
    fn should_show_root_and_edges_with_tree_characters() {
        let root = atom().id("aaaabbbb").build();
        let target_atom = atom().id("ccccdddd").intent("related change").build();
        let data = FormattableTraceResult {
            root,
            edges: vec![
                TraceEdge {
                    from: "aaaabbbb".to_owned(),
                    to: "ccccdddd".to_owned(),
                    relationship: TrailerKey::Related,
                    target_atom: Some(target_atom),
                },
                TraceEdge {
                    from: "aaaabbbb".to_owned(),
                    to: "eeeeffff".to_owned(),
                    relationship: TrailerKey::Supersedes,
                    target_atom: None,
                },
            ],
        };

        let output = formatter().format_trace_result(&data);
        assert!(output.contains("aaaabbbb"));
        assert!(output.contains("\u{251C}\u{2500}\u{2500}"));
        assert!(output.contains("[Related]"));
        assert!(output.contains("ccccdddd"));
        assert!(output.contains("related change"));
        assert!(output.contains("\u{2514}\u{2500}\u{2500}"));
        assert!(output.contains("[Supersedes]"));
        assert!(output.contains("eeeeffff"));
        assert!(output.contains("(unresolved)"));
        assert_eq!(
            output,
            "aaaabbbb feat(auth): add login flow\n\u{251C}\u{2500}\u{2500} [Related] ccccdddd related change\n\u{2514}\u{2500}\u{2500} [Supersedes] eeeeffff (unresolved)"
        );
    }

    #[test]
    fn should_use_last_item_connector_for_single_edge() {
        let root = atom().id("aaaabbbb").build();
        let data = FormattableTraceResult {
            root,
            edges: vec![TraceEdge {
                from: "aaaabbbb".to_owned(),
                to: "ccccdddd".to_owned(),
                relationship: TrailerKey::DependsOn,
                target_atom: None,
            }],
        };

        let output = formatter().format_trace_result(&data);
        assert!(output.contains("\u{2514}\u{2500}\u{2500}"));
        assert!(!output.contains("\u{251C}\u{2500}\u{2500}"));
        assert!(output.contains("[Depends-on]"));
    }
}

// ---------------------------------------------------------------------------
// formatDoctorResult
// ---------------------------------------------------------------------------
mod format_doctor_result {
    use super::*;

    #[test]
    fn should_show_check_statuses_with_colors() {
        let data = FormattableDoctorResult {
            checks: vec![
                DoctorCheck {
                    name: "git-version".to_owned(),
                    status: DoctorStatus::Ok,
                    message: "Git 2.40+ detected".to_owned(),
                    details: vec![],
                },
                DoctorCheck {
                    name: "config".to_owned(),
                    status: DoctorStatus::Warning,
                    message: "No config found".to_owned(),
                    details: vec!["Using defaults".to_owned()],
                },
                DoctorCheck {
                    name: "duplicates".to_owned(),
                    status: DoctorStatus::Error,
                    message: "2 duplicate Lore-ids".to_owned(),
                    details: vec!["a1b2c3d4".to_owned(), "e5f6a7b8".to_owned()],
                },
            ],
            summary: DoctorSummary {
                errors: 1,
                warnings: 1,
                info: 0,
            },
        };

        let output = formatter().format_doctor_result(&data);
        assert!(output.contains("OK"));
        assert!(output.contains("git-version"));
        assert!(output.contains("WARNING"));
        assert!(output.contains("No config found"));
        assert!(output.contains("Using defaults"));
        assert!(output.contains("ERROR"));
        assert!(output.contains("2 duplicate Lore-ids"));
        assert!(output.contains("1 errors"));
        assert!(output.contains("1 warnings"));
        assert_eq!(
            output,
            "OK  git-version: Git 2.40+ detected\nWARNING  config: No config found\n  Using defaults\nERROR  duplicates: 2 duplicate Lore-ids\n  a1b2c3d4\n  e5f6a7b8\n\n1 errors, 1 warnings"
        );
    }

    #[test]
    fn should_show_all_checks_passed_when_no_issues() {
        let data = FormattableDoctorResult {
            checks: vec![DoctorCheck {
                name: "git-version".to_owned(),
                status: DoctorStatus::Ok,
                message: "OK".to_owned(),
                details: vec![],
            }],
            summary: DoctorSummary::default(),
        };

        let output = formatter().format_doctor_result(&data);
        assert!(output.contains("all checks passed"));
        assert_eq!(output, "OK  git-version: OK\n\nall checks passed");
    }

    #[test]
    fn should_show_info_status_and_count() {
        let data = FormattableDoctorResult {
            checks: vec![DoctorCheck {
                name: "hooks".to_owned(),
                status: DoctorStatus::Info,
                message: "No hooks installed".to_owned(),
                details: vec![],
            }],
            summary: DoctorSummary {
                errors: 0,
                warnings: 0,
                info: 1,
            },
        };

        let output = formatter().format_doctor_result(&data);
        assert_eq!(output, "INFO  hooks: No hooks installed\n\n1 info");
    }
}

// ---------------------------------------------------------------------------
// formatSuccess
// ---------------------------------------------------------------------------
mod format_success {
    use super::*;

    #[test]
    fn should_return_the_message() {
        let output = formatter().format_success("Commit created: a1b2c3d4", None);
        assert!(output.contains("Commit created: a1b2c3d4"));
        assert_eq!(output, "Commit created: a1b2c3d4");
    }

    #[test]
    fn should_ignore_extra_data() {
        let mut extra = serde_json::Map::new();
        extra.insert("lore_id".to_owned(), serde_json::json!("a1b2c3d4"));
        let output = formatter().format_success("Done", Some(&extra));
        assert_eq!(output, "Done");
    }
}

// ---------------------------------------------------------------------------
// formatError
// ---------------------------------------------------------------------------
mod format_error {
    use super::*;

    #[test]
    fn should_show_error_messages_with_severity() {
        let output = formatter().format_error(
            1,
            &[
                error_message(Severity::Error, None, "Something went wrong"),
                error_message(Severity::Warning, Some("intent"), "Too long"),
            ],
        );

        assert!(output.contains("error"));
        assert!(output.contains("Something went wrong"));
        assert!(output.contains("warning"));
        assert!(output.contains("[intent]"));
        assert!(output.contains("Too long"));
        assert!(output.contains("exit code 1"));
        assert_eq!(
            output,
            "error: Something went wrong\nwarning [intent]: Too long\n(exit code 1)"
        );
    }

    #[test]
    fn should_show_each_validation_issue_individually() {
        let output = formatter().format_error(
            1,
            &[
                ErrorMessage::error("Required trailer \"Assisted-by\" is missing"),
                ErrorMessage::error("Required trailer \"Ticket\" is missing"),
                ErrorMessage::warning("Intent exceeds 72 characters"),
            ],
        );

        assert!(output.contains("Required trailer \"Assisted-by\" is missing"));
        assert!(output.contains("Required trailer \"Ticket\" is missing"));
        assert!(output.contains("Intent exceeds 72 characters"));
    }

    #[test]
    fn should_not_show_exit_code_when_code_is_0() {
        let output =
            formatter().format_error(0, &[error_message(Severity::Warning, None, "Minor issue")]);

        assert!(!output.contains("exit code"));
        assert_eq!(output, "warning: Minor issue");
    }
}

// ---------------------------------------------------------------------------
// color support
// ---------------------------------------------------------------------------
mod color_support {
    use super::*;

    #[test]
    fn should_produce_output_with_color_disabled() {
        let no_color = TextFormatter::new(false);
        let output = no_color.format_success("OK", None);
        // With chalk level 0, no ANSI codes
        assert!(!has_ansi(&output));
    }

    #[test]
    fn should_wrap_success_in_green_when_color_enabled() {
        let output = colored().format_success("Commit created", None);
        assert_eq!(output, "\x1b[32mCommit created\x1b[39m");
    }

    #[test]
    fn should_emit_chalk_level_1_codes_for_error_output() {
        let output = colored().format_error(
            2,
            &[
                error_message(Severity::Error, None, "boom"),
                error_message(Severity::Warning, Some("intent"), "meh"),
            ],
        );
        assert_eq!(
            output,
            "\x1b[31merror\x1b[39m: boom\n\x1b[33mwarning\x1b[39m [intent]: meh\n\x1b[2m(exit code 2)\x1b[22m"
        );
    }

    #[test]
    fn should_bold_the_header_and_colour_trailer_labels() {
        let a = atom()
            .constraint(&["c"])
            .rejected(&["r"])
            .confidence(ConfidenceLevel::High)
            .directive(&["d"])
            .tested(&["t"])
            .not_tested(&["n"])
            .related(&["11111111"])
            .body("why")
            .build();
        let data = query(
            "context",
            vec![a],
            3,
            1,
            HashMap::new(),
            VisibleTrailers::All,
        );

        let output = colored().format_query_result(&data);
        let header = "\u{2500}\u{2500} a1b2c3d4 (2025-01-15, alice@example.com) ";
        let rule = "\u{2500}".repeat(60 - header.chars().count());
        let expected = format!(
            "\x1b[1m{header}{rule}\x1b[22m\n  \x1b[2mwhy\x1b[22m\n  \x1b[36mConstraint:\x1b[39m c\n  \x1b[35mRejected:\x1b[39m r\n  \x1b[36mConfidence:\x1b[39m high\n  \x1b[33mDirective:\x1b[39m d\n  \x1b[32mTested:\x1b[39m t\n  \x1b[31mNot-tested:\x1b[39m n\n  \x1b[2mRelated:\x1b[22m 11111111\n\n\x1b[2m1 of 3 atoms shown\x1b[22m"
        );
        assert_eq!(output, expected);
    }

    #[test]
    fn should_nest_dim_and_strikethrough_for_superseded_headers() {
        let mut supersession_map = HashMap::new();
        supersession_map.insert(
            "a1b2c3d4".to_owned(),
            SupersessionStatus::superseded_by("e5f6a7b8"),
        );
        let data = query(
            "context",
            vec![atom().build()],
            1,
            1,
            supersession_map,
            VisibleTrailers::All,
        );

        let output = colored().format_query_result(&data);
        let header = "\u{2500}\u{2500} a1b2c3d4 (2025-01-15, alice@example.com) ";
        let rule = "\u{2500}".repeat(60 - header.chars().count());
        let expected = format!(
            "\x1b[2m\x1b[9m{header}{rule}\x1b[29m\x1b[22m\n\x1b[2m  (superseded by e5f6a7b8)\x1b[22m\n\n\x1b[2m1 of 1 atoms shown\x1b[22m"
        );
        assert_eq!(output, expected);
    }

    #[test]
    fn should_restyle_each_line_of_a_multiline_body_like_chalk() {
        let a = atom().body("first\nsecond").build();
        let data = query(
            "context",
            vec![a],
            1,
            1,
            HashMap::new(),
            VisibleTrailers::All,
        );

        let output = colored().format_query_result(&data);
        assert!(output.contains("  \x1b[2mfirst\x1b[22m\n\x1b[2msecond\x1b[22m\n"));
    }

    #[test]
    fn should_colour_validation_icons_and_summary() {
        let data = FormattableValidationResult {
            valid: false,
            summary: ValidationSummary {
                errors: 1,
                warnings: 1,
                commits_checked: 2,
            },
            results: vec![
                CommitValidationResult {
                    commit: "abc1234567890".to_owned(),
                    lore_id: Some("a1b2c3d4".to_owned()),
                    valid: true,
                    issues: vec![],
                },
                CommitValidationResult {
                    commit: "def4567890abc".to_owned(),
                    lore_id: None,
                    valid: false,
                    issues: vec![
                        ValidationIssue::error("lore-id-present", "missing"),
                        ValidationIssue::warning("intent-length", "long"),
                    ],
                },
            ],
        };

        let output = colored().format_validation_result(&data);
        assert_eq!(
            output,
            "\x1b[32m\u{2713}\x1b[39m a1b2c3d4\n\x1b[31m\u{2717}\x1b[39m def45678\n  \x1b[31m\u{2717}\x1b[39m [lore-id-present] missing\n  \x1b[33m\u{26A0}\x1b[39m [intent-length] long\n\n2 commits checked, \x1b[31m1 errors\x1b[39m, \x1b[33m1 warnings\x1b[39m"
        );
    }

    #[test]
    fn should_colour_stale_trace_and_doctor_output() {
        let stale = FormattableStalenessResult {
            atoms: vec![StaleAtomReport {
                atom: atom().build(),
                reasons: vec![StaleReason {
                    signal: StaleSignal::Drift,
                    description: "drifted".to_owned(),
                }],
            }],
        };
        assert_eq!(
            colored().format_staleness_result(&stale),
            "\x1b[33mSTALE\x1b[39m  \x1b[1ma1b2c3d4\x1b[22m (2025-01-15)\n  \x1b[2mfeat(auth): add login flow\x1b[22m\n  \x1b[33m\u{26A0}\x1b[39m drifted\n"
        );
        assert_eq!(
            colored().format_staleness_result(&FormattableStalenessResult { atoms: vec![] }),
            "\x1b[32mNo stale atoms found.\x1b[39m"
        );

        let trace = FormattableTraceResult {
            root: atom().id("aaaabbbb").build(),
            edges: vec![TraceEdge {
                from: "aaaabbbb".to_owned(),
                to: "eeeeffff".to_owned(),
                relationship: TrailerKey::Supersedes,
                target_atom: None,
            }],
        };
        assert_eq!(
            colored().format_trace_result(&trace),
            "\x1b[1maaaabbbb\x1b[22m \x1b[2mfeat(auth): add login flow\x1b[22m\n\u{2514}\u{2500}\u{2500} \x1b[2m[Supersedes]\x1b[22m \x1b[1meeeeffff\x1b[22m \x1b[2m(unresolved)\x1b[22m"
        );

        let doctor = FormattableDoctorResult {
            checks: vec![
                DoctorCheck {
                    name: "a".to_owned(),
                    status: DoctorStatus::Ok,
                    message: "fine".to_owned(),
                    details: vec!["detail".to_owned()],
                },
                DoctorCheck {
                    name: "b".to_owned(),
                    status: DoctorStatus::Info,
                    message: "fyi".to_owned(),
                    details: vec![],
                },
            ],
            summary: DoctorSummary {
                errors: 0,
                warnings: 0,
                info: 1,
            },
        };
        assert_eq!(
            colored().format_doctor_result(&doctor),
            "\x1b[32mOK\x1b[39m  a: fine\n  \x1b[2mdetail\x1b[22m\n\x1b[34mINFO\x1b[39m  b: fyi\n\n\x1b[34m1 info\x1b[39m"
        );
    }
}
