//! Core domain model: trailer keys, enum levels, parsed trailers and atoms.

use std::fmt;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::custom_trailer_collection::CustomTrailerCollection;

/// 8-character lowercase hex string identifying a Lore atom.
pub type LoreId = String;

/// The set of recognized Lore trailer keys.
///
/// `as_str()` yields the wire name used in commit messages (`Lore-id`,
/// `Scope-risk`, `Not-tested`, `Depends-on`, ...).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum TrailerKey {
    LoreId,
    Constraint,
    Rejected,
    Confidence,
    ScopeRisk,
    Reversibility,
    Directive,
    Tested,
    NotTested,
    Supersedes,
    DependsOn,
    Related,
}

impl TrailerKey {
    /// Every recognized key, in canonical protocol order.
    pub const ALL: [TrailerKey; 12] = [
        TrailerKey::LoreId,
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

    /// Trailers that accept multiple values (one line per value).
    pub const ARRAY: [TrailerKey; 8] = [
        TrailerKey::Constraint,
        TrailerKey::Rejected,
        TrailerKey::Directive,
        TrailerKey::Tested,
        TrailerKey::NotTested,
        TrailerKey::Supersedes,
        TrailerKey::DependsOn,
        TrailerKey::Related,
    ];

    /// Trailers that accept a single enum value.
    pub const ENUM: [TrailerKey; 3] = [
        TrailerKey::Confidence,
        TrailerKey::ScopeRisk,
        TrailerKey::Reversibility,
    ];

    /// Trailers whose values are Lore-id references to other atoms.
    pub const REFERENCE: [TrailerKey; 3] = [
        TrailerKey::Supersedes,
        TrailerKey::DependsOn,
        TrailerKey::Related,
    ];

    /// The wire name of the trailer as it appears in a commit message.
    pub fn as_str(self) -> &'static str {
        match self {
            TrailerKey::LoreId => "Lore-id",
            TrailerKey::Constraint => "Constraint",
            TrailerKey::Rejected => "Rejected",
            TrailerKey::Confidence => "Confidence",
            TrailerKey::ScopeRisk => "Scope-risk",
            TrailerKey::Reversibility => "Reversibility",
            TrailerKey::Directive => "Directive",
            TrailerKey::Tested => "Tested",
            TrailerKey::NotTested => "Not-tested",
            TrailerKey::Supersedes => "Supersedes",
            TrailerKey::DependsOn => "Depends-on",
            TrailerKey::Related => "Related",
        }
    }

    /// Parse an exact (case-sensitive) wire name into a key.
    pub fn parse(s: &str) -> Option<TrailerKey> {
        TrailerKey::ALL.iter().copied().find(|k| k.as_str() == s)
    }

    pub fn is_array(self) -> bool {
        TrailerKey::ARRAY.contains(&self)
    }

    pub fn is_enum(self) -> bool {
        TrailerKey::ENUM.contains(&self)
    }

    pub fn is_reference(self) -> bool {
        TrailerKey::REFERENCE.contains(&self)
    }
}

impl fmt::Display for TrailerKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

macro_rules! level_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident => $wire:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
        #[serde(rename_all = "kebab-case")]
        pub enum $name {
            $($variant),+
        }

        impl $name {
            /// All values in ascending protocol order (least to most severe).
            pub const ALL: [$name; level_enum!(@count $($variant)+)] = [$($name::$variant),+];

            pub fn as_str(self) -> &'static str {
                match self {
                    $($name::$variant => $wire),+
                }
            }

            /// Parse an exact wire value; returns `None` for anything unrecognized.
            pub fn parse(s: &str) -> Option<$name> {
                match s {
                    $($wire => Some($name::$variant),)+
                    _ => None,
                }
            }

            /// Zero-based position in [`Self::ALL`].
            pub fn index(self) -> usize {
                Self::ALL.iter().position(|v| *v == self).unwrap_or(0)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(self.as_str())
            }
        }
    };
    (@count $($x:ident)+) => { <[()]>::len(&[$(level_enum!(@unit $x)),+]) };
    (@unit $x:ident) => { () };
}

level_enum! {
    /// `Confidence:` levels, ascending.
    ConfidenceLevel { Low => "low", Medium => "medium", High => "high" }
}

level_enum! {
    /// `Scope-risk:` levels, ascending.
    ScopeRiskLevel { Narrow => "narrow", Moderate => "moderate", Wide => "wide" }
}

level_enum! {
    /// `Reversibility:` levels, ascending.
    ReversibilityLevel { Clean => "clean", MigrationNeeded => "migration-needed", Irreversible => "irreversible" }
}

/// Structured view of a commit's Lore trailers.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LoreTrailers {
    pub lore_id: LoreId,
    pub constraint: Vec<String>,
    pub rejected: Vec<String>,
    pub confidence: Option<ConfidenceLevel>,
    pub scope_risk: Option<ScopeRiskLevel>,
    pub reversibility: Option<ReversibilityLevel>,
    pub directive: Vec<String>,
    pub tested: Vec<String>,
    pub not_tested: Vec<String>,
    pub supersedes: Vec<LoreId>,
    pub depends_on: Vec<LoreId>,
    pub related: Vec<LoreId>,
    pub custom: CustomTrailerCollection,
}

impl LoreTrailers {
    /// Values of an array trailer. `None` when `key` is not an array key.
    pub fn array_values(&self, key: TrailerKey) -> Option<&Vec<String>> {
        match key {
            TrailerKey::Constraint => Some(&self.constraint),
            TrailerKey::Rejected => Some(&self.rejected),
            TrailerKey::Directive => Some(&self.directive),
            TrailerKey::Tested => Some(&self.tested),
            TrailerKey::NotTested => Some(&self.not_tested),
            TrailerKey::Supersedes => Some(&self.supersedes),
            TrailerKey::DependsOn => Some(&self.depends_on),
            TrailerKey::Related => Some(&self.related),
            _ => None,
        }
    }

    /// Mutable values of an array trailer. `None` when `key` is not an array key.
    pub fn array_values_mut(&mut self, key: TrailerKey) -> Option<&mut Vec<String>> {
        match key {
            TrailerKey::Constraint => Some(&mut self.constraint),
            TrailerKey::Rejected => Some(&mut self.rejected),
            TrailerKey::Directive => Some(&mut self.directive),
            TrailerKey::Tested => Some(&mut self.tested),
            TrailerKey::NotTested => Some(&mut self.not_tested),
            TrailerKey::Supersedes => Some(&mut self.supersedes),
            TrailerKey::DependsOn => Some(&mut self.depends_on),
            TrailerKey::Related => Some(&mut self.related),
            _ => None,
        }
    }

    /// Wire value of an enum trailer, or `None` if unset or not an enum key.
    pub fn enum_value(&self, key: TrailerKey) -> Option<&'static str> {
        match key {
            TrailerKey::Confidence => self.confidence.map(ConfidenceLevel::as_str),
            TrailerKey::ScopeRisk => self.scope_risk.map(ScopeRiskLevel::as_str),
            TrailerKey::Reversibility => self.reversibility.map(ReversibilityLevel::as_str),
            _ => None,
        }
    }

    /// Whether the trailer carries a value: a non-empty Lore-id, at least one
    /// array value, or a set enum value.
    pub fn has_value(&self, key: TrailerKey) -> bool {
        match key {
            TrailerKey::LoreId => !self.lore_id.is_empty(),
            k if k.is_array() => self.array_values(k).map(|v| !v.is_empty()).unwrap_or(false),
            k if k.is_enum() => self.enum_value(k).is_some(),
            _ => false,
        }
    }

    /// Whether a trailer named `key` (known or custom) carries a value.
    pub fn has_named(&self, key: &str) -> bool {
        match TrailerKey::parse(key) {
            Some(k) => self.has_value(k),
            None => self.custom.has(key),
        }
    }
}

/// A single Lore-enriched commit.
#[derive(Debug, Clone, PartialEq)]
pub struct LoreAtom {
    pub lore_id: LoreId,
    pub commit_hash: String,
    /// Author date as an instant (git `%aI`, normalised to UTC).
    pub date: DateTime<Utc>,
    /// Author email (git `%ae`).
    pub author: String,
    /// Commit subject line.
    pub intent: String,
    /// Commit body with the trailer block stripped.
    pub body: String,
    pub trailers: LoreTrailers,
    pub files_changed: Vec<String>,
}

/// Whether an atom has been superseded and, if so, by which atom.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SupersessionStatus {
    pub superseded: bool,
    pub superseded_by: Option<LoreId>,
}

impl SupersessionStatus {
    pub fn active() -> Self {
        SupersessionStatus::default()
    }

    pub fn superseded_by(id: impl Into<LoreId>) -> Self {
        SupersessionStatus {
            superseded: true,
            superseded_by: Some(id.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trailer_key_round_trips_through_wire_names() {
        for key in TrailerKey::ALL {
            assert_eq!(TrailerKey::parse(key.as_str()), Some(key));
        }
        assert_eq!(TrailerKey::parse("lore-id"), None);
        assert_eq!(TrailerKey::parse("Signed-off-by"), None);
    }

    #[test]
    fn key_classification_is_disjoint_and_complete() {
        for key in TrailerKey::ALL {
            let classes = [key == TrailerKey::LoreId, key.is_array(), key.is_enum()];
            assert_eq!(classes.iter().filter(|c| **c).count(), 1, "{key}");
        }
        for key in TrailerKey::REFERENCE {
            assert!(key.is_array());
        }
    }

    #[test]
    fn level_enums_parse_and_order() {
        assert_eq!(ConfidenceLevel::parse("low"), Some(ConfidenceLevel::Low));
        assert_eq!(ConfidenceLevel::parse("LOW"), None);
        assert_eq!(
            ReversibilityLevel::parse("migration-needed"),
            Some(ReversibilityLevel::MigrationNeeded)
        );
        assert!(ScopeRiskLevel::Narrow < ScopeRiskLevel::Wide);
        assert_eq!(ReversibilityLevel::Irreversible.index(), 2);
        assert_eq!(ConfidenceLevel::ALL.len(), 3);
    }

    #[test]
    fn level_enums_serialize_as_wire_values() {
        assert_eq!(
            serde_json::to_string(&ReversibilityLevel::MigrationNeeded).unwrap(),
            "\"migration-needed\""
        );
        assert_eq!(
            serde_json::from_str::<ScopeRiskLevel>("\"wide\"").unwrap(),
            ScopeRiskLevel::Wide
        );
    }

    #[test]
    fn has_value_covers_every_key_class() {
        let mut t = LoreTrailers::default();
        assert!(!t.has_value(TrailerKey::LoreId));
        assert!(!t.has_value(TrailerKey::Constraint));
        assert!(!t.has_value(TrailerKey::Confidence));

        t.lore_id = "a1b2c3d4".into();
        t.constraint.push("x".into());
        t.confidence = Some(ConfidenceLevel::High);
        assert!(t.has_value(TrailerKey::LoreId));
        assert!(t.has_value(TrailerKey::Constraint));
        assert!(t.has_value(TrailerKey::Confidence));
        assert_eq!(t.enum_value(TrailerKey::Confidence), Some("high"));
        assert_eq!(t.enum_value(TrailerKey::Constraint), None);
        assert!(t.has_named("Constraint"));
        assert!(!t.has_named("Ticket"));
    }
}
