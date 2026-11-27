use std::fs;
use std::path::PathBuf;

use super::*;
use crate::test_support::{MockPrompt, PromptCall};

fn empty_options() -> CommitCommandOptions {
    CommitCommandOptions::default()
}

fn ask_text_called(prompt: &MockPrompt) -> bool {
    prompt
        .calls()
        .iter()
        .any(|c| matches!(c, PromptCall::Text { .. }))
}

/// Writes `content` to a temp file that is removed on drop.
struct TempJson {
    dir: tempfile::TempDir,
    path: PathBuf,
}

impl TempJson {
    fn new(name: &str, content: &str) -> Self {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join(name);
        fs::write(&path, content).unwrap();
        TempJson { dir, path }
    }

    fn path(&self) -> PathBuf {
        let _ = &self.dir;
        self.path.clone()
    }
}

mod mode_resolution_priority {
    use super::*;

    #[test]
    fn should_dispatch_to_interactive_reader_when_interactive_is_set() {
        let prompt = MockPrompt::new();
        prompt.push_text("test intent");
        let resolver = CommitInputResolver::new(&prompt);

        let result = resolver
            .resolve_with_tty(
                &CommitCommandOptions {
                    interactive: true,
                    ..empty_options()
                },
                false,
            )
            .unwrap();

        assert_eq!(result.intent, "test intent");
        assert!(ask_text_called(&prompt));
    }

    #[test]
    fn should_dispatch_to_file_json_reader_when_file_is_set() {
        let prompt = MockPrompt::new();
        let resolver = CommitInputResolver::new(&prompt);
        let file = TempJson::new(
            "test-lore-input.json",
            r#"{"intent":"from file","trailers":{}}"#,
        );

        let result = resolver
            .resolve_with_tty(
                &CommitCommandOptions {
                    file: Some(file.path()),
                    ..empty_options()
                },
                true,
            )
            .unwrap();

        assert_eq!(result.intent, "from file");
        assert!(!ask_text_called(&prompt));
    }

    #[test]
    fn should_dispatch_to_flags_reader_when_intent_is_set() {
        let prompt = MockPrompt::new();
        let resolver = CommitInputResolver::new(&prompt);

        let result = resolver
            .resolve_with_tty(
                &CommitCommandOptions {
                    intent: Some("from flags".to_owned()),
                    confidence: Some("high".to_owned()),
                    ..empty_options()
                },
                true,
            )
            .unwrap();

        assert_eq!(result.intent, "from flags");
        assert_eq!(
            result
                .trailers
                .as_ref()
                .and_then(|t| t.confidence.as_deref()),
            Some("high")
        );
        assert!(!ask_text_called(&prompt));
    }

    #[test]
    fn should_dispatch_to_interactive_reader_when_tty_with_no_flags_set() {
        let prompt = MockPrompt::new();
        prompt.push_text("tty interactive intent");
        let resolver = CommitInputResolver::new(&prompt);

        let result = resolver.resolve_with_tty(&empty_options(), true).unwrap();

        assert_eq!(result.intent, "tty interactive intent");
        assert!(ask_text_called(&prompt));
    }

    #[test]
    fn should_dispatch_to_stdin_json_reader_when_not_a_tty_and_no_flags_set() {
        // The process's stdin cannot be substituted in-process, so this
        // asserts the mode; the JSON parsing path is covered by JsonInputReader.
        assert_eq!(
            CommitInputResolver::resolve_mode(&empty_options(), false),
            InputMode::Stdin
        );
    }

    #[test]
    fn should_prefer_interactive_over_file_when_both_are_set() {
        let prompt = MockPrompt::new();
        prompt.push_text("interactive wins");
        let resolver = CommitInputResolver::new(&prompt);

        let result = resolver
            .resolve_with_tty(
                &CommitCommandOptions {
                    interactive: true,
                    file: Some(PathBuf::from("/some/file.json")),
                    ..empty_options()
                },
                false,
            )
            .unwrap();

        assert_eq!(result.intent, "interactive wins");
        assert!(ask_text_called(&prompt));
    }

    #[test]
    fn should_prefer_file_over_flags_when_both_are_set() {
        let prompt = MockPrompt::new();
        let resolver = CommitInputResolver::new(&prompt);
        let file = TempJson::new(
            "test-lore-file-over-flags.json",
            r#"{"intent":"file wins"}"#,
        );

        let result = resolver
            .resolve_with_tty(
                &CommitCommandOptions {
                    file: Some(file.path()),
                    intent: Some("flags intent".to_owned()),
                    ..empty_options()
                },
                false,
            )
            .unwrap();

        assert_eq!(result.intent, "file wins");
    }

    #[test]
    fn should_prefer_flags_over_stdin_when_intent_is_set_and_not_a_tty() {
        let prompt = MockPrompt::new();
        let resolver = CommitInputResolver::new(&prompt);

        let result = resolver
            .resolve_with_tty(
                &CommitCommandOptions {
                    intent: Some("flags win".to_owned()),
                    ..empty_options()
                },
                false,
            )
            .unwrap();

        assert_eq!(result.intent, "flags win");
    }
}

mod resolve_mode {
    use super::*;

    #[test]
    fn follows_the_priority_order() {
        let all = CommitCommandOptions {
            interactive: true,
            file: Some(PathBuf::from("x.json")),
            intent: Some("i".to_owned()),
            ..empty_options()
        };
        assert_eq!(
            CommitInputResolver::resolve_mode(&all, false),
            InputMode::Interactive
        );

        let file_and_intent = CommitCommandOptions {
            file: Some(PathBuf::from("x.json")),
            intent: Some("i".to_owned()),
            ..empty_options()
        };
        assert_eq!(
            CommitInputResolver::resolve_mode(&file_and_intent, false),
            InputMode::File
        );

        let intent_only = CommitCommandOptions {
            intent: Some("i".to_owned()),
            ..empty_options()
        };
        assert_eq!(
            CommitInputResolver::resolve_mode(&intent_only, false),
            InputMode::Flags
        );

        assert_eq!(
            CommitInputResolver::resolve_mode(&empty_options(), true),
            InputMode::Interactive
        );
        assert_eq!(
            CommitInputResolver::resolve_mode(&empty_options(), false),
            InputMode::Stdin
        );
    }

    #[test]
    fn empty_file_path_and_empty_intent_are_ignored_like_javascript_falsiness() {
        let opts = CommitCommandOptions {
            file: Some(PathBuf::new()),
            intent: Some(String::new()),
            ..empty_options()
        };
        assert_eq!(
            CommitInputResolver::resolve_mode(&opts, false),
            InputMode::Stdin
        );
    }

    #[test]
    fn missing_file_surfaces_an_io_error() {
        let prompt = MockPrompt::new();
        let resolver = CommitInputResolver::new(&prompt);
        let dir = tempfile::tempdir().unwrap();

        let err = resolver
            .resolve_with_tty(
                &CommitCommandOptions {
                    file: Some(dir.path().join("missing.json")),
                    ..empty_options()
                },
                false,
            )
            .unwrap_err();

        assert!(matches!(err, crate::util::LoreError::Io(_)));
    }
}
