//! Port for Lore-id generation (so tests can inject deterministic ids).

use crate::types::domain::LoreId;

pub trait LoreIdGenerator {
    /// A new 8-character lowercase hex Lore-id.
    fn generate(&self) -> LoreId;
}
