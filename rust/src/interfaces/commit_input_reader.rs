//! Strategy port for reading commit input from different sources.

use crate::types::commit_input::CommitInput;
use crate::util::Result;

pub trait CommitInputReader {
    fn read(&self) -> Result<CommitInput>;
}
