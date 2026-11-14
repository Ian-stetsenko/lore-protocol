//! `lore hooks install|uninstall`: manage the Lore commit-msg hook.

use std::path::Path;

use crate::cli::HooksAction;
use crate::commands::{Io, EXIT_OK};
use crate::interfaces::git_client::GitClient;
use crate::interfaces::hook_installer::HookInstaller;
use crate::interfaces::output_formatter::{ErrorMessage, OutputFormatter};
use crate::util::constants::EXIT_CODE_VALIDATION_ERROR;
use crate::util::Result;

pub struct HooksDeps<'a> {
    pub hook_installer: &'a dyn HookInstaller,
    pub git_client: &'a dyn GitClient,
    pub formatter: &'a dyn OutputFormatter,
}

pub fn run(action: &HooksAction, deps: &HooksDeps<'_>, io: &mut Io<'_>) -> Result<i32> {
    let Ok(repo_root) = deps.git_client.repo_root() else {
        return fail(deps.formatter, io, "Not inside a git repository");
    };
    let repo_root = Path::new(&repo_root);

    match action {
        HooksAction::Install { force } => {
            let result = deps.hook_installer.install(repo_root, *force)?;

            if !result.installed {
                return fail(
                    deps.formatter,
                    io,
                    &format!(
                        "Hook already exists at {}. Use --force to overwrite (existing hook will be backed up to .bak).",
                        result.hook_path.display()
                    ),
                );
            }

            if let Some(backup) = &result.backed_up {
                io.print(&deps.formatter.format_success(
                    &format!("Existing hook backed up to {}", backup.display()),
                    None,
                ))?;
            }

            let message = if result.already_installed {
                "Lore commit-msg hook updated.".to_owned()
            } else {
                format!(
                    "Lore commit-msg hook installed at {}",
                    result.hook_path.display()
                )
            };
            io.print(&deps.formatter.format_success(&message, None))?;
            Ok(EXIT_OK)
        }
        HooksAction::Uninstall => {
            let result = deps.hook_installer.uninstall(repo_root)?;

            if result.not_lore_hook {
                return fail(
                    deps.formatter,
                    io,
                    &format!(
                        "Hook at {} was not installed by Lore. Remove it manually if needed.",
                        result.hook_path.display()
                    ),
                );
            }

            let message = if result.removed {
                "Lore commit-msg hook removed."
            } else {
                "No commit-msg hook found. Nothing to remove."
            };
            io.print(&deps.formatter.format_success(message, None))?;
            Ok(EXIT_OK)
        }
    }
}

/// Print a formatted error to stderr and return exit code 1 (the TS command
/// reported these failures itself rather than throwing).
fn fail(formatter: &dyn OutputFormatter, io: &mut Io<'_>, message: &str) -> Result<i32> {
    io.eprint(
        &formatter.format_error(EXIT_CODE_VALIDATION_ERROR, &[ErrorMessage::error(message)]),
    )?;
    Ok(EXIT_CODE_VALIDATION_ERROR)
}
