//! Option value parsers shared by subcommands (TS
//! `commands/helpers/option-parsers.ts`).
//!
//! Each parser fails with [`InvalidOptionValue`]. TS's coercers threw a plain
//! `Error` that its top-level handler rendered through the output formatter
//! (a JSON envelope under `--json`) with exit code 1, not as usage text; the
//! typed error lets the entry point tell these apart from clap's own usage
//! errors and do the same.

use std::fmt;

/// An option value rejected by one of the parsers in this module. Holds the
/// complete, user-facing message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvalidOptionValue(String);

impl fmt::Display for InvalidOptionValue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for InvalidOptionValue {}

/// Digits only: no sign, decimal point, whitespace or trailing characters.
fn is_digits_only(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit())
}

/// A digits-only value as a number. JS `Number()` never overflows, so a value
/// beyond `usize` saturates instead of failing.
fn digits_to_usize(value: &str) -> usize {
    value.parse().unwrap_or(usize::MAX)
}

/// Parse a CLI value as a strict positive integer; rejects signs, trailing
/// characters and zero.
pub fn parse_positive_int(value: &str) -> Result<usize, InvalidOptionValue> {
    match is_digits_only(value).then(|| digits_to_usize(value)) {
        Some(n) if n >= 1 => Ok(n),
        _ => Err(InvalidOptionValue(format!(
            "Expected a positive integer, got \"{value}\""
        ))),
    }
}

/// Parse a CLI value as a strict non-negative integer (0 allowed); rejects
/// signs and trailing characters.
pub fn parse_non_negative_int(value: &str) -> Result<usize, InvalidOptionValue> {
    if !is_digits_only(value) {
        return Err(InvalidOptionValue(format!(
            "Expected a non-negative integer, got \"{value}\""
        )));
    }
    Ok(digits_to_usize(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn positive_int_rejects_bad_values() {
        assert_eq!(parse_positive_int("5"), Ok(5));
        assert_eq!(parse_positive_int("007"), Ok(7));
        for bad in ["0", "5abc", "-1", "", " 3", "+3", "1.5"] {
            assert!(parse_positive_int(bad).is_err(), "{bad:?}");
        }
        assert_eq!(
            parse_positive_int("abc").unwrap_err().to_string(),
            "Expected a positive integer, got \"abc\""
        );
    }

    #[test]
    fn non_negative_int_accepts_zero_and_plain_digits() {
        assert_eq!(parse_non_negative_int("0"), Ok(0));
        assert_eq!(parse_non_negative_int("1"), Ok(1));
        assert_eq!(parse_non_negative_int("10"), Ok(10));
        assert_eq!(parse_non_negative_int("007"), Ok(7));
    }

    #[test]
    fn non_negative_int_rejects_signs_decimals_whitespace_and_trailing_characters() {
        for bad in ["x", "-1", "1.5", "3abc", " 3", "+3", ""] {
            assert_eq!(
                parse_non_negative_int(bad).unwrap_err().to_string(),
                format!("Expected a non-negative integer, got \"{bad}\""),
            );
        }
    }

    #[test]
    fn values_beyond_usize_saturate_like_js_numbers() {
        let huge = "99999999999999999999999";
        assert_eq!(parse_non_negative_int(huge), Ok(usize::MAX));
        assert_eq!(parse_positive_int(huge), Ok(usize::MAX));
    }
}
