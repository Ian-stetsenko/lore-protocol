use super::*;
use crate::services::readers::collectors::trailer_collector_registry::create_trailer_collectors;
use crate::test_support::{MockPrompt, PromptCall};
use crate::util::LoreError;

fn strings(values: &[&str]) -> Option<Vec<String>> {
    Some(values.iter().map(|s| s.to_string()).collect())
}

// ---- full flow ---------------------------------------------------------

#[test]
fn should_collect_all_fields_when_user_accepts_everything() {
    let prompt = MockPrompt::new();
    prompt.push_confirms(&[
        true,  // Add a body?
        true,  // Add a Constraint? (yes)
        false, // Add another Constraint? (no)
        true,  // Add a Rejected? (yes)
        false, // Add another Rejected? (no)
        true,  // Set Confidence?
        true,  // Set Scope-risk?
        true,  // Set Reversibility?
        true,  // Add a Directive? (yes)
        false, // Add another Directive? (no)
        true,  // Add a Tested? (yes)
        false, // Add another Tested? (no)
        true,  // Add a Not-tested? (yes)
        false, // Add another Not-tested? (no)
        true,  // Add a Supersedes? (yes)
        false, // Add another Supersedes? (no)
        true,  // Add a Depends-on? (yes)
        false, // Add another Depends-on? (no)
        true,  // Add a Related? (yes)
        false, // Add another Related? (no)
    ]);
    for text in [
        "refactor auth module",
        "must be fast",
        "approach A | too slow",
        "use new API",
        "unit tests pass",
        "load testing",
        "abcd1234",
        "dead0000",
        "beef1234",
    ] {
        prompt.push_text(text);
    }
    prompt.push_multiline("This is the body text.");
    for choice in ["high", "wide", "clean"] {
        prompt.push_choice(choice);
    }

    let reader = InteractiveInputReader::new(&prompt, create_trailer_collectors());
    let result = reader.read().expect("interactive read");

    assert_eq!(result.intent, "refactor auth module");
    assert_eq!(result.body.as_deref(), Some("This is the body text."));
    let t = result.trailers.expect("trailers");
    assert_eq!(t.constraint, strings(&["must be fast"]));
    assert_eq!(t.rejected, strings(&["approach A | too slow"]));
    assert_eq!(t.confidence.as_deref(), Some("high"));
    assert_eq!(t.scope_risk.as_deref(), Some("wide"));
    assert_eq!(t.reversibility.as_deref(), Some("clean"));
    assert_eq!(t.directive, strings(&["use new API"]));
    assert_eq!(t.tested, strings(&["unit tests pass"]));
    assert_eq!(t.not_tested, strings(&["load testing"]));
    assert_eq!(t.supersedes, strings(&["abcd1234"]));
    assert_eq!(t.depends_on, strings(&["dead0000"]));
    assert_eq!(t.related, strings(&["beef1234"]));
    assert!(prompt.was_closed());
}

#[test]
fn intent_prompt_is_capped_at_72_characters() {
    let prompt = MockPrompt::new();
    prompt.push_text("x");
    let reader = InteractiveInputReader::new(&prompt, create_trailer_collectors());
    reader.read().expect("read");
    assert_eq!(
        prompt.calls()[0],
        PromptCall::Text {
            message: prompt_strings::INTENT.to_owned(),
            options: TextPromptOptions {
                default: None,
                max_length: Some(72),
            },
        }
    );
}

// ---- minimal flow ------------------------------------------------------

#[test]
fn should_return_intent_only_when_user_declines_everything() {
    let prompt = MockPrompt::new();
    prompt.push_text("minimal intent");

    let reader = InteractiveInputReader::new(&prompt, create_trailer_collectors());
    let result = reader.read().expect("read");

    assert_eq!(result.intent, "minimal intent");
    assert!(result.body.is_none());
    let t = result.trailers.expect("trailers object is always built");
    assert_eq!(t, CommitInputTrailers::default());
    assert!(prompt.was_closed());
}

// ---- multiple values collection ---------------------------------------

#[test]
fn should_collect_multiple_constraints() {
    let prompt = MockPrompt::new();
    prompt.push_confirms(&[
        false, // Add a body? (no)
        true,  // Add a Constraint? (yes)
        true,  // Add another Constraint? (yes)
        true,  // Add another Constraint? (yes)
        false, // Add another Constraint? (no)
    ]);
    for text in [
        "test intent",
        "constraint one",
        "constraint two",
        "constraint three",
    ] {
        prompt.push_text(text);
    }

    let reader = InteractiveInputReader::new(&prompt, create_trailer_collectors());
    let result = reader.read().expect("read");

    assert_eq!(
        result.trailers.expect("trailers").constraint,
        strings(&["constraint one", "constraint two", "constraint three"])
    );
}

#[test]
fn should_skip_empty_whitespace_only_values() {
    let prompt = MockPrompt::new();
    prompt.push_confirms(&[false, true, true, false]);
    for text in ["test intent", "valid value", "   "] {
        prompt.push_text(text);
    }

    let reader = InteractiveInputReader::new(&prompt, create_trailer_collectors());
    let result = reader.read().expect("read");

    assert_eq!(
        result.trailers.expect("trailers").constraint,
        strings(&["valid value"])
    );
}

// ---- prompt.close on error ---------------------------------------------

/// A prompt whose text or confirm questions fail, to check cleanup.
struct FailingPrompt {
    fail_text: bool,
    closed: std::cell::Cell<bool>,
}

impl Prompt for FailingPrompt {
    fn ask_text(&self, _: &str, _: &TextPromptOptions) -> Result<String> {
        if self.fail_text {
            Err(LoreError::new("prompt error"))
        } else {
            Ok("test intent".to_owned())
        }
    }
    fn ask_multiline(&self, _: &str) -> Result<String> {
        Ok(String::new())
    }
    fn ask_choice(&self, _: &str, _: &[&str]) -> Result<String> {
        Ok("low".to_owned())
    }
    fn ask_confirm(&self, _: &str, _: Option<bool>) -> Result<bool> {
        Err(LoreError::new("confirm error"))
    }
    fn close(&self) {
        self.closed.set(true);
    }
}

#[test]
fn should_call_prompt_close_even_when_ask_text_fails() {
    let prompt = FailingPrompt {
        fail_text: true,
        closed: std::cell::Cell::new(false),
    };
    let reader = InteractiveInputReader::new(&prompt, create_trailer_collectors());
    let err = reader.read().expect_err("must propagate");
    assert_eq!(err.to_string(), "prompt error");
    assert!(prompt.closed.get());
}

#[test]
fn should_call_prompt_close_even_when_ask_confirm_fails() {
    let prompt = FailingPrompt {
        fail_text: false,
        closed: std::cell::Cell::new(false),
    };
    let reader = InteractiveInputReader::new(&prompt, create_trailer_collectors());
    let err = reader.read().expect_err("must propagate");
    assert_eq!(err.to_string(), "confirm error");
    assert!(prompt.closed.get());
}
