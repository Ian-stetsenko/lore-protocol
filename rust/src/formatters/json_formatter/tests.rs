//! Port of `tests/unit/formatters/json-formatter.test.ts`.

use std::collections::HashMap;

use serde_json::{json, Map, Value};

use super::JsonFormatter;
use crate::interfaces::output_formatter::{ErrorMessage, OutputFormatter};
use crate::test_support::atom;
use crate::types::domain::{
    ConfidenceLevel, LoreAtom, ScopeRiskLevel, SupersessionStatus, TrailerKey,
};
use crate::types::output::{
    CommitValidationResult, DoctorCheck, DoctorStatus, DoctorSummary, FormattableDoctorResult,
    FormattableQueryResult, FormattableStalenessResult, FormattableTraceResult,
    FormattableValidationResult, Severity, StaleAtomReport, StaleReason, StaleSignal, TraceEdge,
    ValidationIssue, ValidationSummary, VisibleTrailers,
};
use crate::types::query::{QueryMeta, QueryResult, ResultTargetType, TargetType};

fn formatter() -> JsonFormatter {
    JsonFormatter::new()
}

fn parse(output: &str) -> Value {
    serde_json::from_str(output).expect("output must be valid JSON")
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

// ---------------------------------------------------------------------------
// formatQueryResult
// ---------------------------------------------------------------------------
mod format_query_result {
    use super::*;

    #[test]
    fn should_produce_valid_json_with_lore_version() {
        let data = query(
            "context",
            vec![atom().build()],
            1,
            1,
            HashMap::new(),
            VisibleTrailers::All,
        );

        let output = formatter().format_query_result(&data);
        let parsed = parse(&output);

        assert_eq!(parsed["lore_version"], "1.0");
        assert_eq!(parsed["command"], "context");
        assert_eq!(parsed["target"], "src/auth.ts");
        assert_eq!(parsed["target_type"], "file");
    }

    #[test]
    fn should_use_snake_case_field_names() {
        let data = query(
            "context",
            vec![atom().build()],
            5,
            1,
            HashMap::new(),
            VisibleTrailers::All,
        );

        let output = formatter().format_query_result(&data);
        let parsed = parse(&output);

        assert_eq!(parsed["meta"]["total_atoms"], 5);
        assert_eq!(parsed["meta"]["filtered_atoms"], 1);
        assert_eq!(parsed["results"][0]["lore_id"], "a1b2c3d4");
        assert_eq!(parsed["results"][0]["commit"], "abc1234567890");
        assert_eq!(
            parsed["results"][0]["files_changed"],
            json!(["src/auth.ts"])
        );
    }

    #[test]
    fn should_format_dates_as_iso_strings() {
        let data = query(
            "context",
            vec![atom().date("2025-06-15T14:30:00Z").build()],
            1,
            1,
            HashMap::new(),
            VisibleTrailers::All,
        );

        let output = formatter().format_query_result(&data);
        let parsed = parse(&output);

        assert_eq!(parsed["results"][0]["date"], "2025-06-15T14:30:00.000Z");
        assert_eq!(parsed["meta"]["oldest"], "2025-06-15T14:30:00.000Z");
    }

    #[test]
    fn should_include_supersession_status() {
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
        let parsed = parse(&output);

        assert_eq!(parsed["results"][0]["superseded"], true);
        assert_eq!(parsed["results"][0]["superseded_by"], "e5f6a7b8");
    }

    #[test]
    fn should_report_active_atoms_as_not_superseded_with_null_superseded_by() {
        let data = query(
            "context",
            vec![atom().build()],
            1,
            1,
            HashMap::new(),
            VisibleTrailers::All,
        );

        let parsed = parse(&formatter().format_query_result(&data));

        assert_eq!(parsed["results"][0]["superseded"], false);
        assert_eq!(parsed["results"][0]["superseded_by"], Value::Null);
    }

    #[test]
    fn should_filter_visible_trailers_in_json_output() {
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
        let parsed = parse(&output);

        let trailers = &parsed["results"][0]["trailers"];
        assert_eq!(trailers["constraint"], json!(["Must use OAuth2"]));
        assert!(trailers.get("confidence").is_none());
        assert!(trailers.get("rejected").is_none());
    }

    #[test]
    fn should_handle_empty_atoms_list() {
        let data = query(
            "context",
            vec![],
            0,
            0,
            HashMap::new(),
            VisibleTrailers::All,
        );

        let output = formatter().format_query_result(&data);
        let parsed = parse(&output);

        assert_eq!(parsed["results"], json!([]));
        assert_eq!(parsed["meta"]["oldest"], Value::Null);
        assert_eq!(parsed["meta"]["newest"], Value::Null);
    }

    #[test]
    fn should_convert_trailer_keys_to_snake_case() {
        let a = atom()
            .scope_risk(ScopeRiskLevel::Wide)
            .not_tested(&["edge cases"])
            .depends_on(&["aabbccdd"])
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
        let parsed = parse(&output);

        let trailers = &parsed["results"][0]["trailers"];
        assert_eq!(trailers["scope_risk"], "wide");
        assert_eq!(trailers["not_tested"], json!(["edge cases"]));
        assert_eq!(trailers["depends_on"], json!(["aabbccdd"]));
    }

    #[test]
    fn should_include_custom_trailers_with_snake_case_keys() {
        let custom = [
            ("Ticket".to_owned(), vec!["PROJ-1".to_owned()]),
            (
                "Assisted-By".to_owned(),
                vec!["Claude".to_owned(), "Copilot".to_owned()],
            ),
        ]
        .into_iter()
        .collect();
        let a = atom().constraint(&["c"]).custom(custom).build();
        let data = query(
            "context",
            vec![a],
            1,
            1,
            HashMap::new(),
            VisibleTrailers::All,
        );

        let parsed = parse(&formatter().format_query_result(&data));
        let trailers = parsed["results"][0]["trailers"]
            .as_object()
            .expect("trailers object");

        assert_eq!(trailers["ticket"], json!(["PROJ-1"]));
        assert_eq!(trailers["assisted_by"], json!(["Claude", "Copilot"]));
        let keys: Vec<&String> = trailers.keys().collect();
        assert_eq!(keys, ["lore_id", "constraint", "ticket", "assisted_by"]);
    }

    #[test]
    fn should_emit_top_level_keys_in_ts_order() {
        let data = query(
            "context",
            vec![atom().build()],
            1,
            1,
            HashMap::new(),
            VisibleTrailers::All,
        );

        let parsed = parse(&formatter().format_query_result(&data));
        let keys: Vec<&String> = parsed.as_object().expect("object").keys().collect();
        assert_eq!(
            keys,
            [
                "lore_version",
                "command",
                "target",
                "target_type",
                "meta",
                "results"
            ]
        );

        let result_keys: Vec<&String> = parsed["results"][0]
            .as_object()
            .expect("result object")
            .keys()
            .collect();
        assert_eq!(
            result_keys,
            [
                "lore_id",
                "commit",
                "date",
                "author",
                "intent",
                "body",
                "trailers",
                "files_changed",
                "superseded",
                "superseded_by"
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
    fn should_produce_valid_json_with_correct_structure() {
        let data = FormattableValidationResult {
            valid: true,
            summary: ValidationSummary {
                errors: 0,
                warnings: 0,
                commits_checked: 2,
            },
            results: vec![
                CommitValidationResult {
                    commit: "abc123".to_owned(),
                    lore_id: Some("a1b2c3d4".to_owned()),
                    valid: true,
                    issues: vec![],
                },
                CommitValidationResult {
                    commit: "def456".to_owned(),
                    lore_id: Some("e5f6a7b8".to_owned()),
                    valid: true,
                    issues: vec![],
                },
            ],
        };

        let output = formatter().format_validation_result(&data);
        let parsed = parse(&output);

        assert_eq!(parsed["lore_version"], "1.0");
        assert_eq!(parsed["valid"], true);
        assert_eq!(parsed["summary"]["commits_checked"], 2);
        assert_eq!(parsed["results"].as_array().map(Vec::len), Some(2));
        assert_eq!(parsed["results"][0]["lore_id"], "a1b2c3d4");
    }

    #[test]
    fn should_include_issues_in_results() {
        let data = FormattableValidationResult {
            valid: false,
            summary: ValidationSummary {
                errors: 1,
                warnings: 0,
                commits_checked: 1,
            },
            results: vec![CommitValidationResult {
                commit: "abc123".to_owned(),
                lore_id: None,
                valid: false,
                issues: vec![ValidationIssue::error("lore-id-present", "Missing Lore-id")],
            }],
        };

        let output = formatter().format_validation_result(&data);
        let parsed = parse(&output);

        assert_eq!(parsed["results"][0]["lore_id"], Value::Null);
        assert_eq!(parsed["results"][0]["issues"][0]["severity"], "error");
        assert_eq!(parsed["results"][0]["issues"][0]["rule"], "lore-id-present");
    }
}

// ---------------------------------------------------------------------------
// formatStalenessResult
// ---------------------------------------------------------------------------
mod format_staleness_result {
    use super::*;

    #[test]
    fn should_produce_valid_json_with_stale_atoms() {
        let data = FormattableStalenessResult {
            atoms: vec![StaleAtomReport {
                atom: atom().build(),
                reasons: vec![
                    StaleReason {
                        signal: StaleSignal::Age,
                        description: "Too old".to_owned(),
                    },
                    StaleReason {
                        signal: StaleSignal::LowConfidence,
                        description: "Low confidence".to_owned(),
                    },
                ],
            }],
        };

        let output = formatter().format_staleness_result(&data);
        let parsed = parse(&output);

        assert_eq!(parsed["lore_version"], "1.0");
        assert_eq!(parsed["stale_atoms"].as_array().map(Vec::len), Some(1));
        assert_eq!(parsed["stale_atoms"][0]["lore_id"], "a1b2c3d4");
        assert_eq!(parsed["stale_atoms"][0]["date"], "2025-01-15T10:00:00.000Z");
        assert_eq!(
            parsed["stale_atoms"][0]["reasons"],
            json!([
                { "signal": "age", "description": "Too old" },
                { "signal": "low-confidence", "description": "Low confidence" },
            ])
        );
    }

    #[test]
    fn should_produce_empty_array_when_no_stale_atoms() {
        let data = FormattableStalenessResult { atoms: vec![] };
        let output = formatter().format_staleness_result(&data);
        let parsed = parse(&output);

        assert_eq!(parsed["stale_atoms"], json!([]));
    }
}

// ---------------------------------------------------------------------------
// formatTraceResult
// ---------------------------------------------------------------------------
mod format_trace_result {
    use super::*;

    #[test]
    fn should_produce_valid_json_with_root_and_edges() {
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
        let parsed = parse(&output);

        assert_eq!(parsed["lore_version"], "1.0");
        assert_eq!(parsed["root"]["lore_id"], "aaaabbbb");
        assert_eq!(parsed["edges"].as_array().map(Vec::len), Some(2));
        assert_eq!(parsed["edges"][0]["resolved"], true);
        assert_eq!(parsed["edges"][0]["relationship"], "Related");
        assert_eq!(parsed["edges"][0]["target_atom"]["lore_id"], "ccccdddd");
        assert_eq!(parsed["edges"][1]["resolved"], false);
        assert_eq!(parsed["edges"][1]["relationship"], "Supersedes");
        assert_eq!(parsed["edges"][1]["target_atom"], Value::Null);
    }
}

// ---------------------------------------------------------------------------
// formatDoctorResult
// ---------------------------------------------------------------------------
mod format_doctor_result {
    use super::*;

    #[test]
    fn should_produce_valid_json_with_checks_and_summary() {
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
            ],
            summary: DoctorSummary {
                errors: 0,
                warnings: 1,
                info: 0,
            },
        };

        let output = formatter().format_doctor_result(&data);
        let parsed = parse(&output);

        assert_eq!(parsed["lore_version"], "1.0");
        assert_eq!(parsed["checks"].as_array().map(Vec::len), Some(2));
        assert_eq!(parsed["checks"][0]["name"], "git-version");
        assert_eq!(parsed["checks"][0]["status"], "ok");
        assert_eq!(parsed["checks"][1]["details"], json!(["Using defaults"]));
        assert_eq!(parsed["summary"]["warnings"], 1);
    }
}

// ---------------------------------------------------------------------------
// formatSuccess
// ---------------------------------------------------------------------------
mod format_success {
    use super::*;

    #[test]
    fn should_produce_valid_json_with_success_flag() {
        let mut extra = Map::new();
        extra.insert("lore_id".to_owned(), json!("a1b2c3d4"));

        let output = formatter().format_success("Commit created", Some(&extra));
        let parsed = parse(&output);

        assert_eq!(parsed["lore_version"], "1.0");
        assert_eq!(parsed["success"], true);
        assert_eq!(parsed["message"], "Commit created");
        assert_eq!(parsed["lore_id"], "a1b2c3d4");

        let keys: Vec<&String> = parsed.as_object().expect("object").keys().collect();
        assert_eq!(keys, ["lore_version", "success", "message", "lore_id"]);
    }

    #[test]
    fn should_work_without_extra_data() {
        let output = formatter().format_success("Done", None);
        let parsed = parse(&output);

        assert_eq!(parsed["success"], true);
        assert_eq!(parsed["message"], "Done");
    }
}

// ---------------------------------------------------------------------------
// formatError
// ---------------------------------------------------------------------------
mod format_error {
    use super::*;

    #[test]
    fn should_produce_valid_json_with_error_details() {
        let output = formatter().format_error(
            1,
            &[
                error_message(Severity::Error, None, "Validation failed"),
                error_message(Severity::Warning, Some("intent"), "Too long"),
            ],
        );
        let parsed = parse(&output);

        assert_eq!(parsed["lore_version"], "1.0");
        assert_eq!(parsed["error"], true);
        assert_eq!(parsed["code"], 1);
        assert_eq!(parsed["messages"].as_array().map(Vec::len), Some(2));
        assert_eq!(parsed["messages"][0]["severity"], "error");
        assert_eq!(parsed["messages"][0]["field"], Value::Null);
        assert_eq!(parsed["messages"][1]["field"], "intent");
    }

    #[test]
    fn should_include_all_validation_issue_details_in_json_output() {
        let output = formatter().format_error(
            1,
            &[
                ErrorMessage::error("Required trailer \"Assisted-by\" is missing"),
                ErrorMessage::warning("Intent exceeds 72 characters"),
            ],
        );
        let parsed = parse(&output);

        assert_eq!(parsed["messages"].as_array().map(Vec::len), Some(2));
        assert_eq!(
            parsed["messages"][0]["message"],
            "Required trailer \"Assisted-by\" is missing"
        );
        assert_eq!(parsed["messages"][0]["severity"], "error");
        assert_eq!(
            parsed["messages"][1]["message"],
            "Intent exceeds 72 characters"
        );
        assert_eq!(parsed["messages"][1]["severity"], "warning");
    }
}

// ---------------------------------------------------------------------------
// JSON format validity
// ---------------------------------------------------------------------------
mod json_format_validity {
    use super::*;

    #[test]
    fn should_always_produce_well_formed_json_with_2_space_indentation() {
        let data = FormattableValidationResult {
            valid: true,
            summary: ValidationSummary::default(),
            results: vec![],
        };

        let output = formatter().format_validation_result(&data);
        // Should be parseable
        assert!(serde_json::from_str::<Value>(&output).is_ok());
        // Should be indented
        assert!(output.contains("\n  "));
        // Exact JSON.stringify(x, null, 2) rendering.
        assert_eq!(
            output,
            "{\n  \"lore_version\": \"1.0\",\n  \"valid\": true,\n  \"summary\": {\n    \"errors\": 0,\n    \"warnings\": 0,\n    \"commits_checked\": 0\n  },\n  \"results\": []\n}"
        );
    }
}
