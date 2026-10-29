//! Loads and merges `.lore/config.toml` files.
//!
//! Walks up the directory tree for monorepo support: every config found is
//! merged parent-first so the nearest file wins. Merging happens at the
//! SECTION level (a child `[stale]` table replaces the parent's `[stale]`
//! table entirely), mirroring the TypeScript spread merge.

use std::path::{Path, PathBuf};

use toml::{Table, Value};

use crate::interfaces::config_loader::ConfigLoader;
use crate::types::config::{
    CliConfig, FollowConfig, HooksConfig, LoreConfig, OutputConfig, OutputFormat, ProtocolConfig,
    StaleConfig, TrailersConfig, ValidationConfig,
};
use crate::util::constants::{CONFIG_DIR, CONFIG_FILENAME};
use crate::util::Result;

/// Filesystem-backed [`ConfigLoader`] for TOML configuration.
#[derive(Debug, Default, Clone, Copy)]
pub struct TomlConfigLoader;

impl TomlConfigLoader {
    pub fn new() -> Self {
        TomlConfigLoader
    }

    /// Walk up from `start_path` collecting `.lore/config.toml` paths,
    /// nearest first. Stops after the first hit when `stop_at_first`.
    fn walk_config_paths(&self, start_path: &Path, stop_at_first: bool) -> Result<Vec<PathBuf>> {
        let mut paths = Vec::new();
        let mut dir = resolve_start_dir(start_path)?;

        loop {
            let config_path = dir.join(CONFIG_DIR).join(CONFIG_FILENAME);
            if config_path.exists() {
                paths.push(config_path);
                if stop_at_first {
                    return Ok(paths);
                }
            }

            match dir.parent() {
                Some(parent) if parent != dir => dir = parent.to_path_buf(),
                _ => break,
            }
        }

        Ok(paths)
    }

    fn parse_config_file(&self, config_path: &Path) -> Result<Table> {
        let content = std::fs::read_to_string(config_path)?;
        let table: Table = toml::from_str(&content)?;
        Ok(table)
    }

    /// Build a [`LoreConfig`] from merged TOML, filling every missing or
    /// mistyped value from the defaults.
    fn build_config(&self, parsed: &Table) -> LoreConfig {
        let defaults = LoreConfig::default();

        let protocol = match section(parsed, "protocol") {
            Some(s) => ProtocolConfig {
                version: string_field(s, "version", "version", &defaults.protocol.version),
            },
            None => defaults.protocol,
        };

        let trailers = match section(parsed, "trailers") {
            Some(s) => TrailersConfig {
                required: string_array_field(
                    s,
                    "required",
                    "required",
                    &defaults.trailers.required,
                ),
                custom: string_array_field(s, "custom", "custom", &defaults.trailers.custom),
            },
            None => defaults.trailers,
        };

        let validation = match section(parsed, "validation") {
            Some(s) => ValidationConfig {
                strict: bool_field(s, "strict", "strict", defaults.validation.strict),
                max_message_lines: usize_field(
                    s,
                    "max_message_lines",
                    "maxMessageLines",
                    defaults.validation.max_message_lines,
                ),
                intent_max_length: usize_field(
                    s,
                    "intent_max_length",
                    "intentMaxLength",
                    defaults.validation.intent_max_length,
                ),
            },
            None => defaults.validation,
        };

        let stale = match section(parsed, "stale") {
            Some(s) => StaleConfig {
                older_than: string_field(s, "older_than", "olderThan", &defaults.stale.older_than),
                drift_threshold: usize_field(
                    s,
                    "drift_threshold",
                    "driftThreshold",
                    defaults.stale.drift_threshold,
                ),
            },
            None => defaults.stale,
        };

        let output = match section(parsed, "output") {
            Some(s) => {
                let raw = string_field(
                    s,
                    "default_format",
                    "defaultFormat",
                    defaults.output.default_format.as_str(),
                );
                OutputConfig {
                    // Anything other than `text`/`json` falls back to the default.
                    default_format: OutputFormat::parse(&raw)
                        .unwrap_or(defaults.output.default_format),
                }
            }
            None => defaults.output,
        };

        let follow = match section(parsed, "follow") {
            Some(s) => FollowConfig {
                max_depth: usize_field(s, "max_depth", "maxDepth", defaults.follow.max_depth),
            },
            None => defaults.follow,
        };

        let cli = match section(parsed, "cli") {
            Some(s) => CliConfig {
                update_check: bool_field(
                    s,
                    "update_check",
                    "updateCheck",
                    defaults.cli.update_check,
                ),
            },
            None => defaults.cli,
        };

        let hooks = match section(parsed, "hooks") {
            Some(s) => HooksConfig {
                enforce: bool_field(s, "enforce", "enforce", defaults.hooks.enforce),
                allow_fixup: bool_field(s, "allow_fixup", "allowFixup", defaults.hooks.allow_fixup),
                skip_authors: string_array_field(
                    s,
                    "skip_authors",
                    "skipAuthors",
                    &defaults.hooks.skip_authors,
                ),
                skip_patterns: string_array_field(
                    s,
                    "skip_patterns",
                    "skipPatterns",
                    &defaults.hooks.skip_patterns,
                ),
            },
            None => defaults.hooks,
        };

        LoreConfig {
            protocol,
            trailers,
            validation,
            stale,
            output,
            follow,
            cli,
            hooks,
        }
    }
}

impl ConfigLoader for TomlConfigLoader {
    fn load_for_path(&self, target_path: &Path) -> Result<LoreConfig> {
        let config_paths = self.walk_config_paths(target_path, false)?;

        if config_paths.is_empty() {
            return Ok(LoreConfig::default());
        }

        // Merge parent-first so the child overrides the parent, section by section.
        let mut merged = Table::new();
        for config_path in config_paths.iter().rev() {
            let parsed = self.parse_config_file(config_path)?;
            for (key, value) in parsed {
                merged.insert(key, value);
            }
        }

        Ok(self.build_config(&merged))
    }

    fn load_from_file(&self, config_path: &Path) -> Result<LoreConfig> {
        let parsed = self.parse_config_file(config_path)?;
        Ok(self.build_config(&parsed))
    }

    fn find_config_path(&self, start_path: &Path) -> Result<Option<PathBuf>> {
        let paths = self.walk_config_paths(start_path, true)?;
        Ok(paths.into_iter().next())
    }
}

/// Resolve a start path to the directory to begin walking from: a file
/// starts from its parent; a non-existent path with an extension is
/// treated as a file.
fn resolve_start_dir(start_path: &Path) -> Result<PathBuf> {
    let resolved = if start_path.as_os_str().is_empty() {
        std::env::current_dir()?
    } else {
        std::path::absolute(start_path)?
    };

    let parent_of = |p: &Path| {
        p.parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| p.to_path_buf())
    };

    match std::fs::metadata(&resolved) {
        Ok(meta) if meta.is_file() => Ok(parent_of(&resolved)),
        Ok(_) => Ok(resolved),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            if resolved.extension().is_some() {
                Ok(parent_of(&resolved))
            } else {
                Ok(resolved)
            }
        }
        Err(_) => Ok(resolved),
    }
}

/// A section table, or `None` when missing or not a table.
fn section<'t>(parsed: &'t Table, name: &str) -> Option<&'t Table> {
    parsed.get(name).and_then(Value::as_table)
}

/// The raw value for a field: snake_case key first, then the camelCase alias.
fn field<'t>(section: &'t Table, snake: &str, camel: &str) -> Option<&'t Value> {
    section.get(snake).or_else(|| section.get(camel))
}

fn string_field(section: &Table, snake: &str, camel: &str, default: &str) -> String {
    match field(section, snake, camel) {
        Some(Value::String(s)) => s.clone(),
        _ => default.to_owned(),
    }
}

fn bool_field(section: &Table, snake: &str, camel: &str, default: bool) -> bool {
    match field(section, snake, camel) {
        Some(Value::Boolean(b)) => *b,
        _ => default,
    }
}

/// Integers only; floats, negatives and out-of-range values fall back.
fn usize_field(section: &Table, snake: &str, camel: &str, default: usize) -> usize {
    match field(section, snake, camel) {
        Some(Value::Integer(i)) => usize::try_from(*i).unwrap_or(default),
        _ => default,
    }
}

/// Arrays only; non-string elements are dropped (TS kept them untyped).
fn string_array_field(
    section: &Table,
    snake: &str,
    camel: &str,
    default: &[String],
) -> Vec<String> {
    match field(section, snake, camel) {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect(),
        _ => default.to_vec(),
    }
}

#[cfg(test)]
mod tests;
