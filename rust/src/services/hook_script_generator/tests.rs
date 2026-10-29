use super::*;

fn hooks() -> HooksConfig {
    HooksConfig::default()
}

fn generate(config: &HooksConfig) -> String {
    BashHookScriptGenerator::new().generate_commit_msg_hook(config)
}

#[test]
fn generates_a_valid_bash_script_with_shebang_and_marker() {
    let script = generate(&hooks());

    assert!(script.starts_with("#!/usr/bin/env bash"));
    assert!(script.contains("LORE-MANAGED-HOOK"));
}

#[test]
fn marker_line_matches_the_typescript_output_byte_for_byte() {
    let script = generate(&hooks());

    assert!(script.contains(
        "# LORE-MANAGED-HOOK \u{2014} do not edit manually. Reinstall with: lore hooks install\n"
    ));
}

#[test]
fn reads_commit_message_from_first_argument() {
    let script = generate(&hooks());

    assert!(script.contains("COMMIT_MSG_FILE=\"$1\""));
    assert!(script.contains("COMMIT_MSG=$(cat \"$COMMIT_MSG_FILE\")"));
}

#[test]
fn validates_via_commit_msg_file_with_strict_when_enforce_is_true() {
    let config = HooksConfig {
        enforce: true,
        ..hooks()
    };
    let script = generate(&config);

    assert!(script.contains("lore validate --commit-msg-file \"$COMMIT_MSG_FILE\" --strict"));
}

#[test]
fn validates_via_commit_msg_file_without_strict_when_enforce_is_false() {
    let config = HooksConfig {
        enforce: false,
        ..hooks()
    };
    let script = generate(&config);

    assert!(script.contains("lore validate --commit-msg-file \"$COMMIT_MSG_FILE\""));
    assert!(!script.contains("--strict"));
}

#[test]
fn includes_fixup_squash_skip_when_allow_fixup_is_true() {
    let config = HooksConfig {
        allow_fixup: true,
        ..hooks()
    };
    let script = generate(&config);

    assert!(script.contains("fixup|squash"));
}

#[test]
fn omits_fixup_squash_skip_when_allow_fixup_is_false() {
    let config = HooksConfig {
        allow_fixup: false,
        ..hooks()
    };
    let script = generate(&config);

    assert!(!script.contains("fixup|squash"));
}

#[test]
fn includes_safe_skip_patterns_from_config() {
    let config = HooksConfig {
        skip_patterns: vec!["^Merge ".to_owned(), "^Revert ".to_owned()],
        ..hooks()
    };
    let script = generate(&config);

    assert!(script.contains("^Merge "));
    assert!(script.contains("^Revert "));
}

#[test]
fn filters_out_unsafe_skip_patterns() {
    let config = HooksConfig {
        skip_patterns: vec!["^Merge ".to_owned(), "\"]]; rm -rf / #".to_owned()],
        ..hooks()
    };
    let script = generate(&config);

    assert!(script.contains("^Merge "));
    assert!(!script.contains("rm -rf"));
}

#[test]
fn includes_safe_skip_authors_from_config() {
    let config = HooksConfig {
        skip_authors: vec!["dependabot[bot]".to_owned(), "renovate[bot]".to_owned()],
        ..hooks()
    };
    let script = generate(&config);

    assert!(script.contains("dependabot[bot]"));
    assert!(script.contains("renovate[bot]"));
    assert!(script.contains("GIT_AUTHOR_IDENT"));
}

#[test]
fn filters_out_unsafe_skip_authors() {
    let config = HooksConfig {
        skip_authors: vec!["good-bot".to_owned(), "evil\"; rm -rf / #".to_owned()],
        ..hooks()
    };
    let script = generate(&config);

    assert!(script.contains("good-bot"));
    assert!(!script.contains("rm -rf"));
}

#[test]
fn omits_author_check_when_skip_authors_is_empty() {
    let config = HooksConfig {
        skip_authors: vec![],
        ..hooks()
    };
    let script = generate(&config);

    assert!(!script.contains("GIT_AUTHOR_IDENT"));
}

#[test]
fn includes_fallback_from_lore_to_npx() {
    let script = generate(&hooks());

    assert!(script.contains("command -v lore"));
    assert!(script.contains("npx --yes lore-protocol"));
}

#[test]
fn handles_empty_skip_patterns() {
    let config = HooksConfig {
        skip_patterns: vec![],
        ..hooks()
    };
    let script = generate(&config);

    assert!(!script.contains("# Skip pattern:"));
}

#[test]
fn default_config_script_is_identical_to_the_typescript_output() {
    let script = generate(&hooks());

    let expected = concat!(
        "#!/usr/bin/env bash\n",
        "# LORE-MANAGED-HOOK \u{2014} do not edit manually. Reinstall with: lore hooks install\n",
        "\n",
        "COMMIT_MSG_FILE=\"$1\"\n",
        "COMMIT_MSG=$(cat \"$COMMIT_MSG_FILE\")\n",
        "\n",
        "# Skip fixup/squash commits (validated after squash)\n",
        "if [[ \"$COMMIT_MSG\" =~ ^(fixup|squash)! ]]; then\n",
        "  exit 0\n",
        "fi\n",
        "\n",
        "# Skip pattern: ^Merge \n",
        "if [[ \"$COMMIT_MSG\" =~ ^Merge  ]]; then\n",
        "  exit 0\n",
        "fi\n",
        "\n",
        "# Run Lore protocol validation against the commit message file\n",
        "if command -v lore &> /dev/null; then\n",
        "  lore validate --commit-msg-file \"$COMMIT_MSG_FILE\" --strict\n",
        "else\n",
        "  npx --yes lore-protocol validate --commit-msg-file \"$COMMIT_MSG_FILE\" --strict\n",
        "fi\n",
    );
    assert_eq!(script, expected);
}
