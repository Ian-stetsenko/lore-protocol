//! Reads commit input from CLI flag values. Pure data mapping; no I/O.

use crate::interfaces::commit_input_reader::CommitInputReader;
use crate::types::commit_input::{CommitCommandOptions, CommitInput, CommitInputTrailers};
use crate::util::Result;

/// [`CommitInputReader`] that maps `lore commit` flags onto [`CommitInput`].
#[derive(Debug, Clone, Copy)]
pub struct FlagsInputReader<'a> {
    options: &'a CommitCommandOptions,
}

impl<'a> FlagsInputReader<'a> {
    pub fn new(options: &'a CommitCommandOptions) -> Self {
        FlagsInputReader { options }
    }
}

impl CommitInputReader for FlagsInputReader<'_> {
    fn read(&self) -> Result<CommitInput> {
        let o = self.options;
        Ok(CommitInput {
            intent: o.intent.clone().unwrap_or_default(),
            body: o.body.clone(),
            // The TS reader always builds the trailers object, even when
            // every field is absent.
            trailers: Some(CommitInputTrailers {
                constraint: o.constraint.clone(),
                rejected: o.rejected.clone(),
                confidence: o.confidence.clone(),
                scope_risk: o.scope_risk.clone(),
                reversibility: o.reversibility.clone(),
                directive: o.directive.clone(),
                tested: o.tested.clone(),
                not_tested: o.not_tested.clone(),
                supersedes: o.supersedes.clone(),
                depends_on: o.depends_on.clone(),
                related: o.related.clone(),
                custom: None,
            }),
        })
    }
}

#[cfg(test)]
mod tests;
