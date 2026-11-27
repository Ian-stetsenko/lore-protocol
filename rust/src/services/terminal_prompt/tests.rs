use std::cell::RefCell;
use std::io::{Cursor, Write};
use std::rc::Rc;

use super::*;

/// `Write` handle over a shared buffer so the test can read what the prompt
/// printed after handing ownership of the writer to it.
#[derive(Clone, Default)]
struct SharedOut(Rc<RefCell<Vec<u8>>>);

impl SharedOut {
    fn text(&self) -> String {
        String::from_utf8(self.0.borrow().clone()).unwrap()
    }
}

impl Write for SharedOut {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.borrow_mut().extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn prompt(input: &str) -> (TerminalPrompt, SharedOut) {
    let out = SharedOut::default();
    let p = TerminalPrompt::with_io(
        Box::new(Cursor::new(input.to_owned())),
        Box::new(out.clone()),
    );
    (p, out)
}

mod ask_text {
    use super::*;

    #[test]
    fn prints_message_with_trailing_space_and_returns_trimmed_answer() {
        let (p, out) = prompt("  hello world  \n");

        let answer = p
            .ask_text("Intent:", &TextPromptOptions::default())
            .unwrap();

        assert_eq!(answer, "hello world");
        assert_eq!(out.text(), "Intent: ");
    }

    #[test]
    fn shows_default_hint_and_uses_default_on_empty_answer() {
        let (p, out) = prompt("\n");
        let options = TextPromptOptions {
            default: Some("main".to_owned()),
            max_length: None,
        };

        let answer = p.ask_text("Branch", &options).unwrap();

        assert_eq!(answer, "main");
        assert_eq!(out.text(), "Branch (default: main) ");
    }

    #[test]
    fn ignores_an_empty_default_like_javascript() {
        let (p, out) = prompt("\n");
        let options = TextPromptOptions {
            default: Some(String::new()),
            max_length: None,
        };

        let answer = p.ask_text("Q", &options).unwrap();

        assert_eq!(answer, "");
        assert_eq!(out.text(), "Q ");
    }

    #[test]
    fn truncates_to_max_length() {
        let (p, _) = prompt("abcdefghij\n");
        let options = TextPromptOptions {
            default: None,
            max_length: Some(4),
        };

        assert_eq!(p.ask_text("Q", &options).unwrap(), "abcd");
    }

    #[test]
    fn treats_end_of_input_as_empty_answer() {
        let (p, _) = prompt("");

        assert_eq!(p.ask_text("Q", &TextPromptOptions::default()).unwrap(), "");
    }

    #[test]
    fn strips_carriage_returns() {
        let (p, _) = prompt("value\r\n");

        assert_eq!(
            p.ask_text("Q", &TextPromptOptions::default()).unwrap(),
            "value"
        );
    }
}

mod ask_multiline {
    use super::*;

    #[test]
    fn collects_lines_until_an_empty_line() {
        let (p, out) = prompt("first\nsecond\n\nignored\n");

        let body = p.ask_multiline("Body:").unwrap();

        assert_eq!(body, "first\nsecond");
        assert_eq!(out.text(), "Body:\n");
    }

    #[test]
    fn stops_at_end_of_input() {
        let (p, _) = prompt("only line");

        assert_eq!(p.ask_multiline("Body:").unwrap(), "only line");
    }

    #[test]
    fn whitespace_only_line_terminates_input() {
        let (p, _) = prompt("a\n   \nb\n");

        assert_eq!(p.ask_multiline("Body:").unwrap(), "a");
    }
}

mod ask_choice {
    use super::*;

    const CHOICES: [&str; 3] = ["low", "medium", "high"];

    #[test]
    fn prints_numbered_list_and_accepts_a_number() {
        let (p, out) = prompt("2\n");

        let chosen = p.ask_choice("Confidence:", &CHOICES).unwrap();

        assert_eq!(chosen, "medium");
        assert_eq!(
            out.text(),
            "Confidence:\n  1) low\n  2) medium\n  3) high\nChoice (number): "
        );
    }

    #[test]
    fn accepts_the_exact_value_case_insensitively() {
        let (p, _) = prompt("HIGH\n");

        assert_eq!(p.ask_choice("Confidence:", &CHOICES).unwrap(), "high");
    }

    #[test]
    fn reprompts_on_invalid_input() {
        let (p, out) = prompt("0\n7\nnope\n1\n");

        let chosen = p.ask_choice("Confidence:", &CHOICES).unwrap();

        assert_eq!(chosen, "low");
        let text = out.text();
        assert_eq!(
            text.matches("Invalid choice. Please enter 1-3 or the exact value.\n")
                .count(),
            3
        );
        assert_eq!(text.matches("Choice (number): ").count(), 4);
    }

    #[test]
    fn parses_a_leading_integer_like_parse_int() {
        let (p, _) = prompt("3abc\n");

        assert_eq!(p.ask_choice("Confidence:", &CHOICES).unwrap(), "high");
    }

    #[test]
    fn fails_with_input_closed_at_end_of_input() {
        let (p, _) = prompt("bogus\n");

        let err = p.ask_choice("Confidence:", &CHOICES).unwrap_err();

        assert_eq!(err.to_string(), "Input closed");
        assert_eq!(err.exit_code(), 1);
    }
}

mod ask_confirm {
    use super::*;

    #[test]
    fn hint_reflects_the_default() {
        let (p, out) = prompt("\n\n\n");

        assert!(p.ask_confirm("A?", Some(true)).unwrap());
        assert!(!p.ask_confirm("B?", Some(false)).unwrap());
        assert!(!p.ask_confirm("C?", None).unwrap());
        assert_eq!(out.text(), "A? [Y/n] B? [y/N] C? [y/n] ");
    }

    #[test]
    fn accepts_y_and_yes_in_any_case() {
        let (p, _) = prompt("y\nYES\n Yes \n");

        assert!(p.ask_confirm("Q", None).unwrap());
        assert!(p.ask_confirm("Q", None).unwrap());
        assert!(p.ask_confirm("Q", None).unwrap());
    }

    #[test]
    fn anything_else_is_no() {
        let (p, _) = prompt("n\nno\nmaybe\n");

        assert!(!p.ask_confirm("Q", Some(true)).unwrap());
        assert!(!p.ask_confirm("Q", Some(true)).unwrap());
        assert!(!p.ask_confirm("Q", Some(true)).unwrap());
    }

    #[test]
    fn end_of_input_yields_the_default() {
        let (p, _) = prompt("");

        assert!(p.ask_confirm("Q", Some(true)).unwrap());
        assert!(!p.ask_confirm("Q", None).unwrap());
    }
}

#[test]
fn close_is_idempotent() {
    let (p, out) = prompt("");
    p.close();
    p.close();
    assert_eq!(out.text(), "");
}

#[test]
fn parse_int_prefix_matches_javascript_semantics() {
    assert_eq!(TerminalPrompt::parse_int_prefix("12"), Some(12));
    assert_eq!(TerminalPrompt::parse_int_prefix("12abc"), Some(12));
    assert_eq!(TerminalPrompt::parse_int_prefix("+3"), Some(3));
    assert_eq!(TerminalPrompt::parse_int_prefix("-3"), Some(-3));
    assert_eq!(TerminalPrompt::parse_int_prefix("abc"), None);
    assert_eq!(TerminalPrompt::parse_int_prefix(""), None);
}
