//! Strategy port for collecting a single trailer interactively.

use crate::types::domain::TrailerKey;
use crate::util::Result;

use super::prompt::Prompt;

/// What a collector produced for its trailer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CollectedValue {
    /// For array trailers.
    Multi(Vec<String>),
    /// For enum trailers.
    Single(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrailerCollectorResult {
    pub key: TrailerKey,
    /// `None` when the user declined to provide the trailer.
    pub value: Option<CollectedValue>,
}

pub trait TrailerCollector {
    fn collect(&self, prompt: &dyn Prompt) -> Result<TrailerCollectorResult>;
}
