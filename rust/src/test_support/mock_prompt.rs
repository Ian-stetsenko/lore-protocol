//! Scripted `Prompt` double.

use std::cell::{Cell, RefCell};
use std::collections::VecDeque;

use crate::interfaces::prompt::{Prompt, TextPromptOptions};
use crate::util::Result;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PromptCall {
    Text {
        message: String,
        options: TextPromptOptions,
    },
    Multiline(String),
    Choice {
        message: String,
        choices: Vec<String>,
    },
    Confirm {
        message: String,
        default: Option<bool>,
    },
    Close,
}

/// Answers are consumed in order from per-method queues. When a queue runs
/// dry the defaults apply: text `""`, multiline `""`, the first choice, and
/// `false` for confirmations.
#[derive(Default)]
pub struct MockPrompt {
    text_answers: RefCell<VecDeque<String>>,
    multiline_answers: RefCell<VecDeque<String>>,
    choice_answers: RefCell<VecDeque<String>>,
    confirm_answers: RefCell<VecDeque<bool>>,
    calls: RefCell<Vec<PromptCall>>,
    closed: Cell<bool>,
}

impl MockPrompt {
    pub fn new() -> Self {
        MockPrompt::default()
    }

    pub fn push_text(&self, answer: &str) -> &Self {
        self.text_answers.borrow_mut().push_back(answer.to_owned());
        self
    }

    pub fn push_multiline(&self, answer: &str) -> &Self {
        self.multiline_answers
            .borrow_mut()
            .push_back(answer.to_owned());
        self
    }

    pub fn push_choice(&self, answer: &str) -> &Self {
        self.choice_answers
            .borrow_mut()
            .push_back(answer.to_owned());
        self
    }

    pub fn push_confirm(&self, answer: bool) -> &Self {
        self.confirm_answers.borrow_mut().push_back(answer);
        self
    }

    /// Queue several confirmation answers at once.
    pub fn push_confirms(&self, answers: &[bool]) -> &Self {
        for a in answers {
            self.push_confirm(*a);
        }
        self
    }

    pub fn calls(&self) -> Vec<PromptCall> {
        self.calls.borrow().clone()
    }

    pub fn confirm_messages(&self) -> Vec<String> {
        self.calls
            .borrow()
            .iter()
            .filter_map(|c| match c {
                PromptCall::Confirm { message, .. } => Some(message.clone()),
                _ => None,
            })
            .collect()
    }

    pub fn text_messages(&self) -> Vec<String> {
        self.calls
            .borrow()
            .iter()
            .filter_map(|c| match c {
                PromptCall::Text { message, .. } => Some(message.clone()),
                _ => None,
            })
            .collect()
    }

    pub fn was_closed(&self) -> bool {
        self.closed.get()
    }

    fn record(&self, call: PromptCall) {
        self.calls.borrow_mut().push(call);
    }
}

impl Prompt for MockPrompt {
    fn ask_text(&self, message: &str, options: &TextPromptOptions) -> Result<String> {
        self.record(PromptCall::Text {
            message: message.to_owned(),
            options: options.clone(),
        });
        Ok(self
            .text_answers
            .borrow_mut()
            .pop_front()
            .unwrap_or_default())
    }

    fn ask_multiline(&self, message: &str) -> Result<String> {
        self.record(PromptCall::Multiline(message.to_owned()));
        Ok(self
            .multiline_answers
            .borrow_mut()
            .pop_front()
            .unwrap_or_default())
    }

    fn ask_choice(&self, message: &str, choices: &[&str]) -> Result<String> {
        self.record(PromptCall::Choice {
            message: message.to_owned(),
            choices: choices.iter().map(|c| c.to_string()).collect(),
        });
        let answer = self
            .choice_answers
            .borrow_mut()
            .pop_front()
            .or_else(|| choices.first().map(|c| c.to_string()))
            .unwrap_or_default();
        Ok(answer)
    }

    fn ask_confirm(&self, message: &str, default: Option<bool>) -> Result<bool> {
        self.record(PromptCall::Confirm {
            message: message.to_owned(),
            default,
        });
        Ok(self
            .confirm_answers
            .borrow_mut()
            .pop_front()
            .unwrap_or(false))
    }

    fn close(&self) {
        self.record(PromptCall::Close);
        self.closed.set(true);
    }
}
