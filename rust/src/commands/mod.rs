//! Thin command handlers; one module per command.
//!
//! Every command receives its dependencies as a struct of references
//! (constructed only in `main.rs`), writes through [`Io`], and returns the
//! process exit code. Failures propagate as [`crate::util::LoreError`] and are
//! rendered by the composition root.

use std::io::Write;

use crate::util::Result;

pub mod helpers;

pub mod commit;
pub mod doctor;
pub mod hooks;
pub mod init;
pub mod log;
pub mod path_queries;
pub mod search;
pub mod squash;
pub mod stale;
pub mod trace;
pub mod validate;
pub mod why;

/// Output streams handed to commands (stdout / stderr in production,
/// in-memory buffers in tests).
pub struct Io<'a> {
    pub out: &'a mut dyn Write,
    pub err: &'a mut dyn Write,
}

impl<'a> Io<'a> {
    pub fn new(out: &'a mut dyn Write, err: &'a mut dyn Write) -> Self {
        Io { out, err }
    }

    /// Write `text` plus a newline to stdout (`console.log` equivalent).
    pub fn print(&mut self, text: &str) -> Result<()> {
        writeln!(self.out, "{text}")?;
        Ok(())
    }

    /// Write `text` plus a newline to stderr (`console.error` equivalent).
    pub fn eprint(&mut self, text: &str) -> Result<()> {
        writeln!(self.err, "{text}")?;
        Ok(())
    }
}

/// Exit code for a command that completed normally.
pub const EXIT_OK: i32 = 0;
