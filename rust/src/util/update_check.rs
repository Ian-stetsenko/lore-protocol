//! Gate deciding whether the CLI may look for a newer release.
//!
//! The check itself is intentionally not performed by this binary yet: the
//! Node package used the npm registry, which is not the distribution channel
//! for a native binary. The gate is kept so the CLI contract
//! (`--no-update-notifier`, `LORE_NO_UPDATE_CHECK`, `[cli] update_check`) is
//! honoured and ready for a release-based notifier.

use std::io::IsTerminal;

/// Pure decision: should an update check run?
///
/// Skips when stderr is not a TTY, in CI, when `NO_UPDATE_NOTIFIER` or
/// `LORE_NO_UPDATE_CHECK` is set, when output is JSON, when
/// `--no-update-notifier` was passed, or when disabled in config.
pub fn should_check_for_update(
    config_update_check: bool,
    stderr_is_tty: bool,
    env: &dyn Fn(&str) -> Option<String>,
    argv: &[String],
) -> bool {
    if !stderr_is_tty {
        return false;
    }
    if env_set(env, "CI")
        || env_set(env, "NO_UPDATE_NOTIFIER")
        || env_set(env, "LORE_NO_UPDATE_CHECK")
    {
        return false;
    }
    if argv.iter().any(|a| a == "--json" || a == "--format=json") {
        return false;
    }
    if let Some(idx) = argv.iter().position(|a| a == "--format") {
        if argv.get(idx + 1).map(String::as_str) == Some("json") {
            return false;
        }
    }
    if argv.iter().any(|a| a == "--no-update-notifier") {
        return false;
    }
    config_update_check
}

/// [`should_check_for_update`] evaluated against the current process.
pub fn should_check_for_update_now(config_update_check: bool) -> bool {
    let argv: Vec<String> = std::env::args().collect();
    should_check_for_update(
        config_update_check,
        std::io::stderr().is_terminal(),
        &|name| std::env::var(name).ok(),
        &argv,
    )
}

fn env_set(env: &dyn Fn(&str) -> Option<String>, name: &str) -> bool {
    env(name).map(|v| !v.is_empty()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_env(_: &str) -> Option<String> {
        None
    }

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn returns_true_in_the_happy_path() {
        assert!(should_check_for_update(
            true,
            true,
            &no_env,
            &args(&["lore", "log"])
        ));
    }

    #[test]
    fn skips_when_stderr_is_not_a_tty() {
        assert!(!should_check_for_update(
            true,
            false,
            &no_env,
            &args(&["lore"])
        ));
    }

    #[test]
    fn skips_in_ci_and_with_opt_out_env_vars() {
        for var in ["CI", "NO_UPDATE_NOTIFIER", "LORE_NO_UPDATE_CHECK"] {
            let env = move |name: &str| (name == var).then(|| "1".to_string());
            assert!(
                !should_check_for_update(true, true, &env, &args(&["lore"])),
                "{var}"
            );
        }
    }

    #[test]
    fn empty_env_var_does_not_count() {
        let env = |name: &str| (name == "CI").then(String::new);
        assert!(should_check_for_update(true, true, &env, &args(&["lore"])));
    }

    #[test]
    fn skips_for_json_output_in_every_spelling() {
        assert!(!should_check_for_update(
            true,
            true,
            &no_env,
            &args(&["lore", "log", "--json"])
        ));
        assert!(!should_check_for_update(
            true,
            true,
            &no_env,
            &args(&["lore", "--format=json"])
        ));
        assert!(!should_check_for_update(
            true,
            true,
            &no_env,
            &args(&["lore", "--format", "json"])
        ));
        assert!(should_check_for_update(
            true,
            true,
            &no_env,
            &args(&["lore", "--format", "text"])
        ));
    }

    #[test]
    fn skips_with_flag_or_config() {
        assert!(!should_check_for_update(
            true,
            true,
            &no_env,
            &args(&["lore", "--no-update-notifier"])
        ));
        assert!(!should_check_for_update(
            false,
            true,
            &no_env,
            &args(&["lore"])
        ));
    }
}
