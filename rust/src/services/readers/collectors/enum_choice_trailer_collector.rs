//! Collects a single choice for an enum trailer.
//!
//! Asks whether to set the value; if yes, presents the available choices.

use crate::interfaces::prompt::Prompt;
use crate::interfaces::trailer_collector::{
    CollectedValue, TrailerCollector, TrailerCollectorResult,
};
use crate::types::domain::TrailerKey;
use crate::util::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EnumChoiceTrailerCollector {
    key: TrailerKey,
    confirm_message: &'static str,
    choice_message: &'static str,
    values: &'static [&'static str],
}

impl EnumChoiceTrailerCollector {
    pub fn new(
        key: TrailerKey,
        confirm_message: &'static str,
        choice_message: &'static str,
        values: &'static [&'static str],
    ) -> Self {
        EnumChoiceTrailerCollector {
            key,
            confirm_message,
            choice_message,
            values,
        }
    }
}

impl TrailerCollector for EnumChoiceTrailerCollector {
    fn collect(&self, prompt: &dyn Prompt) -> Result<TrailerCollectorResult> {
        if !prompt.ask_confirm(self.confirm_message, Some(false))? {
            return Ok(TrailerCollectorResult {
                key: self.key,
                value: None,
            });
        }

        let chosen = prompt.ask_choice(self.choice_message, self.values)?;
        Ok(TrailerCollectorResult {
            key: self.key,
            value: Some(CollectedValue::Single(chosen)),
        })
    }
}

#[cfg(test)]
mod tests;
