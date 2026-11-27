//! Interactive terminal prompts for `lore commit -i`.
//!
//! Reads lines from an input stream and writes questions to an output
//! stream. [`TerminalPrompt::new`] wires stdin/stdout; [`TerminalPrompt::with_io`]
//! lets tests drive the prompt with in-memory buffers.

use std::cell::RefCell;
use std::io::{self, BufRead, BufReader, Write};

use crate::interfaces::prompt::{Prompt, TextPromptOptions};
use crate::util::{LoreError, Result};

/// [`Prompt`] implementation over a line-oriented input and a text output.
pub struct TerminalPrompt {
    input: RefCell<Box<dyn BufRead>>,
    output: RefCell<Box<dyn Write>>,
}

impl Default for TerminalPrompt {
    fn default() -> Self {
        TerminalPrompt::new()
    }
}

impl TerminalPrompt {
    /// Prompt bound to the process's stdin and stdout.
    pub fn new() -> Self {
        TerminalPrompt::with_io(
            Box::new(BufReader::new(io::stdin())),
            Box::new(io::stdout()),
        )
    }

    /// Prompt over arbitrary streams (tests use `Cursor` / `Vec<u8>`).
    pub fn with_io(input: Box<dyn BufRead>, output: Box<dyn Write>) -> Self {
        TerminalPrompt {
            input: RefCell::new(input),
            output: RefCell::new(output),
        }
    }

    /// Print `text` as-is (no newline) and flush.
    fn write(&self, text: &str) -> Result<()> {
        let mut out = self.output.borrow_mut();
        out.write_all(text.as_bytes())?;
        out.flush()?;
        Ok(())
    }

    /// Print `text` followed by a newline and flush.
    fn write_line(&self, text: &str) -> Result<()> {
        let mut out = self.output.borrow_mut();
        out.write_all(text.as_bytes())?;
        out.write_all(b"\n")?;
        out.flush()?;
        Ok(())
    }

    /// Read one line without its trailing newline. `None` at end of input.
    fn read_line(&self) -> Result<Option<String>> {
        let mut line = String::new();
        let read = self.input.borrow_mut().read_line(&mut line)?;
        if read == 0 {
            return Ok(None);
        }
        if line.ends_with('\n') {
            line.pop();
            if line.ends_with('\r') {
                line.pop();
            }
        }
        Ok(Some(line))
    }

    /// Ask `question` (which already carries its trailing space) and return
    /// the raw answer; end of input counts as an empty answer.
    fn question(&self, question: &str) -> Result<String> {
        self.write(question)?;
        Ok(self.read_line()?.unwrap_or_default())
    }

    /// JavaScript `parseInt(s, 10)`: optional sign followed by the longest
    /// run of ASCII digits; anything else is `None` (NaN).
    fn parse_int_prefix(s: &str) -> Option<i64> {
        let (negative, rest) = match s.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, s.strip_prefix('+').unwrap_or(s)),
        };
        let digits: &str = {
            let end = rest
                .char_indices()
                .find(|(_, c)| !c.is_ascii_digit())
                .map(|(i, _)| i)
                .unwrap_or(rest.len());
            &rest[..end]
        };
        if digits.is_empty() {
            return None;
        }
        let value: i64 = digits.parse().ok()?;
        Some(if negative { -value } else { value })
    }
}

impl Prompt for TerminalPrompt {
    fn ask_text(&self, message: &str, options: &TextPromptOptions) -> Result<String> {
        // JS treats an empty default as "no default" (falsy).
        let default = options.default.as_deref().filter(|d| !d.is_empty());
        let default_hint = default
            .map(|d| format!(" (default: {d})"))
            .unwrap_or_default();
        let answer = self.question(&format!("{message}{default_hint} "))?;

        let trimmed = answer.trim();
        if trimmed.is_empty() {
            if let Some(d) = default {
                return Ok(d.to_owned());
            }
        }

        // Length is counted in chars here; JS counts UTF-16 code units. The
        // two differ only for characters outside the Basic Multilingual Plane.
        if let Some(max) = options.max_length.filter(|m| *m > 0) {
            if trimmed.chars().count() > max {
                return Ok(trimmed.chars().take(max).collect());
            }
        }

        Ok(trimmed.to_owned())
    }

    fn ask_multiline(&self, message: &str) -> Result<String> {
        self.write_line(message)?;
        let mut lines: Vec<String> = Vec::new();

        while let Some(line) = self.read_line()? {
            if line.trim().is_empty() {
                break;
            }
            lines.push(line);
        }

        Ok(lines.join("\n"))
    }

    fn ask_choice(&self, message: &str, choices: &[&str]) -> Result<String> {
        let choice_list: Vec<String> = choices
            .iter()
            .enumerate()
            .map(|(i, c)| format!("  {}) {c}", i + 1))
            .collect();
        self.write_line(&format!("{message}\n{}", choice_list.join("\n")))?;

        loop {
            self.write("Choice (number): ")?;
            let Some(answer) = self.read_line()? else {
                // Readline would hang forever here; surface it instead.
                return Err(LoreError::new("Input closed"));
            };
            let trimmed = answer.trim();

            if let Some(n) = Self::parse_int_prefix(trimmed) {
                let index = n - 1;
                if index >= 0 && (index as usize) < choices.len() {
                    return Ok(choices[index as usize].to_owned());
                }
            }

            // Also accept the exact value (case-insensitively).
            let lowered = trimmed.to_lowercase();
            if let Some(matched) = choices.iter().find(|c| c.to_lowercase() == lowered) {
                return Ok((*matched).to_owned());
            }

            self.write_line(&format!(
                "Invalid choice. Please enter 1-{} or the exact value.",
                choices.len()
            ))?;
        }
    }

    fn ask_confirm(&self, message: &str, default: Option<bool>) -> Result<bool> {
        let hint = match default {
            Some(true) => " [Y/n]",
            Some(false) => " [y/N]",
            None => " [y/n]",
        };
        let answer = self.question(&format!("{message}{hint} "))?;

        let trimmed = answer.trim().to_lowercase();
        if trimmed.is_empty() {
            return Ok(default.unwrap_or(false));
        }

        Ok(trimmed == "y" || trimmed == "yes")
    }

    fn close(&self) {
        // Nothing to release; readline in TS is closed here. Best-effort flush.
        let _ = self.output.borrow_mut().flush();
    }
}

#[cfg(test)]
mod tests;
