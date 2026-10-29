//! Reads commit input through interactive terminal prompts.
//!
//! `read()` orchestrates three steps (intent, body, trailers). Trailer
//! collection is delegated to injected [`TrailerCollector`] strategies, so a
//! new trailer type needs only a new collector.

use crate::interfaces::commit_input_reader::CommitInputReader;
use crate::interfaces::prompt::{Prompt, TextPromptOptions};
use crate::interfaces::trailer_collector::{CollectedValue, TrailerCollector};
use crate::types::commit_input::{CommitInput, CommitInputTrailers};
use crate::util::constants::prompt_strings;
use crate::util::Result;

/// [`CommitInputReader`] driven by a [`Prompt`].
pub struct InteractiveInputReader<'a> {
    prompt: &'a dyn Prompt,
    collectors: Vec<Box<dyn TrailerCollector>>,
}

impl<'a> InteractiveInputReader<'a> {
    pub fn new(prompt: &'a dyn Prompt, collectors: Vec<Box<dyn TrailerCollector>>) -> Self {
        InteractiveInputReader { prompt, collectors }
    }

    fn collect(&self) -> Result<CommitInput> {
        let intent = self.collect_intent()?;
        let body = self.collect_body()?;
        let trailers = self.collect_trailers()?;
        Ok(CommitInput {
            intent,
            body,
            trailers: Some(trailers),
        })
    }

    fn collect_intent(&self) -> Result<String> {
        self.prompt.ask_text(
            prompt_strings::INTENT,
            &TextPromptOptions {
                default: None,
                max_length: Some(72),
            },
        )
    }

    fn collect_body(&self) -> Result<Option<String>> {
        if !self
            .prompt
            .ask_confirm(prompt_strings::ADD_BODY, Some(false))?
        {
            return Ok(None);
        }
        Ok(Some(self.prompt.ask_multiline(prompt_strings::BODY_INPUT)?))
    }

    fn collect_trailers(&self) -> Result<CommitInputTrailers> {
        let mut trailers = CommitInputTrailers::default();
        for collector in &self.collectors {
            let result = collector.collect(self.prompt)?;
            match result.value {
                Some(CollectedValue::Multi(values)) => trailers.set_array(result.key, Some(values)),
                Some(CollectedValue::Single(value)) => trailers.set_enum(result.key, Some(value)),
                None => {}
            }
        }
        Ok(trailers)
    }
}

impl CommitInputReader for InteractiveInputReader<'_> {
    /// Collects the input and always closes the prompt, even on error.
    fn read(&self) -> Result<CommitInput> {
        let result = self.collect();
        self.prompt.close();
        result
    }
}

#[cfg(test)]
mod tests;
