use super::*;
use crate::test_support::{MockPrompt, PromptCall};

fn collector() -> MultiValueTrailerCollector {
    MultiValueTrailerCollector::new(TrailerKey::Constraint, "Add a Constraint?", "Constraint:")
}

fn multi(values: &[&str]) -> Option<CollectedValue> {
    Some(CollectedValue::Multi(
        values.iter().map(|s| s.to_string()).collect(),
    ))
}

#[test]
fn should_return_none_when_user_declines_immediately() {
    let prompt = MockPrompt::new();
    prompt.push_confirm(false);
    let result = collector().collect(&prompt).expect("collect");
    assert_eq!(result.key, TrailerKey::Constraint);
    assert_eq!(result.value, None);
}

#[test]
fn should_collect_one_value_when_user_adds_one_then_declines() {
    let prompt = MockPrompt::new();
    prompt
        .push_confirms(&[true, false])
        .push_text("must be fast");
    let result = collector().collect(&prompt).expect("collect");
    assert_eq!(result.key, TrailerKey::Constraint);
    assert_eq!(result.value, multi(&["must be fast"]));
}

#[test]
fn should_collect_multiple_values_when_user_adds_several() {
    let prompt = MockPrompt::new();
    prompt.push_confirms(&[true, true, true, false]);
    for text in ["constraint one", "constraint two", "constraint three"] {
        prompt.push_text(text);
    }
    let result = collector().collect(&prompt).expect("collect");
    assert_eq!(
        result.value,
        multi(&["constraint one", "constraint two", "constraint three"])
    );
}

#[test]
fn should_skip_whitespace_only_values() {
    let prompt = MockPrompt::new();
    prompt.push_confirms(&[true, true, false]);
    prompt.push_text("valid value").push_text("   ");
    let result = collector().collect(&prompt).expect("collect");
    assert_eq!(result.value, multi(&["valid value"]));
}

#[test]
fn should_trim_values() {
    let prompt = MockPrompt::new();
    prompt
        .push_confirms(&[true, false])
        .push_text("  padded value  ");
    let result = collector().collect(&prompt).expect("collect");
    assert_eq!(result.value, multi(&["padded value"]));
}

#[test]
fn should_return_none_when_all_entered_values_are_whitespace() {
    let prompt = MockPrompt::new();
    prompt.push_confirms(&[true, true, false]);
    prompt.push_text("   ").push_text("   ");
    let result = collector().collect(&prompt).expect("collect");
    assert_eq!(result.key, TrailerKey::Constraint);
    assert_eq!(result.value, None);
}

#[test]
fn should_pass_correct_messages_to_prompt() {
    let prompt = MockPrompt::new();
    prompt.push_confirms(&[true, false]).push_text("x");
    collector().collect(&prompt).expect("collect");
    let calls = prompt.calls();
    assert_eq!(
        calls[0],
        PromptCall::Confirm {
            message: "Add a Constraint?".to_owned(),
            default: Some(false),
        }
    );
    assert_eq!(
        calls[1],
        PromptCall::Text {
            message: "Constraint:".to_owned(),
            options: TextPromptOptions::default(),
        }
    );
}
