//! Duration strings used by staleness thresholds: an integer followed by a
//! unit, `d` (days), `w` (weeks), `m` (30-day months) or `y` (365-day years).
//! Examples: `30d`, `2w`, `6m`, `1y`.
//!
//! Pure module: no I/O, safe to use from the CLI layer and services alike.

use std::sync::LazyLock;

use regex::Regex;

/// ASCII digits only, like the JS `\d` it mirrors (Rust `\d` is Unicode).
static DURATION_PATTERN: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([0-9]+)(d|w|m|y)$").expect("valid regex"));

pub const MS_PER_DAY: i64 = 24 * 60 * 60 * 1000;

fn days_per_unit(unit: &str) -> Option<i64> {
    match unit {
        "d" => Some(1),
        "w" => Some(7),
        "m" => Some(30),
        "y" => Some(365),
        _ => None,
    }
}

/// Parse a duration string into milliseconds; `None` when it is not a valid
/// duration, so each caller chooses its own policy (reject a CLI flag, fall
/// back for config). An amount too large to represent saturates, as a JS
/// number stays finite and simply never matches.
pub fn parse_duration_ms(duration: &str) -> Option<i64> {
    let caps = DURATION_PATTERN.captures(duration)?;
    let days_per_unit = days_per_unit(&caps[2])?;
    let amount = caps[1].parse::<i64>().unwrap_or(i64::MAX);
    Some(
        amount
            .saturating_mul(days_per_unit)
            .saturating_mul(MS_PER_DAY),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_unit() {
        assert_eq!(parse_duration_ms("30d"), Some(30 * MS_PER_DAY));
        assert_eq!(parse_duration_ms("2w"), Some(14 * MS_PER_DAY));
        assert_eq!(parse_duration_ms("6m"), Some(180 * MS_PER_DAY));
        assert_eq!(parse_duration_ms("1y"), Some(365 * MS_PER_DAY));
        assert_eq!(parse_duration_ms("0d"), Some(0));
    }

    #[test]
    fn rejects_anything_else() {
        // "٣d": JS `\d` is ASCII-only, so non-ASCII digits are not a duration.
        for bad in [
            "", "30", "x", "6M", "-1d", "1.5d", " 1d", "1d ", "1 d", "d", "\u{663}d",
        ] {
            assert_eq!(parse_duration_ms(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn saturates_amounts_too_large_to_represent() {
        assert_eq!(
            parse_duration_ms("99999999999999999999999d"),
            Some(i64::MAX)
        );
    }
}
