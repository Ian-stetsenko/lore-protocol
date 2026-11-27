//! Ports for git hook generation and installation.

use std::path::{Path, PathBuf};

use crate::types::config::HooksConfig;
use crate::util::Result;

pub trait HookScriptGenerator {
    fn generate_commit_msg_hook(&self, config: &HooksConfig) -> String;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookInstallResult {
    pub installed: bool,
    pub hook_path: PathBuf,
    pub backed_up: Option<PathBuf>,
    pub already_installed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookUninstallResult {
    pub removed: bool,
    pub hook_path: PathBuf,
    pub not_lore_hook: bool,
}

pub trait HookInstaller {
    fn install(&self, repo_root: &Path, force: bool) -> Result<HookInstallResult>;
    fn uninstall(&self, repo_root: &Path) -> Result<HookUninstallResult>;
}
