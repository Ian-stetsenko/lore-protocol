//! Generates shell script content for Lore-managed git hooks.
//!
//! Only produces strings; no filesystem access (that is the installer's job).

use std::sync::LazyLock;

use regex::Regex;

use crate::interfaces::hook_installer::HookScriptGenerator;
use crate::types::config::HooksConfig;

/// Marker line that identifies a hook as Lore-managed.
pub const LORE_MARKER: &str = "# LORE-MANAGED-HOOK";

/// Skip patterns must be plain regex characters so they can be interpolated
/// into `[[ "$COMMIT_MSG" =~ <pattern> ]]` unquoted.
static SAFE_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[a-zA-Z0-9 ^$.*+?|\[\]()\\/_-]+$").expect("valid regex"));

/// Skip authors are interpolated inside double quotes, so quotes, `$`,
/// backticks, backslashes and newlines are rejected.
static SAFE_AUTHOR: LazyLock<Regex> =
    LazyLock::new(|| Regex::new("^[^\"$`\\\\\n]+$").expect("valid regex"));

/// Bash `commit-msg` hook generator.
#[derive(Debug, Default, Clone, Copy)]
pub struct BashHookScriptGenerator;

impl BashHookScriptGenerator {
    pub fn new() -> Self {
        BashHookScriptGenerator
    }
}

impl HookScriptGenerator for BashHookScriptGenerator {
    fn generate_commit_msg_hook(&self, config: &HooksConfig) -> String {
        let mut lines: Vec<String> = vec![
            "#!/usr/bin/env bash".to_owned(),
            format!("{LORE_MARKER} — do not edit manually. Reinstall with: lore hooks install"),
            String::new(),
            "COMMIT_MSG_FILE=\"$1\"".to_owned(),
            "COMMIT_MSG=$(cat \"$COMMIT_MSG_FILE\")".to_owned(),
            String::new(),
        ];

        // Skip fixup/squash commits
        if config.allow_fixup {
            lines.extend([
                "# Skip fixup/squash commits (validated after squash)".to_owned(),
                "if [[ \"$COMMIT_MSG\" =~ ^(fixup|squash)! ]]; then".to_owned(),
                "  exit 0".to_owned(),
                "fi".to_owned(),
                String::new(),
            ]);
        }

        // Skip patterns from config (validated for shell safety)
        for pattern in &config.skip_patterns {
            if !SAFE_PATTERN.is_match(pattern) {
                continue;
            }
            lines.extend([
                format!("# Skip pattern: {pattern}"),
                format!("if [[ \"$COMMIT_MSG\" =~ {pattern} ]]; then"),
                "  exit 0".to_owned(),
                "fi".to_owned(),
                String::new(),
            ]);
        }

        // Skip authors from config (validated for shell safety)
        let safe_authors: Vec<&String> = config
            .skip_authors
            .iter()
            .filter(|a| SAFE_AUTHOR.is_match(a))
            .collect();
        if !safe_authors.is_empty() {
            lines.push("# Skip configured authors".to_owned());
            lines
                .push("AUTHOR=$(git var GIT_AUTHOR_IDENT 2>/dev/null | sed 's/>.*/>/')".to_owned());
            for author in safe_authors {
                lines.extend([
                    format!("if [[ \"$AUTHOR\" == *\"{author}\"* ]]; then"),
                    "  exit 0".to_owned(),
                    "fi".to_owned(),
                ]);
            }
            lines.push(String::new());
        }

        // Run validation against the commit message file
        let strict_flag = if config.enforce { " --strict" } else { "" };
        lines.extend([
            "# Run Lore protocol validation against the commit message file".to_owned(),
            "if command -v lore &> /dev/null; then".to_owned(),
            format!("  lore validate --commit-msg-file \"$COMMIT_MSG_FILE\"{strict_flag}"),
            "else".to_owned(),
            format!(
                "  npx --yes lore-protocol validate --commit-msg-file \"$COMMIT_MSG_FILE\"{strict_flag}"
            ),
            "fi".to_owned(),
            String::new(),
        ]);

        lines.join("\n")
    }
}

#[cfg(test)]
mod tests;
