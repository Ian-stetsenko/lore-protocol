use super::*;
use crate::test_support::{MockPrompt, PromptCall};
use crate::util::constants::{CONFIDENCE_VALUES, SCOPE_RISK_VALUES};

fn collector() -> EnumChoiceTrailerCollector {
    EnumChoiceTrailerCollector::new(
        TrailerKey::Confidence,
        "Set Confidence?",
        "Confidence:",
        &CONFIDENCE_VALUES,
    )
}

#[test]
fn should_return_none_when_user_declines() {
    let prompt = MockPrompt::new();
    prompt.push_confirm(false);
    let result = collector().collect(&prompt).expect("collect");
    assert_eq!(result.key, TrailerKey::Confidence);
    assert_eq!(result.value, None);
}

#[test]
fn should_return_chosen_value_when_user_accepts() {
    let prompt = MockPrompt::new();
    prompt.push_confirm(true).push_choice("high");
    let result = collector().collect(&prompt).expect("collect");
    assert_eq!(result.key, TrailerKey::Confidence);
    assert_eq!(
        result.value,
        Some(CollectedValue::Single("high".to_owned()))
    );
}

#[test]
fn should_pass_correct_messages_and_values_to_prompt() {
    let prompt = MockPrompt::new();
    prompt.push_confirm(true).push_choice("medium");
    collector().collect(&prompt).expect("collect");
    assert_eq!(
        prompt.calls(),
        vec![
            PromptCall::Confirm {
                message: "Set Confidence?".to_owned(),
                default: Some(false),
            },
            PromptCall::Choice {
                message: "Confidence:".to_owned(),
                choices: vec!["low".to_owned(), "medium".to_owned(), "high".to_owned()],
            },
        ]
    );
}

#[test]
fn should_not_call_ask_choice_when_user_declines() {
    let prompt = MockPrompt::new();
    prompt.push_confirm(false);
    collector().collect(&prompt).expect("collect");
    assert!(prompt
        .calls()
        .iter()
        .all(|c| !matches!(c, PromptCall::Choice { .. })));
}

#[test]
fn should_work_with_scope_risk_config() {
    let scope_risk = EnumChoiceTrailerCollector::new(
        TrailerKey::ScopeRisk,
        "Set Scope-risk?",
        "Scope-risk:",
        &SCOPE_RISK_VALUES,
    );
    let prompt = MockPrompt::new();
    prompt.push_confirm(true).push_choice("wide");
    let result = scope_risk.collect(&prompt).expect("collect");
    assert_eq!(result.key, TrailerKey::ScopeRisk);
    assert_eq!(
        result.value,
        Some(CollectedValue::Single("wide".to_owned()))
    );
}
