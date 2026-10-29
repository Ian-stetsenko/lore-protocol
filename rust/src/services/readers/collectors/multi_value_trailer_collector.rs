//! Collects zero or more values for an array trailer.
//!
//! Confirm-then-loop: asks whether to add a value, reads it, and asks again
//! until the user declines.

use crate::interfaces::prompt::{Prompt, TextPromptOptions};
use crate::interfaces::trailer_collector::{
    CollectedValue, TrailerCollector, TrailerCollectorResult,
};
use crate::types::domain::TrailerKey;
use crate::util::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MultiValueTrailerCollector {
    key: TrailerKey,
    confirm_message: &'static str,
    input_message: &'static str,
}

impl MultiValueTrailerCollector {
    pub fn new(
        key: TrailerKey,
        confirm_message: &'static str,
        input_message: &'static str,
    ) -> Self {
        MultiValueTrailerCollector {
            key,
            confirm_message,
            input_message,
        }
    }
}

impl TrailerCollector for MultiValueTrailerCollector {
    fn collect(&self, prompt: &dyn Prompt) -> Result<TrailerCollectorResult> {
        let mut values: Vec<String> = Vec::new();

        loop {
            if !prompt.ask_confirm(self.confirm_message, Some(false))? {
                break;
            }
            let value = prompt.ask_text(self.input_message, &TextPromptOptions::default())?;
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                values.push(trimmed.to_owned());
            }
        }

        Ok(TrailerCollectorResult {
            key: self.key,
            value: if values.is_empty() {
                None
            } else {
                Some(CollectedValue::Multi(values))
            },
        })
    }
}

#[cfg(test)]
mod tests;
