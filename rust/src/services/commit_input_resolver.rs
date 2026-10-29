//! Resolves commit input from the appropriate source based on CLI options.
//!
//! Pure dispatcher: determines the input mode, constructs the matching
//! [`CommitInputReader`] strategy and delegates reading to it.
//!
//! Mode priority: interactive > file > flags > stdin. When no flags are set
//! and stdin is a TTY, resolves to interactive to avoid hanging on stdin.

use std::io::{self, IsTerminal};

use crate::interfaces::commit_input_reader::CommitInputReader;
use crate::interfaces::prompt::Prompt;
use crate::types::commit_input::{CommitCommandOptions, CommitInput};
use crate::util::Result;

use super::readers::collectors::trailer_collector_registry::create_trailer_collectors;
use super::readers::flags_input_reader::FlagsInputReader;
use super::readers::interactive_input_reader::InteractiveInputReader;
use super::readers::json_input_reader::JsonInputReader;

/// The modes of commit input resolution, ordered by priority.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputMode {
    Interactive,
    File,
    Flags,
    Stdin,
}

/// Coordinates mode resolution and reader creation for `lore commit`.
pub struct CommitInputResolver<'a> {
    prompt: &'a dyn Prompt,
}

impl<'a> CommitInputResolver<'a> {
    pub fn new(prompt: &'a dyn Prompt) -> Self {
        CommitInputResolver { prompt }
    }

    /// Resolve commit input, detecting whether stdin is a terminal.
    pub fn resolve(&self, options: &CommitCommandOptions) -> Result<CommitInput> {
        self.resolve_with_tty(options, io::stdin().is_terminal())
    }

    /// Resolve commit input with an explicit answer to "is stdin a TTY?".
    pub fn resolve_with_tty(
        &self,
        options: &CommitCommandOptions,
        stdin_is_tty: bool,
    ) -> Result<CommitInput> {
        match Self::resolve_mode(options, stdin_is_tty) {
            InputMode::Interactive => {
                InteractiveInputReader::new(self.prompt, create_trailer_collectors()).read()
            }
            InputMode::File => {
                // `resolve_mode` only returns `File` when a path is present.
                let content = match &options.file {
                    Some(path) => std::fs::read_to_string(path)?,
                    None => String::new(),
                };
                JsonInputReader::new(content).read()
            }
            InputMode::Stdin => {
                let content = io::read_to_string(io::stdin())?;
                JsonInputReader::new(content).read()
            }
            InputMode::Flags => FlagsInputReader::new(options).read(),
        }
    }

    /// Determine the input mode: interactive > file > flags (intent set) >
    /// interactive when stdin is a TTY > stdin.
    pub fn resolve_mode(options: &CommitCommandOptions, stdin_is_tty: bool) -> InputMode {
        if options.interactive {
            return InputMode::Interactive;
        }
        // JS truthiness: an empty path or an empty intent does not count.
        if options
            .file
            .as_ref()
            .is_some_and(|p| !p.as_os_str().is_empty())
        {
            return InputMode::File;
        }
        if options.intent.as_deref().is_some_and(|i| !i.is_empty()) {
            return InputMode::Flags;
        }
        if stdin_is_tty {
            return InputMode::Interactive;
        }
        InputMode::Stdin
    }
}

#[cfg(test)]
mod tests;
