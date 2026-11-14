//! Port of `tests/unit/commands/init.test.ts`, against a real temp directory.

use std::fs;

use super::*;
use crate::formatters::text_formatter::TextFormatter;

struct Harness {
    dir: tempfile::TempDir,
    out: Vec<u8>,
}

impl Harness {
    fn new() -> Self {
        Harness {
            dir: tempfile::tempdir().expect("tempdir"),
            out: Vec::new(),
        }
    }

    fn with_config(content: &str) -> Self {
        let h = Harness::new();
        let dir = h.dir.path().join(CONFIG_DIR);
        fs::create_dir_all(&dir).expect("mkdir");
        fs::write(dir.join(CONFIG_FILENAME), content).expect("write");
        h
    }

    fn run(&mut self) -> Result<i32> {
        let formatter = TextFormatter::new(false);
        let deps = InitDeps {
            formatter: &formatter,
            cwd: self.dir.path(),
        };
        let mut err = Vec::new();
        let mut io = Io::new(&mut self.out, &mut err);
        run(&deps, &mut io)
    }

    fn stdout(&self) -> String {
        String::from_utf8_lossy(&self.out).into_owned()
    }

    fn config(&self) -> Option<String> {
        fs::read_to_string(self.dir.path().join(CONFIG_DIR).join(CONFIG_FILENAME)).ok()
    }
}

const FULL_CONFIG: &str = r#"[protocol]
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

#[test]
fn creates_a_new_config_file_if_one_does_not_exist() {
    let mut h = Harness::new();
    assert_eq!(h.run().expect("init"), 0);
    let config = h.config().expect("config written");
    assert!(config.contains("[protocol]"));
    assert_eq!(config, DEFAULT_CONFIG_TOML);
    assert!(h
        .stdout()
        .contains("Created .lore/config.toml with protocol version 1.0"));
}

#[test]
fn reports_an_existing_valid_config_with_no_gaps() {
    let mut h = Harness::with_config(FULL_CONFIG);
    assert_eq!(h.run().expect("init"), 0);
    assert_eq!(h.config().as_deref(), Some(FULL_CONFIG), "not overwritten");
    let out = h.stdout();
    assert!(out.contains("Config already exists at .lore/config.toml:"));
    assert!(out.contains("[protocol]"), "echoes the file");
    assert!(!out.contains("missing new options"));
}

#[test]
fn reports_missing_options_and_suggests_safe_reset_if_no_customizations_exist() {
    let mut h = Harness::with_config("[protocol]\nversion = \"1.0\"\n");
    h.run().expect("init");
    let out = h.stdout();
    assert!(out.contains("Your configuration is missing new options:"));
    assert!(out.contains("  - [trailers] section"));
    assert!(out.contains("  - [hooks] section"));
    assert!(
        out.contains("Notice: You are using default settings. You can safely reset your config")
    );
    assert!(out.contains("rm .lore/config.toml && lore init"));
    assert!(!out.contains("customized"));
}

#[test]
fn reports_missing_options_and_suggests_manual_merge_if_customizations_exist() {
    let mut h =
        Harness::with_config("[protocol]\nversion = \"1.0\"\n[validation]\nstrict = true\n");
    h.run().expect("init");
    let out = h.stdout();
    assert!(out.contains("Your configuration is missing new options:"));
    assert!(out.contains("  - [trailers] section"));
    assert!(out.contains("  - validation.max_message_lines"));
    assert!(out.contains("Notice: You have customized the following options:"));
    assert!(out.contains("  - validation.strict"));
    assert!(out.contains("To update: Rename your current config"));
    assert!(out.contains("mv .lore/config.toml .lore/config.toml.bak && lore init"));
}

#[test]
fn reports_individual_missing_keys_when_section_exists() {
    let config = FULL_CONFIG.replace("max_depth = 3\n", "# max_depth is missing\n");
    let mut h = Harness::with_config(&config);
    h.run().expect("init");
    let out = h.stdout();
    assert!(out.contains("  - follow.max_depth"));
    assert!(!out.contains("[follow] section"));
}

#[test]
fn reports_corruption_if_the_existing_config_is_invalid_toml() {
    let mut h = Harness::with_config("[protocol]\nversion = \"1.0\ninvalid = [missing bracket\n");
    let err = h.run().expect_err("corrupt config fails");
    assert!(err
        .to_string()
        .starts_with("Your configuration file is corrupted and cannot be parsed:"));
    assert!(err
        .to_string()
        .contains("mv .lore/config.toml .lore/config.toml.corrupted && lore init"));
    assert_eq!(err.exit_code(), 1);
}

#[test]
fn config_diff_accepts_camel_case_keys_and_detects_changed_values() {
    let parsed: Table = toml::from_str(
        "[protocol]\nversion = \"1.0\"\n[validation]\nmaxMessageLines = 50\nintentMaxLength = 10\nstrict = false\n",
    )
    .expect("toml");
    let diff = find_config_diff(&parsed);
    assert!(!diff
        .missing
        .contains(&"validation.max_message_lines".to_owned()));
    assert!(diff.missing.contains(&"[stale] section".to_owned()));
    assert_eq!(diff.customized, vec!["validation.intent_max_length"]);
}
