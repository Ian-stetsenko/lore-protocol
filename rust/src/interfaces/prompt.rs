//! Port for interactive terminal prompts (`lore commit -i`).

use crate::util::Result;

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TextPromptOptions {
    pub default: Option<String>,
    pub max_length: Option<usize>,
}

pub trait Prompt {
    /// Ask for a single line. Trims the answer; falls back to `default` when
    /// empty; truncates to `max_length`.
    fn ask_text(&self, message: &str, options: &TextPromptOptions) -> Result<String>;

    /// Collect lines until an empty line; joined with `\n`.
    fn ask_multiline(&self, message: &str) -> Result<String>;

    /// Present numbered choices; accepts a 1-based index or the exact value.
    fn ask_choice(&self, message: &str, choices: &[&str]) -> Result<String>;

    /// Yes/no question. Empty answer yields `default` (or `false`).
    fn ask_confirm(&self, message: &str, default: Option<bool>) -> Result<bool>;

    fn close(&self);
}
