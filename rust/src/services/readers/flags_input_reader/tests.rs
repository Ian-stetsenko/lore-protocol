use super::*;

fn strings(values: &[&str]) -> Option<Vec<String>> {
    Some(values.iter().map(|s| s.to_string()).collect())
}

fn read(options: &CommitCommandOptions) -> CommitInput {
    FlagsInputReader::new(options)
        .read()
        .expect("flags never fail")
}

#[test]
fn should_map_all_cli_options_correctly() {
    let options = CommitCommandOptions {
        intent: Some("add feature X".into()),
        body: Some("Feature body text".into()),
        constraint: strings(&["must be fast", "no breaking changes"]),
        rejected: strings(&["approach A | too complex"]),
        confidence: Some("high".into()),
        scope_risk: Some("wide".into()),
        reversibility: Some("clean".into()),
        directive: strings(&["use new API"]),
        tested: strings(&["unit tests pass"]),
        not_tested: strings(&["load testing"]),
        supersedes: strings(&["abcd1234"]),
        depends_on: strings(&["dead0000"]),
        related: strings(&["beef1234"]),
        ..Default::default()
    };

    let result = read(&options);

    assert_eq!(result.intent, "add feature X");
    assert_eq!(result.body.as_deref(), Some("Feature body text"));
    let t = result.trailers.expect("trailers");
    assert_eq!(
        t.constraint,
        strings(&["must be fast", "no breaking changes"])
    );
    assert_eq!(t.rejected, strings(&["approach A | too complex"]));
    assert_eq!(t.confidence.as_deref(), Some("high"));
    assert_eq!(t.scope_risk.as_deref(), Some("wide"));
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
fn should_default_intent_to_empty_string_when_undefined() {
    assert_eq!(read(&CommitCommandOptions::default()).intent, "");
}

#[test]
fn should_leave_body_none_when_not_provided() {
    let options = CommitCommandOptions {
        intent: Some("test intent".into()),
        ..Default::default()
    };
    assert!(read(&options).body.is_none());
}

#[test]
fn should_leave_array_trailers_none_when_not_provided() {
    let options = CommitCommandOptions {
        intent: Some("test intent".into()),
        ..Default::default()
    };
    let t = read(&options).trailers.expect("trailers always present");
    assert!(t.constraint.is_none());
    assert!(t.rejected.is_none());
    assert!(t.directive.is_none());
    assert!(t.tested.is_none());
    assert!(t.not_tested.is_none());
    assert!(t.supersedes.is_none());
    assert!(t.depends_on.is_none());
    assert!(t.related.is_none());
}

#[test]
fn should_leave_enum_trailers_none_when_not_provided() {
    let options = CommitCommandOptions {
        intent: Some("test intent".into()),
        ..Default::default()
    };
    let t = read(&options).trailers.expect("trailers always present");
    assert!(t.confidence.is_none());
    assert!(t.scope_risk.is_none());
    assert!(t.reversibility.is_none());
}

#[test]
fn should_handle_only_intent_and_one_trailer() {
    let options = CommitCommandOptions {
        intent: Some("quick fix".into()),
        confidence: Some("low".into()),
        ..Default::default()
    };
    let result = read(&options);
    assert_eq!(result.intent, "quick fix");
    let t = result.trailers.expect("trailers");
    assert_eq!(t.confidence.as_deref(), Some("low"));
    assert!(t.constraint.is_none());
}
