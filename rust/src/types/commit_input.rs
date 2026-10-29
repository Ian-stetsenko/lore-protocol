//! Input shapes for `lore commit`.

use std::path::PathBuf;

use super::custom_trailer_collection::CustomTrailerCollection;
use super::domain::TrailerKey;

/// Resolved commit input, regardless of source (JSON, flags, interactive).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CommitInput {
    pub intent: String,
    pub body: Option<String>,
    pub trailers: Option<CommitInputTrailers>,
}

/// Trailer values supplied by the user. Enum values are raw strings so that
/// invalid values can be reported by validation rather than rejected at parse.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CommitInputTrailers {
    pub constraint: Option<Vec<String>>,
    pub rejected: Option<Vec<String>>,
    pub confidence: Option<String>,
    pub scope_risk: Option<String>,
    pub reversibility: Option<String>,
    pub directive: Option<Vec<String>>,
    pub tested: Option<Vec<String>>,
    pub not_tested: Option<Vec<String>>,
    pub supersedes: Option<Vec<String>>,
    pub depends_on: Option<Vec<String>>,
    pub related: Option<Vec<String>>,
    pub custom: Option<CustomTrailerCollection>,
}

impl CommitInputTrailers {
    /// Values of an array trailer, if supplied. `None` for non-array keys.
    pub fn array(&self, key: TrailerKey) -> Option<&Vec<String>> {
        match key {
            TrailerKey::Constraint => self.constraint.as_ref(),
            TrailerKey::Rejected => self.rejected.as_ref(),
            TrailerKey::Directive => self.directive.as_ref(),
            TrailerKey::Tested => self.tested.as_ref(),
            TrailerKey::NotTested => self.not_tested.as_ref(),
            TrailerKey::Supersedes => self.supersedes.as_ref(),
            TrailerKey::DependsOn => self.depends_on.as_ref(),
            TrailerKey::Related => self.related.as_ref(),
            _ => None,
        }
    }

    /// Raw value of an enum trailer, if supplied. `None` for non-enum keys.
    pub fn enum_value(&self, key: TrailerKey) -> Option<&str> {
        match key {
            TrailerKey::Confidence => self.confidence.as_deref(),
            TrailerKey::ScopeRisk => self.scope_risk.as_deref(),
            TrailerKey::Reversibility => self.reversibility.as_deref(),
            _ => None,
        }
    }

    /// Set an array trailer. Ignored for non-array keys.
    pub fn set_array(&mut self, key: TrailerKey, values: Option<Vec<String>>) {
        match key {
            TrailerKey::Constraint => self.constraint = values,
            TrailerKey::Rejected => self.rejected = values,
            TrailerKey::Directive => self.directive = values,
            TrailerKey::Tested => self.tested = values,
            TrailerKey::NotTested => self.not_tested = values,
            TrailerKey::Supersedes => self.supersedes = values,
            TrailerKey::DependsOn => self.depends_on = values,
            TrailerKey::Related => self.related = values,
            _ => {}
        }
    }

    /// Set an enum trailer. Ignored for non-enum keys.
    pub fn set_enum(&mut self, key: TrailerKey, value: Option<String>) {
        match key {
            TrailerKey::Confidence => self.confidence = value,
            TrailerKey::ScopeRisk => self.scope_risk = value,
            TrailerKey::Reversibility => self.reversibility = value,
            _ => {}
        }
    }

    /// Whether the trailer named `key` (known or custom) has a non-empty value.
    pub fn has(&self, key: &str) -> bool {
        match TrailerKey::parse(key) {
            Some(k) if k.is_array() => self.array(k).map(|v| !v.is_empty()).unwrap_or(false),
            Some(k) if k.is_enum() => self.enum_value(k).map(|v| !v.is_empty()).unwrap_or(false),
            Some(_) => false,
            None => self.custom.as_ref().map(|c| c.has(key)).unwrap_or(false),
        }
    }
}

/// Options of the `lore commit` command, independent of the CLI parser.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CommitCommandOptions {
    pub amend: bool,
    pub no_edit: bool,
    pub file: Option<PathBuf>,
    pub interactive: bool,
    pub intent: Option<String>,
    pub body: Option<String>,
    pub constraint: Option<Vec<String>>,
    pub rejected: Option<Vec<String>>,
    pub confidence: Option<String>,
    pub scope_risk: Option<String>,
    pub reversibility: Option<String>,
    pub directive: Option<Vec<String>>,
    pub tested: Option<Vec<String>>,
    pub not_tested: Option<Vec<String>>,
    pub supersedes: Option<Vec<String>>,
    pub depends_on: Option<Vec<String>>,
    pub related: Option<Vec<String>>,
}

impl CommitCommandOptions {
    /// Whether any user-supplied input (anything other than `--amend` /
    /// `--no-edit`) is present.
    pub fn has_input(&self) -> bool {
        self.file.is_some()
            || self.interactive
            || self.intent.is_some()
            || self.body.is_some()
            || self.constraint.is_some()
            || self.rejected.is_some()
            || self.confidence.is_some()
            || self.scope_risk.is_some()
            || self.reversibility.is_some()
            || self.directive.is_some()
            || self.tested.is_some()
            || self.not_tested.is_some()
            || self.supersedes.is_some()
            || self.depends_on.is_some()
            || self.related.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn has_input_ignores_amend_and_no_edit() {
        let opts = CommitCommandOptions {
            amend: true,
            no_edit: true,
            ..Default::default()
        };
        assert!(!opts.has_input());

        let with_intent = CommitCommandOptions {
            intent: Some("x".into()),
            ..Default::default()
        };
        assert!(with_intent.has_input());

        let with_related = CommitCommandOptions {
            related: Some(vec!["a1b2c3d4".into()]),
            ..Default::default()
        };
        assert!(with_related.has_input());
    }

    #[test]
    fn trailer_accessors_round_trip() {
        let mut t = CommitInputTrailers::default();
        t.set_array(TrailerKey::Tested, Some(vec!["unit".into()]));
        t.set_enum(TrailerKey::Confidence, Some("high".into()));
        assert_eq!(
            t.array(TrailerKey::Tested).unwrap(),
            &vec!["unit".to_owned()]
        );
        assert_eq!(t.enum_value(TrailerKey::Confidence), Some("high"));
        assert!(t.has("Tested"));
        assert!(t.has("Confidence"));
        assert!(!t.has("Rejected"));
        assert!(!t.has("Lore-id"));
        assert!(!t.has("Ticket"));
    }
}
