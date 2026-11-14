//! `lore squash <range>`: merge the atoms in a revision range into one
//! commit message, printed raw to stdout for squash-merge workflows.

use crate::cli::SquashArgs;
use crate::commands::{Io, EXIT_OK};
use crate::services::atom_repository::AtomRepository;
use crate::services::squash_merger::{SquashMerger, SquashOptions};
use crate::util::{LoreError, Result};

pub struct SquashDeps<'a> {
    pub atom_repository: &'a AtomRepository<'a>,
    pub squash_merger: &'a SquashMerger<'a>,
}

pub fn run(args: &SquashArgs, deps: &SquashDeps<'_>, io: &mut Io<'_>) -> Result<i32> {
    let atoms = deps.atom_repository.find_by_range(&args.range)?;

    if atoms.is_empty() {
        return Err(LoreError::new(
            "No Lore atoms found in the specified range.",
        ));
    }

    let merged = deps.squash_merger.merge(
        &atoms,
        &SquashOptions {
            intent: args.intent.clone(),
            body: args.body.clone(),
        },
    )?;

    // Raw message, not formatted
    io.print(&merged)?;
    Ok(EXIT_OK)
}
