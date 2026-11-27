//! Port for locating and loading `.lore/config.toml`.

use std::path::{Path, PathBuf};

use crate::types::config::LoreConfig;
use crate::util::Result;

pub trait ConfigLoader {
    /// Load and merge every `.lore/config.toml` found walking up from
    /// `target_path` (nearest overrides farthest). Defaults when none exist.
    fn load_for_path(&self, target_path: &Path) -> Result<LoreConfig>;

    /// Load a single config file, filling missing values from defaults.
    fn load_from_file(&self, config_path: &Path) -> Result<LoreConfig>;

    /// Nearest `.lore/config.toml` at or above `start_path`, if any.
    fn find_config_path(&self, start_path: &Path) -> Result<Option<PathBuf>>;
}
