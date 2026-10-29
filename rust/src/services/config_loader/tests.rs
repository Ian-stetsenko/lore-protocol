//! Ported case-for-case from `tests/unit/services/config-loader.test.ts`.

use super::*;
use crate::util::LoreError;
use tempfile::{tempdir, TempDir};

fn loader() -> TomlConfigLoader {
    TomlConfigLoader::new()
}

fn temp() -> TempDir {
    tempdir().expect("temp dir")
}

/// Create `<dir>/.lore/config.toml` with `content` and return its path.
fn create_config_file(dir: &Path, content: &str) -> PathBuf {
    let lore_dir = dir.join(CONFIG_DIR);
    std::fs::create_dir_all(&lore_dir).expect("mkdir .lore");
    let config_path = lore_dir.join(CONFIG_FILENAME);
    std::fs::write(&config_path, content).expect("write config");
    config_path
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| v.to_string()).collect()
}

// ---------------------------------------------------------------------------
// describe('loadFromFile')
// ---------------------------------------------------------------------------
mod load_from_file {
    use super::*;

    #[test]
    fn should_parse_a_valid_toml_config_file() {
        let tmp = temp();
        let config_path = create_config_file(
            tmp.path(),
            r#"
[protocol]
version = "2.0"

[trailers]
required = ["Constraint", "Confidence"]
custom = ["Team"]

[validation]
strict = true
maxMessageLines = 100
intentMaxLength = 80

[stale]
olderThan = "1y"
driftThreshold = 50

[output]
defaultFormat = "json"

[follow]
maxDepth = 5
"#,
        );

        let config = loader().load_from_file(&config_path).unwrap();

        assert_eq!(config.protocol.version, "2.0");
        assert_eq!(
            config.trailers.required,
            strings(&["Constraint", "Confidence"])
        );
        assert_eq!(config.trailers.custom, strings(&["Team"]));
        assert!(config.validation.strict);
        assert_eq!(config.validation.max_message_lines, 100);
        assert_eq!(config.validation.intent_max_length, 80);
        assert_eq!(config.stale.older_than, "1y");
        assert_eq!(config.stale.drift_threshold, 50);
        assert_eq!(config.output.default_format, OutputFormat::Json);
        assert_eq!(config.follow.max_depth, 5);
    }

    #[test]
    fn should_merge_partial_config_with_defaults() {
        let tmp = temp();
        let config_path = create_config_file(
            tmp.path(),
            r#"
[protocol]
version = "1.5"
"#,
        );

        let config = loader().load_from_file(&config_path).unwrap();
        let defaults = LoreConfig::default();

        assert_eq!(config.protocol.version, "1.5");
        assert_eq!(config.trailers, defaults.trailers);
        assert_eq!(config.validation, defaults.validation);
        assert_eq!(config.stale, defaults.stale);
        assert_eq!(config.output, defaults.output);
        assert_eq!(config.follow, defaults.follow);
    }

    #[test]
    fn should_use_defaults_for_empty_config_file() {
        let tmp = temp();
        let config_path = create_config_file(tmp.path(), "");

        let config = loader().load_from_file(&config_path).unwrap();

        assert_eq!(config, LoreConfig::default());
    }

    #[test]
    fn should_handle_only_stale_section() {
        let tmp = temp();
        let config_path = create_config_file(
            tmp.path(),
            r#"
[stale]
olderThan = "30d"
driftThreshold = 10
"#,
        );

        let config = loader().load_from_file(&config_path).unwrap();

        assert_eq!(config.stale.older_than, "30d");
        assert_eq!(config.stale.drift_threshold, 10);
        assert_eq!(config.protocol, LoreConfig::default().protocol);
    }

    #[test]
    fn should_throw_on_invalid_toml_syntax() {
        let tmp = temp();
        let config_path = create_config_file(tmp.path(), "not valid toml [[[");

        let result = loader().load_from_file(&config_path);

        assert!(matches!(result, Err(LoreError::Toml(_))));
    }

    #[test]
    fn should_parse_snake_case_toml_keys_canonical_toml_format() {
        let tmp = temp();
        let config_path = create_config_file(
            tmp.path(),
            r#"
[protocol]
version = "2.0"

[validation]
strict = true
max_message_lines = 100
intent_max_length = 80

[stale]
older_than = "1y"
drift_threshold = 50

[output]
default_format = "json"

[follow]
max_depth = 5
"#,
        );

        let config = loader().load_from_file(&config_path).unwrap();

        assert_eq!(config.protocol.version, "2.0");
        assert!(config.validation.strict);
        assert_eq!(config.validation.max_message_lines, 100);
        assert_eq!(config.validation.intent_max_length, 80);
        assert_eq!(config.stale.older_than, "1y");
        assert_eq!(config.stale.drift_threshold, 50);
        assert_eq!(config.output.default_format, OutputFormat::Json);
        assert_eq!(config.follow.max_depth, 5);
    }

    #[test]
    fn should_prefer_snake_case_over_camel_case_when_both_are_present() {
        let tmp = temp();
        let config_path = create_config_file(
            tmp.path(),
            r#"
[validation]
max_message_lines = 100
maxMessageLines = 50
"#,
        );

        let config = loader().load_from_file(&config_path).unwrap();

        assert_eq!(config.validation.max_message_lines, 100);
    }

    #[test]
    fn should_handle_output_format_validation() {
        let tmp = temp();
        let config_path = create_config_file(
            tmp.path(),
            r#"
[output]
defaultFormat = "invalid"
"#,
        );

        let config = loader().load_from_file(&config_path).unwrap();

        // Invalid format should fall back to default
        assert_eq!(config.output.default_format, OutputFormat::Text);
    }

    // Rust-only: type checking against the defaults.
    #[test]
    fn should_fall_back_to_defaults_for_mistyped_values() {
        let tmp = temp();
        let config_path = create_config_file(
            tmp.path(),
            r#"
[protocol]
version = 2

[trailers]
required = "Constraint"
custom = ["Team", 7]

[validation]
strict = "yes"
max_message_lines = 1.5
intent_max_length = -10

[output]
default_format = 3

[cli]
update_check = 0

[hooks]
enforce = false
skip_patterns = "^Merge "
"#,
        );

        let config = loader().load_from_file(&config_path).unwrap();
        let defaults = LoreConfig::default();

        assert_eq!(config.protocol.version, defaults.protocol.version);
        assert_eq!(config.trailers.required, defaults.trailers.required);
        // Non-string elements are dropped from an otherwise valid array.
        assert_eq!(config.trailers.custom, strings(&["Team"]));
        assert_eq!(config.validation.strict, defaults.validation.strict);
        assert_eq!(
            config.validation.max_message_lines,
            defaults.validation.max_message_lines
        );
        assert_eq!(
            config.validation.intent_max_length,
            defaults.validation.intent_max_length
        );
        assert_eq!(config.output.default_format, OutputFormat::Text);
        assert_eq!(config.cli.update_check, defaults.cli.update_check);
        assert!(!config.hooks.enforce);
        assert_eq!(config.hooks.skip_patterns, defaults.hooks.skip_patterns);
    }

    #[test]
    fn should_use_the_default_section_when_a_section_is_not_a_table() {
        let tmp = temp();
        let config_path = create_config_file(
            tmp.path(),
            r#"
stale = "6m"
follow = 3
"#,
        );

        let config = loader().load_from_file(&config_path).unwrap();

        assert_eq!(config.stale, LoreConfig::default().stale);
        assert_eq!(config.follow, LoreConfig::default().follow);
    }

    #[test]
    fn should_read_cli_and_hooks_sections() {
        let tmp = temp();
        let config_path = create_config_file(
            tmp.path(),
            r#"
[cli]
update_check = false

[hooks]
enforce = false
allow_fixup = false
skip_authors = ["bot@example.com"]
skip_patterns = ["^Merge ", "^Revert "]
"#,
        );

        let config = loader().load_from_file(&config_path).unwrap();

        assert!(!config.cli.update_check);
        assert!(!config.hooks.enforce);
        assert!(!config.hooks.allow_fixup);
        assert_eq!(config.hooks.skip_authors, strings(&["bot@example.com"]));
        assert_eq!(
            config.hooks.skip_patterns,
            strings(&["^Merge ", "^Revert "])
        );
    }

    #[test]
    fn should_report_a_missing_file_as_an_io_error() {
        let tmp = temp();

        let result = loader().load_from_file(&tmp.path().join("missing.toml"));

        assert!(matches!(result, Err(LoreError::Io(_))));
    }
}

// ---------------------------------------------------------------------------
// describe('findConfigPath')
// ---------------------------------------------------------------------------
mod find_config_path {
    use super::*;

    #[test]
    fn should_find_config_in_the_same_directory() {
        let tmp = temp();
        create_config_file(tmp.path(), "[protocol]\nversion = \"1.0\"");

        let result = loader().find_config_path(tmp.path()).unwrap();

        assert_eq!(
            result,
            Some(tmp.path().join(CONFIG_DIR).join(CONFIG_FILENAME))
        );
    }

    #[test]
    fn should_find_config_in_a_parent_directory() {
        let tmp = temp();
        create_config_file(tmp.path(), "[protocol]\nversion = \"1.0\"");
        let child_dir = tmp.path().join("subdir").join("nested");
        std::fs::create_dir_all(&child_dir).unwrap();

        let result = loader().find_config_path(&child_dir).unwrap();

        assert_eq!(
            result,
            Some(tmp.path().join(CONFIG_DIR).join(CONFIG_FILENAME))
        );
    }

    #[test]
    fn should_return_null_when_no_config_exists() {
        let tmp = temp();

        let result = loader().find_config_path(tmp.path()).unwrap();

        assert_eq!(result, None);
    }

    #[test]
    fn should_find_the_nearest_config_when_multiple_exist() {
        let tmp = temp();
        // Parent config
        create_config_file(tmp.path(), "[protocol]\nversion = \"parent\"");
        // Child config (closer to the start path)
        let child_dir = tmp.path().join("packages").join("app");
        create_config_file(&child_dir, "[protocol]\nversion = \"child\"");

        let result = loader().find_config_path(&child_dir).unwrap();

        assert_eq!(
            result,
            Some(child_dir.join(CONFIG_DIR).join(CONFIG_FILENAME))
        );
    }

    // Rust-only: start-directory resolution rules.
    #[test]
    fn should_start_from_the_parent_when_given_a_file_path() {
        let tmp = temp();
        let config_path = create_config_file(tmp.path(), "[protocol]\nversion = \"1.0\"");
        let file = tmp.path().join("README.md");
        std::fs::write(&file, "hi").unwrap();

        let result = loader().find_config_path(&file).unwrap();

        assert_eq!(result, Some(config_path));
    }

    #[test]
    fn should_treat_a_missing_path_with_an_extension_as_a_file() {
        let tmp = temp();
        let config_path = create_config_file(tmp.path(), "[protocol]\nversion = \"1.0\"");
        let missing_file = tmp.path().join("src").join("auth.ts");
        let missing_dir = tmp.path().join("src").join("auth");

        assert_eq!(
            loader().find_config_path(&missing_file).unwrap(),
            Some(config_path.clone())
        );
        assert_eq!(
            loader().find_config_path(&missing_dir).unwrap(),
            Some(config_path)
        );
    }
}

// ---------------------------------------------------------------------------
// describe('loadForPath')
// ---------------------------------------------------------------------------
mod load_for_path {
    use super::*;

    #[test]
    fn should_return_defaults_when_no_config_file_exists() {
        let tmp = temp();

        let config = loader().load_for_path(tmp.path()).unwrap();

        assert_eq!(config, LoreConfig::default());
    }

    #[test]
    fn should_load_config_from_the_nearest_lore_config_toml() {
        let tmp = temp();
        create_config_file(
            tmp.path(),
            r#"
[protocol]
version = "2.0"

[stale]
olderThan = "1y"
"#,
        );

        let config = loader().load_for_path(tmp.path()).unwrap();

        assert_eq!(config.protocol.version, "2.0");
        assert_eq!(config.stale.older_than, "1y");
    }

    #[test]
    fn should_merge_child_config_over_parent_config() {
        let tmp = temp();
        // Parent config: sets protocol and stale
        create_config_file(
            tmp.path(),
            r#"
[protocol]
version = "1.0"

[stale]
olderThan = "1y"
driftThreshold = 50
"#,
        );
        // Child config: overrides stale only
        let child_dir = tmp.path().join("packages").join("app");
        create_config_file(
            &child_dir,
            r#"
[stale]
olderThan = "30d"
driftThreshold = 10
"#,
        );

        let config = loader().load_for_path(&child_dir).unwrap();

        // Child stale overrides parent stale completely
        assert_eq!(config.stale.older_than, "30d");
        assert_eq!(config.stale.drift_threshold, 10);
        // Parent protocol section is preserved
        assert_eq!(config.protocol.version, "1.0");
    }

    #[test]
    fn should_handle_three_level_config_hierarchy() {
        let tmp = temp();
        // Grandparent: protocol
        create_config_file(
            tmp.path(),
            r#"
[protocol]
version = "1.0"

[stale]
olderThan = "1y"
driftThreshold = 100
"#,
        );
        // Parent: validation
        let parent_dir = tmp.path().join("packages");
        create_config_file(
            &parent_dir,
            r#"
[validation]
strict = true
maxMessageLines = 80
intentMaxLength = 60
"#,
        );
        // Child: stale (overrides grandparent stale)
        let child_dir = parent_dir.join("app");
        create_config_file(
            &child_dir,
            r#"
[stale]
olderThan = "7d"
driftThreshold = 5
"#,
        );

        let config = loader().load_for_path(&child_dir).unwrap();

        // Grandparent protocol
        assert_eq!(config.protocol.version, "1.0");
        // Parent validation
        assert!(config.validation.strict);
        assert_eq!(config.validation.max_message_lines, 80);
        // Child stale overrides grandparent stale
        assert_eq!(config.stale.older_than, "7d");
        assert_eq!(config.stale.drift_threshold, 5);
    }

    #[test]
    fn should_use_shallow_merge_at_section_level() {
        let tmp = temp();
        // Parent: full trailers section
        create_config_file(
            tmp.path(),
            r#"
[trailers]
required = ["Constraint", "Confidence"]
custom = ["Team", "Sprint"]
"#,
        );
        // Child: partial trailers section (overrides entire section)
        let child_dir = tmp.path().join("app");
        create_config_file(
            &child_dir,
            r#"
[trailers]
required = ["Lore-id"]
custom = []
"#,
        );

        let config = loader().load_for_path(&child_dir).unwrap();

        // Child replaces the entire trailers section, not individual fields
        assert_eq!(config.trailers.required, strings(&["Lore-id"]));
        assert!(config.trailers.custom.is_empty());
    }

    #[test]
    fn should_handle_subdirectory_that_is_deeper_than_config() {
        let tmp = temp();
        create_config_file(
            tmp.path(),
            r#"
[protocol]
version = "1.5"
"#,
        );
        let deep_dir = tmp.path().join("a").join("b").join("c").join("d");
        std::fs::create_dir_all(&deep_dir).unwrap();

        let config = loader().load_for_path(&deep_dir).unwrap();

        assert_eq!(config.protocol.version, "1.5");
    }

    // Rust-only: a child section that omits a field falls back to the
    // DEFAULT, not to the parent's value (section-level replace).
    #[test]
    fn should_not_inherit_individual_fields_from_a_parent_section() {
        let tmp = temp();
        create_config_file(
            tmp.path(),
            r#"
[stale]
older_than = "1y"
drift_threshold = 50
"#,
        );
        let child_dir = tmp.path().join("app");
        create_config_file(
            &child_dir,
            r#"
[stale]
older_than = "30d"
"#,
        );

        let config = loader().load_for_path(&child_dir).unwrap();

        assert_eq!(config.stale.older_than, "30d");
        assert_eq!(
            config.stale.drift_threshold,
            LoreConfig::default().stale.drift_threshold
        );
    }

    #[test]
    fn should_propagate_invalid_toml_from_any_level() {
        let tmp = temp();
        create_config_file(tmp.path(), "not valid toml [[[");
        let child_dir = tmp.path().join("app");
        create_config_file(&child_dir, "[protocol]\nversion = \"1.0\"");

        let result = loader().load_for_path(&child_dir);

        assert!(matches!(result, Err(LoreError::Toml(_))));
    }
}
