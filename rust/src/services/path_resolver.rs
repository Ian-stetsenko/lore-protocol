//! Resolves a CLI target argument into a [`QueryTarget`] and translates it
//! into git `log` / `blame` arguments.
//!
//! Only target classification and argument translation live here; no git
//! interaction.

use std::sync::LazyLock;

use regex::Regex;

use crate::types::query::{QueryTarget, TargetType};

static LINE_RANGE_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(.+):(\d+)-(\d+)$").expect("valid regex"));
static SINGLE_LINE_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(.+):(\d+)$").expect("valid regex"));

/// Arguments for `git blame -L line_start,line_end file`.
///
/// `line_end == None` means "to end of file" (the TS implementation used a
/// `-1` sentinel for the same meaning).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlameArgs {
    pub file: String,
    pub line_start: u32,
    pub line_end: Option<u32>,
}

/// Classifies CLI targets and converts them to git arguments.
#[derive(Debug, Clone, Copy, Default)]
pub struct PathResolver;

impl PathResolver {
    pub fn new() -> Self {
        PathResolver
    }

    /// Parse a raw target string into a [`QueryTarget`].
    ///
    /// Classification rules, in order:
    /// - `file.ts:45-80` -> line-range (file + start + end)
    /// - `file.ts:45` -> line-range (file + start, end = start)
    /// - contains `*` or `?` -> glob
    /// - trailing slash -> directory
    /// - everything else -> file
    pub fn parse_target(&self, raw: &str) -> QueryTarget {
        if let Some(caps) = LINE_RANGE_PATTERN.captures(raw) {
            let line_start = parse_line_number(&caps[2]);
            let line_end = parse_line_number(&caps[3]);
            return QueryTarget {
                raw: raw.to_owned(),
                target_type: TargetType::LineRange,
                file_path: caps[1].to_owned(),
                line_start: Some(line_start),
                line_end: Some(line_end),
            };
        }

        if let Some(caps) = SINGLE_LINE_PATTERN.captures(raw) {
            let line_start = parse_line_number(&caps[2]);
            return QueryTarget {
                raw: raw.to_owned(),
                target_type: TargetType::LineRange,
                file_path: caps[1].to_owned(),
                line_start: Some(line_start),
                line_end: Some(line_start),
            };
        }

        let target_type = if raw.contains(['*', '?']) {
            TargetType::Glob
        } else if raw.ends_with('/') {
            TargetType::Directory
        } else {
            TargetType::File
        };

        QueryTarget {
            raw: raw.to_owned(),
            target_type,
            file_path: raw.to_owned(),
            line_start: None,
            line_end: None,
        }
    }

    /// Convert a [`QueryTarget`] into `git log` arguments.
    ///
    /// - file / directory / glob: `["--", file_path]`
    /// - line-range: `["-L", "start,end:file_path"]`
    pub fn to_git_log_args(&self, target: &QueryTarget) -> Vec<String> {
        match target.target_type {
            TargetType::File | TargetType::Directory | TargetType::Glob => {
                vec!["--".to_owned(), target.file_path.clone()]
            }
            TargetType::LineRange => vec![
                "-L".to_owned(),
                format!(
                    "{},{}:{}",
                    optional_line(target.line_start),
                    optional_line(target.line_end),
                    target.file_path
                ),
            ],
        }
    }

    /// Convert a [`QueryTarget`] into `git blame` arguments.
    ///
    /// Line-range targets blame exactly their range; every other target
    /// blames the whole file (line 1 to end of file).
    pub fn to_git_blame_args(&self, target: &QueryTarget) -> BlameArgs {
        if target.target_type == TargetType::LineRange {
            if let (Some(start), Some(end)) = (target.line_start, target.line_end) {
                return BlameArgs {
                    file: target.file_path.clone(),
                    line_start: start,
                    line_end: Some(end),
                };
            }
        }

        BlameArgs {
            file: target.file_path.clone(),
            line_start: 1,
            line_end: None,
        }
    }
}

/// `parseInt(digits, 10)` for a `\d+` capture. Saturates on overflow
/// instead of producing a float like JS would; both are out-of-range inputs.
fn parse_line_number(digits: &str) -> u32 {
    digits.parse::<u32>().unwrap_or(u32::MAX)
}

/// Mirrors JS template interpolation of a nullable number (`null` -> "null").
fn optional_line(line: Option<u32>) -> String {
    match line {
        Some(n) => n.to_string(),
        None => "null".to_owned(),
    }
}

#[cfg(test)]
mod tests;
