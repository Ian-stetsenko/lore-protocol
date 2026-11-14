//! `lore init`: create `.lore/config.toml` with defaults, or report how an
//! existing config differs from the current defaults (drift detection).

use std::fs;
use std::path::Path;

use toml::{Table, Value};

use crate::commands::{Io, EXIT_OK};
use crate::interfaces::output_formatter::OutputFormatter;
use crate::types::config::DEFAULT_CONFIG_TOML;
use crate::util::constants::{CONFIG_DIR, CONFIG_FILENAME};
use crate::util::{LoreError, Result};

pub struct InitDeps<'a> {
    pub formatter: &'a dyn OutputFormatter,
    /// Directory the config is created in (the process cwd in production).
    pub cwd: &'a Path,
}

/// Differences between a user's config and the current defaults.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ConfigDiff {
    /// `[section] section` or `section.key` entries absent from the user config.
    pub missing: Vec<String>,
    /// `section.key` entries whose value differs from the default.
    pub customized: Vec<String>,
}

pub fn run(deps: &InitDeps<'_>, io: &mut Io<'_>) -> Result<i32> {
    let config_dir = deps.cwd.join(CONFIG_DIR);
    let config_path = config_dir.join(CONFIG_FILENAME);
    let display_path = format!("{CONFIG_DIR}/{CONFIG_FILENAME}");

    if config_path.exists() {
        let content = fs::read_to_string(&config_path)?;
        io.print(
            &deps
                .formatter
                .format_success(&format!("Config already exists at {display_path}:"), None),
        )?;
        io.print(&content)?;

        let parsed: Table = match toml::from_str(&content) {
            Ok(table) => table,
            Err(err) => {
                return Err(LoreError::new(format!(
                    "Your configuration file is corrupted and cannot be parsed: {err}\n\nPlease fix the TOML syntax or reset your config.\nExample: mv {display_path} {display_path}.corrupted && lore init"
                )));
            }
        };

        let diff = find_config_diff(&parsed);

        if !diff.missing.is_empty() {
            io.print(&format!(
                "\n{}",
                deps.formatter
                    .format_success("Your configuration is missing new options:", None)
            ))?;
            for item in &diff.missing {
                io.print(&format!("  - {item}"))?;
            }

            if diff.customized.is_empty() {
                io.print("\nNotice: You are using default settings. You can safely reset your config to get the latest options.")?;
                io.print(&format!("Example: rm {display_path} && lore init"))?;
            } else {
                io.print("\nNotice: You have customized the following options:")?;
                for item in &diff.customized {
                    io.print(&format!("  - {item}"))?;
                }
                io.print("\nTo update: Rename your current config, run `lore init` again, and manually merge your changes.")?;
                io.print(&format!(
                    "Example: mv {display_path} {display_path}.bak && lore init"
                ))?;
            }
        }
        return Ok(EXIT_OK);
    }

    fs::create_dir_all(&config_dir)?;
    fs::write(&config_path, DEFAULT_CONFIG_TOML)?;

    io.print(&deps.formatter.format_success(
        &format!("Created {display_path} with protocol version 1.0"),
        None,
    ))?;
    Ok(EXIT_OK)
}

/// Compare a parsed user config against the canonical defaults
/// ([`DEFAULT_CONFIG_TOML`]), section by section and key by key. Keys are
/// looked up in snake_case first, then camelCase.
pub fn find_config_diff(parsed: &Table) -> ConfigDiff {
    let defaults: Table = toml::from_str(DEFAULT_CONFIG_TOML).unwrap_or_default();
    let mut diff = ConfigDiff::default();

    for (section, default_section) in &defaults {
        let Some(user_section) = parsed.get(section).and_then(Value::as_table) else {
            diff.missing.push(format!("[{section}] section"));
            continue;
        };
        let Some(default_section) = default_section.as_table() else {
            continue;
        };

        for (snake_key, default_value) in default_section {
            let user_value = user_section
                .get(snake_key)
                .or_else(|| user_section.get(&snake_to_camel(snake_key)));
            match user_value {
                None => diff.missing.push(format!("{section}.{snake_key}")),
                Some(value) if value != default_value => {
                    diff.customized.push(format!("{section}.{snake_key}"));
                }
                Some(_) => {}
            }
        }
    }

    diff
}

fn snake_to_camel(key: &str) -> String {
    let mut out = String::with_capacity(key.len());
    let mut upper_next = false;
    for ch in key.chars() {
        if ch == '_' {
            upper_next = true;
        } else if upper_next {
            out.extend(ch.to_uppercase());
            upper_next = false;
        } else {
            out.push(ch);
        }
    }
    out
}

#[cfg(test)]
mod tests;
