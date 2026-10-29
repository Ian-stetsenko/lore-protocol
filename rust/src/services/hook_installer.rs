//! Installs and uninstalls Lore-managed git hooks on the filesystem.
//!
//! Script generation is delegated to a [`HookScriptGenerator`]; this type only
//! manages the hook file itself.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

use crate::interfaces::hook_installer::{
    HookInstallResult, HookInstaller, HookScriptGenerator, HookUninstallResult,
};
use crate::types::config::HooksConfig;
use crate::util::Result;

use super::hook_script_generator::LORE_MARKER;

/// Filesystem-backed [`HookInstaller`] for `.git/hooks/commit-msg`.
pub struct FsHookInstaller<'a> {
    generator: &'a dyn HookScriptGenerator,
    hooks_config: &'a HooksConfig,
}

impl<'a> FsHookInstaller<'a> {
    pub fn new(generator: &'a dyn HookScriptGenerator, hooks_config: &'a HooksConfig) -> Self {
        FsHookInstaller {
            generator,
            hooks_config,
        }
    }

    fn hooks_dir(repo_root: &Path) -> PathBuf {
        repo_root.join(".git").join("hooks")
    }

    fn hook_path(repo_root: &Path) -> PathBuf {
        Self::hooks_dir(repo_root).join("commit-msg")
    }

    /// `<hook_path>.bak`.
    fn backup_path(hook_path: &Path) -> PathBuf {
        let mut backup: OsString = hook_path.as_os_str().to_owned();
        backup.push(".bak");
        PathBuf::from(backup)
    }

    fn write_hook(&self, hook_path: &Path) -> Result<()> {
        let script = self.generator.generate_commit_msg_hook(self.hooks_config);
        fs::write(hook_path, script)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(hook_path, fs::Permissions::from_mode(0o755))?;
        }
        Ok(())
    }

    fn is_lore_hook(content: &str) -> bool {
        content.contains(LORE_MARKER)
    }
}

impl HookInstaller for FsHookInstaller<'_> {
    fn install(&self, repo_root: &Path, force: bool) -> Result<HookInstallResult> {
        let hooks_dir = Self::hooks_dir(repo_root);
        let hook_path = Self::hook_path(repo_root);

        fs::create_dir_all(&hooks_dir)?;

        // Any read failure (missing, unreadable, not UTF-8) counts as "no existing hook".
        let existing_content: Option<String> = fs::read_to_string(&hook_path).ok();

        if let Some(existing) = &existing_content {
            if Self::is_lore_hook(existing) {
                // Lore-managed hook: overwrite silently (upgrade).
            } else if !force {
                // Non-Lore hook exists, no --force: refuse.
                return Ok(HookInstallResult {
                    installed: false,
                    hook_path,
                    backed_up: None,
                    already_installed: false,
                });
            } else {
                // Non-Lore hook exists with --force: back up then install.
                let backup_path = Self::backup_path(&hook_path);
                fs::rename(&hook_path, &backup_path)?;
                self.write_hook(&hook_path)?;
                return Ok(HookInstallResult {
                    installed: true,
                    hook_path,
                    backed_up: Some(backup_path),
                    already_installed: false,
                });
            }
        }

        self.write_hook(&hook_path)?;
        Ok(HookInstallResult {
            installed: true,
            hook_path,
            backed_up: None,
            already_installed: existing_content
                .as_deref()
                .map(Self::is_lore_hook)
                .unwrap_or(false),
        })
    }

    fn uninstall(&self, repo_root: &Path) -> Result<HookUninstallResult> {
        let hook_path = Self::hook_path(repo_root);

        let Ok(content) = fs::read_to_string(&hook_path) else {
            return Ok(HookUninstallResult {
                removed: false,
                hook_path,
                not_lore_hook: false,
            });
        };

        if !Self::is_lore_hook(&content) {
            return Ok(HookUninstallResult {
                removed: false,
                hook_path,
                not_lore_hook: true,
            });
        }

        fs::remove_file(&hook_path)?;
        Ok(HookUninstallResult {
            removed: true,
            hook_path,
            not_lore_hook: false,
        })
    }
}

#[cfg(test)]
mod tests;
