//! Configuration schema for `.lore/config.toml`.

/// Fully resolved configuration (defaults applied).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoreConfig {
    pub protocol: ProtocolConfig,
    pub trailers: TrailersConfig,
    pub validation: ValidationConfig,
    pub stale: StaleConfig,
    pub output: OutputConfig,
    pub follow: FollowConfig,
    pub cli: CliConfig,
    pub hooks: HooksConfig,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtocolConfig {
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrailersConfig {
    pub required: Vec<String>,
    pub custom: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationConfig {
    pub strict: bool,
    pub max_message_lines: usize,
    pub intent_max_length: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaleConfig {
    /// Duration string such as `6m`, `1y`, `30d`, `2w`.
    pub older_than: String,
    pub drift_threshold: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputFormat {
    Text,
    Json,
}

impl OutputFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            OutputFormat::Text => "text",
            OutputFormat::Json => "json",
        }
    }

    pub fn parse(s: &str) -> Option<OutputFormat> {
        match s {
            "text" => Some(OutputFormat::Text),
            "json" => Some(OutputFormat::Json),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutputConfig {
    pub default_format: OutputFormat,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FollowConfig {
    pub max_depth: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliConfig {
    pub update_check: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HooksConfig {
    pub enforce: bool,
    pub allow_fixup: bool,
    pub skip_authors: Vec<String>,
    pub skip_patterns: Vec<String>,
}

impl Default for LoreConfig {
    fn default() -> Self {
        LoreConfig {
            protocol: ProtocolConfig {
                version: "1.0".to_owned(),
            },
            trailers: TrailersConfig {
                required: Vec::new(),
                custom: Vec::new(),
            },
            validation: ValidationConfig {
                strict: false,
                max_message_lines: 50,
                intent_max_length: 72,
            },
            stale: StaleConfig {
                older_than: "6m".to_owned(),
                drift_threshold: 20,
            },
            output: OutputConfig {
                default_format: OutputFormat::Text,
            },
            follow: FollowConfig { max_depth: 3 },
            cli: CliConfig { update_check: true },
            hooks: HooksConfig {
                enforce: true,
                allow_fixup: true,
                skip_authors: Vec::new(),
                skip_patterns: vec!["^Merge ".to_owned()],
            },
        }
    }
}

impl Default for ProtocolConfig {
    fn default() -> Self {
        LoreConfig::default().protocol
    }
}
impl Default for TrailersConfig {
    fn default() -> Self {
        LoreConfig::default().trailers
    }
}
impl Default for ValidationConfig {
    fn default() -> Self {
        LoreConfig::default().validation
    }
}
impl Default for StaleConfig {
    fn default() -> Self {
        LoreConfig::default().stale
    }
}
impl Default for OutputConfig {
    fn default() -> Self {
        LoreConfig::default().output
    }
}
impl Default for FollowConfig {
    fn default() -> Self {
        LoreConfig::default().follow
    }
}
impl Default for CliConfig {
    fn default() -> Self {
        LoreConfig::default().cli
    }
}
impl Default for HooksConfig {
    fn default() -> Self {
        LoreConfig::default().hooks
    }
}

/// The canonical `.lore/config.toml` written by `lore init`.
pub const DEFAULT_CONFIG_TOML: &str = r#"[protocol]
version = "1.0"

[trailers]
required = []
custom = []

[validation]
strict = false
max_message_lines = 50
intent_max_length = 72

[stale]
older_than = "6m"
drift_threshold = 20

[output]
default_format = "text"

[follow]
max_depth = 3

[cli]
update_check = true

[hooks]
enforce = true
allow_fixup = true
skip_authors = []
skip_patterns = ["^Merge "]
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_protocol_defaults() {
        let c = LoreConfig::default();
        assert_eq!(c.protocol.version, "1.0");
        assert_eq!(c.validation.max_message_lines, 50);
        assert_eq!(c.validation.intent_max_length, 72);
        assert_eq!(c.stale.older_than, "6m");
        assert_eq!(c.stale.drift_threshold, 20);
        assert_eq!(c.output.default_format, OutputFormat::Text);
        assert_eq!(c.follow.max_depth, 3);
        assert!(c.cli.update_check);
        assert!(c.hooks.enforce);
        assert!(c.hooks.allow_fixup);
        assert_eq!(c.hooks.skip_patterns, vec!["^Merge "]);
    }

    #[test]
    fn default_toml_parses() {
        let value: toml::Value = toml::from_str(DEFAULT_CONFIG_TOML).unwrap();
        assert!(value.get("hooks").is_some());
    }
}
