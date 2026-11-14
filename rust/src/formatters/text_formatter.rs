//! Human-readable text output formatter.
//!
//! Mirrors the TypeScript `TextFormatter` byte-for-byte, including the ANSI
//! escape sequences chalk emits at colour level 1 when colour is enabled.

use chrono::{DateTime, Utc};

use crate::interfaces::output_formatter::{ErrorMessage, OutputFormatter};
use crate::types::domain::{LoreAtom, TrailerKey};
use crate::types::output::{
    DoctorStatus, FormattableDoctorResult, FormattableQueryResult, FormattableStalenessResult,
    FormattableTraceResult, FormattableValidationResult, Severity, VisibleTrailers,
};

/// Width (in characters) of an atom header rule in query output.
const HEADER_WIDTH: usize = 60;

/// One SGR (Select Graphic Rendition) pair, as chalk defines them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Sgr {
    open: &'static str,
    close: &'static str,
}

const BOLD: Sgr = Sgr {
    open: "\x1b[1m",
    close: "\x1b[22m",
};
const DIM: Sgr = Sgr {
    open: "\x1b[2m",
    close: "\x1b[22m",
};
const STRIKETHROUGH: Sgr = Sgr {
    open: "\x1b[9m",
    close: "\x1b[29m",
};
const RED: Sgr = Sgr {
    open: "\x1b[31m",
    close: "\x1b[39m",
};
const GREEN: Sgr = Sgr {
    open: "\x1b[32m",
    close: "\x1b[39m",
};
const YELLOW: Sgr = Sgr {
    open: "\x1b[33m",
    close: "\x1b[39m",
};
const BLUE: Sgr = Sgr {
    open: "\x1b[34m",
    close: "\x1b[39m",
};
const MAGENTA: Sgr = Sgr {
    open: "\x1b[35m",
    close: "\x1b[39m",
};
const CYAN: Sgr = Sgr {
    open: "\x1b[36m",
    close: "\x1b[39m",
};

/// Minimal stand-in for a chalk instance: wraps text in SGR codes only when
/// colour is enabled, reproducing chalk's level-1 `applyStyle` behaviour.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Style {
    enabled: bool,
}

impl Style {
    /// Apply a chain of styles, listed outermost first (`chalk.dim.strikethrough`
    /// is `&[DIM, STRIKETHROUGH]`).
    ///
    /// Like chalk: an empty string stays empty; close codes already present in
    /// the text are replaced by the corresponding open code so the style
    /// survives; and every line break is wrapped as `closeAll + "\n" + openAll`
    /// so each line is styled independently.
    fn apply(self, chain: &[Sgr], text: &str) -> String {
        if !self.enabled || text.is_empty() {
            return text.to_owned();
        }

        let open_all: String = chain.iter().map(|s| s.open).collect();
        let close_all: String = chain.iter().rev().map(|s| s.close).collect();

        let mut body = text.to_owned();
        if body.contains('\x1b') {
            // Inner-most style first, as chalk walks the styler parent chain.
            for sgr in chain.iter().rev() {
                body = body.replace(sgr.close, sgr.open);
            }
        }

        if body.contains('\n') {
            body = encase_line_breaks(&body, &close_all, &open_all);
        }

        format!("{open_all}{body}{close_all}")
    }
}

/// chalk's `stringEncaseCRLFWithFirstIndex`: insert `prefix` before and
/// `postfix` after every `\n` (or `\r\n`) in `text`.
fn encase_line_breaks(text: &str, prefix: &str, postfix: &str) -> String {
    let mut out = String::with_capacity(text.len() + prefix.len() + postfix.len());
    let mut rest = text;
    while let Some(idx) = rest.find('\n') {
        let (line, after) = rest.split_at(idx);
        if let Some(stripped) = line.strip_suffix('\r') {
            out.push_str(stripped);
            out.push_str(prefix);
            out.push_str("\r\n");
        } else {
            out.push_str(line);
            out.push_str(prefix);
            out.push('\n');
        }
        out.push_str(postfix);
        rest = &after[1..];
    }
    out.push_str(rest);
    out
}

/// Renders results as human-readable text, optionally with ANSI colour.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TextFormatter {
    c: Style,
}

impl TextFormatter {
    /// Create a formatter; `color` enables ANSI escape sequences.
    pub fn new(color: bool) -> Self {
        TextFormatter {
            c: Style { enabled: color },
        }
    }

    fn bold(&self, text: &str) -> String {
        self.c.apply(&[BOLD], text)
    }

    fn dim(&self, text: &str) -> String {
        self.c.apply(&[DIM], text)
    }

    fn dim_strikethrough(&self, text: &str) -> String {
        self.c.apply(&[DIM, STRIKETHROUGH], text)
    }

    fn red(&self, text: &str) -> String {
        self.c.apply(&[RED], text)
    }

    fn green(&self, text: &str) -> String {
        self.c.apply(&[GREEN], text)
    }

    fn yellow(&self, text: &str) -> String {
        self.c.apply(&[YELLOW], text)
    }

    fn blue(&self, text: &str) -> String {
        self.c.apply(&[BLUE], text)
    }

    fn magenta(&self, text: &str) -> String {
        self.c.apply(&[MAGENTA], text)
    }

    fn cyan(&self, text: &str) -> String {
        self.c.apply(&[CYAN], text)
    }

    /// `── <id> (<date>, <author>) ` padded with `─` to 60 characters; bold
    /// for active atoms, dim strikethrough for superseded ones.
    fn format_atom_header(&self, atom: &LoreAtom, superseded: bool) -> String {
        let date_str = format_date(atom.date);
        let mut header = format!(
            "\u{2500}\u{2500} {} ({date_str}, {}) ",
            atom.lore_id, atom.author
        );
        // JS `header.length` counts UTF-16 units; all protocol characters used
        // here are in the BMP, so `chars()` gives the same count.
        let used = header.chars().count();
        header.push_str(&"\u{2500}".repeat(HEADER_WIDTH.saturating_sub(used)));

        if superseded {
            self.dim_strikethrough(&header)
        } else {
            self.bold(&header)
        }
    }

    /// The styled `Key:` label for a trailer line (colour per key, as in TS).
    fn trailer_label(&self, key: TrailerKey) -> String {
        let text = format!("{}:", key.as_str());
        match key {
            TrailerKey::Rejected => self.magenta(&text),
            TrailerKey::Directive => self.yellow(&text),
            TrailerKey::Tested => self.green(&text),
            TrailerKey::NotTested => self.red(&text),
            TrailerKey::Supersedes | TrailerKey::DependsOn | TrailerKey::Related => self.dim(&text),
            // Constraint, Confidence, Scope-risk, Reversibility (Lore-id is never listed).
            _ => self.cyan(&text),
        }
    }

    /// One `Key: value` line per visible, populated trailer, in protocol order.
    fn format_trailers(&self, atom: &LoreAtom, visible: &VisibleTrailers) -> Vec<String> {
        let mut lines = Vec::new();
        let trailers = &atom.trailers;

        // Same order as the TS implementation (protocol order minus Lore-id).
        let keys = [
            TrailerKey::Constraint,
            TrailerKey::Rejected,
            TrailerKey::Confidence,
            TrailerKey::ScopeRisk,
            TrailerKey::Reversibility,
            TrailerKey::Directive,
            TrailerKey::Tested,
            TrailerKey::NotTested,
            TrailerKey::Supersedes,
            TrailerKey::DependsOn,
            TrailerKey::Related,
        ];

        for key in keys {
            if !visible.shows(key) {
                continue;
            }
            if let Some(values) = trailers.array_values(key) {
                for v in values {
                    lines.push(format!("{} {v}", self.trailer_label(key)));
                }
            } else if let Some(value) = trailers.enum_value(key) {
                lines.push(format!("{} {value}", self.trailer_label(key)));
            }
        }

        lines
    }
}

/// `date.toISOString().slice(0, 10)`: the UTC calendar date.
fn format_date(date: DateTime<Utc>) -> String {
    date.format("%Y-%m-%d").to_string()
}

impl OutputFormatter for TextFormatter {
    fn format_query_result(&self, data: &FormattableQueryResult) -> String {
        let result = &data.result;
        let mut lines: Vec<String> = Vec::new();

        if result.atoms.is_empty() {
            lines.push(self.dim("No lore atoms found."));
            return lines.join("\n");
        }

        for atom in &result.atoms {
            let supersession = data.supersession_map.get(&atom.lore_id);
            let is_superseded = supersession.map(|s| s.superseded).unwrap_or(false);

            lines.push(self.format_atom_header(atom, is_superseded));

            if is_superseded {
                if let Some(by) = supersession
                    .and_then(|s| s.superseded_by.as_deref())
                    .filter(|by| !by.is_empty())
                {
                    lines.push(self.dim(&format!("  (superseded by {by})")));
                }
            }

            if !atom.body.is_empty() {
                lines.push(format!("  {}", self.dim(&atom.body)));
            }

            for tl in self.format_trailers(atom, &data.visible_trailers) {
                lines.push(format!("  {tl}"));
            }

            lines.push(String::new());
        }

        lines.push(self.dim(&format!(
            "{} of {} atoms shown",
            result.meta.filtered_atoms, result.meta.total_atoms
        )));

        lines.join("\n")
    }

    fn format_validation_result(&self, data: &FormattableValidationResult) -> String {
        let mut lines: Vec<String> = Vec::new();

        for commit_result in &data.results {
            let icon = if commit_result.valid {
                self.green("\u{2713}")
            } else {
                self.red("\u{2717}")
            };
            let label = match &commit_result.lore_id {
                Some(id) => id.clone(),
                None => commit_result.commit.chars().take(8).collect(),
            };
            lines.push(format!("{icon} {label}"));

            for issue in &commit_result.issues {
                let severity = match issue.severity {
                    Severity::Error => self.red("\u{2717}"),
                    Severity::Warning => self.yellow("\u{26A0}"),
                };
                lines.push(format!("  {severity} [{}] {}", issue.rule, issue.message));
            }
        }

        lines.push(String::new());
        let mut summary_parts: Vec<String> =
            vec![format!("{} commits checked", data.summary.commits_checked)];
        if data.summary.errors > 0 {
            summary_parts.push(self.red(&format!("{} errors", data.summary.errors)));
        }
        if data.summary.warnings > 0 {
            summary_parts.push(self.yellow(&format!("{} warnings", data.summary.warnings)));
        }
        if data.summary.errors == 0 && data.summary.warnings == 0 {
            summary_parts.push(self.green("all valid"));
        }
        lines.push(summary_parts.join(", "));

        lines.join("\n")
    }

    fn format_staleness_result(&self, data: &FormattableStalenessResult) -> String {
        let mut lines: Vec<String> = Vec::new();

        if data.atoms.is_empty() {
            lines.push(self.green("No stale atoms found."));
            return lines.join("\n");
        }

        for report in &data.atoms {
            let date_str = format_date(report.atom.date);
            lines.push(format!(
                "{}  {} ({date_str})",
                self.yellow("STALE"),
                self.bold(&report.atom.lore_id)
            ));
            lines.push(format!("  {}", self.dim(&report.atom.intent)));
            for reason in &report.reasons {
                lines.push(format!(
                    "  {} {}",
                    self.yellow("\u{26A0}"),
                    reason.description
                ));
            }
            lines.push(String::new());
        }

        lines.join("\n")
    }

    fn format_trace_result(&self, data: &FormattableTraceResult) -> String {
        let mut lines: Vec<String> = Vec::new();

        lines.push(format!(
            "{} {}",
            self.bold(&data.root.lore_id),
            self.dim(&data.root.intent)
        ));

        let edge_count = data.edges.len();
        for (i, edge) in data.edges.iter().enumerate() {
            let is_last = i + 1 == edge_count;
            let connector = if is_last {
                "\u{2514}\u{2500}\u{2500}"
            } else {
                "\u{251C}\u{2500}\u{2500}"
            };
            let rel_label = self.dim(&format!("[{}]", edge.relationship.as_str()));
            let to = self.bold(&edge.to);

            let tail = match &edge.target_atom {
                Some(target) => self.dim(&target.intent),
                None => self.dim("(unresolved)"),
            };
            lines.push(format!("{connector} {rel_label} {to} {tail}"));
        }

        lines.join("\n")
    }

    fn format_doctor_result(&self, data: &FormattableDoctorResult) -> String {
        let mut lines: Vec<String> = Vec::new();

        for check in &data.checks {
            let status_label = match check.status {
                DoctorStatus::Ok => self.green("OK"),
                DoctorStatus::Warning => self.yellow("WARNING"),
                DoctorStatus::Error => self.red("ERROR"),
                DoctorStatus::Info => self.blue("INFO"),
            };
            lines.push(format!("{status_label}  {}: {}", check.name, check.message));

            for detail in &check.details {
                lines.push(format!("  {}", self.dim(detail)));
            }
        }

        lines.push(String::new());
        let mut summary_parts: Vec<String> = Vec::new();
        if data.summary.errors > 0 {
            summary_parts.push(self.red(&format!("{} errors", data.summary.errors)));
        }
        if data.summary.warnings > 0 {
            summary_parts.push(self.yellow(&format!("{} warnings", data.summary.warnings)));
        }
        if data.summary.info > 0 {
            summary_parts.push(self.blue(&format!("{} info", data.summary.info)));
        }
        if summary_parts.is_empty() {
            summary_parts.push(self.green("all checks passed"));
        }
        lines.push(summary_parts.join(", "));

        lines.join("\n")
    }

    fn format_success(
        &self,
        message: &str,
        _data: Option<&serde_json::Map<String, serde_json::Value>>,
    ) -> String {
        self.green(message)
    }

    fn format_error(&self, code: i32, messages: &[ErrorMessage]) -> String {
        let mut lines: Vec<String> = Vec::new();

        for msg in messages {
            let prefix = match msg.severity {
                Severity::Error => self.red("error"),
                Severity::Warning => self.yellow("warning"),
            };
            // `msg.field ? ...` is falsy for an empty string too.
            let field = match msg.field.as_deref() {
                Some(f) if !f.is_empty() => format!(" [{f}]"),
                _ => String::new(),
            };
            lines.push(format!("{prefix}{field}: {}", msg.message));
        }

        if code != 0 {
            lines.push(self.dim(&format!("(exit code {code})")));
        }

        lines.join("\n")
    }
}

#[cfg(test)]
mod tests;
