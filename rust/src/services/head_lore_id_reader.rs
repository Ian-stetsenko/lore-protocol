//! Reads the Lore-id from the HEAD commit message.
//!
//! Used during `--amend` to preserve the existing Lore-id so that
//! knowledge-graph references (`Related`, `Supersedes`, `Depends-on`)
//! remain valid.

use crate::interfaces::git_client::GitClient;
use crate::types::domain::LoreId;
use crate::util::constants::is_valid_lore_id;

use super::trailer_parser::TrailerParser;

/// Extracts a well-formed Lore-id from HEAD's trailer block, if any.
pub struct HeadLoreIdReader<'a> {
    git: &'a dyn GitClient,
    parser: &'a TrailerParser,
}

impl<'a> HeadLoreIdReader<'a> {
    pub fn new(git: &'a dyn GitClient, parser: &'a TrailerParser) -> Self {
        HeadLoreIdReader { git, parser }
    }

    /// The HEAD Lore-id, or `None` when HEAD cannot be read (empty repo),
    /// has no trailer block, has no Lore-id, or the id is malformed.
    pub fn read(&self) -> Option<LoreId> {
        let message = self.git.head_message().ok()?;

        let trailer_block = self.parser.extract_trailer_block(&message);
        if trailer_block.is_empty() {
            return None;
        }

        let trailers = self.parser.parse(&trailer_block, &[]);
        if is_valid_lore_id(&trailers.lore_id) {
            Some(trailers.lore_id)
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests;
