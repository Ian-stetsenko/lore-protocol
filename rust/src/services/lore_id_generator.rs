//! Random Lore-id generation.
//!
//! ID generation is infrastructure (pure fabrication); it sits behind the
//! [`LoreIdGenerator`] port so tests can inject a deterministic generator.

use rand::RngCore;

use crate::interfaces::lore_id_generator::LoreIdGenerator;
use crate::types::domain::LoreId;
use crate::util::constants::LORE_ID_LENGTH;

/// Generates 8-character lowercase hex Lore-ids from 4 random bytes.
#[derive(Debug, Default, Clone, Copy)]
pub struct RandomLoreIdGenerator;

impl RandomLoreIdGenerator {
    pub fn new() -> Self {
        RandomLoreIdGenerator
    }
}

impl LoreIdGenerator for RandomLoreIdGenerator {
    /// A new Lore-id: `LORE_ID_LENGTH / 2` random bytes rendered as
    /// lowercase hex.
    fn generate(&self) -> LoreId {
        let mut bytes = [0u8; LORE_ID_LENGTH / 2];
        rand::thread_rng().fill_bytes(&mut bytes);
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}

#[cfg(test)]
mod tests;
