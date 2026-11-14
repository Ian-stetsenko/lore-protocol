//! Command-line definitions (clap). Parsing only; no behaviour lives here.
//!
//! Global display options (`--json`, `--format`, `--no-color`,
//! `--no-update-notifier`) are accepted before or after the subcommand, as
//! Commander allowed. Query flags live on their subcommands.

use std::path::PathBuf;

use clap::{ArgAction, Args, Parser, Subcommand};

use crate::types::commit_input::CommitCommandOptions;

#[derive(Parser, Debug, Clone)]
#[command(
    name = "lore",
    version,
    about = "CLI tool for the Lore protocol -- structured decision context in git commits",
    disable_help_subcommand = true,
    arg_required_else_help = true
)]
pub struct Cli {
    /// Shorthand for --format json
    #[arg(long, global = true)]
    pub json: bool,

    /// Output format: text or json
    #[arg(long, global = true, value_name = "type", default_value = "text")]
    pub format: String,

    /// Disable colored output
    #[arg(long = "no-color", global = true)]
    pub no_color: bool,

    /// Disable update notification
    #[arg(long = "no-update-notifier", global = true)]
    pub no_update_notifier: bool,

    #[command(subcommand)]
    pub command: Command,
}

impl Cli {
    /// Whether JSON output was requested by either spelling.
    pub fn wants_json(&self) -> bool {
        self.json || self.format == "json"
    }
}

#[derive(Subcommand, Debug, Clone)]
pub enum Command {
    /// Initialize .lore/ config in repository
    Init,

    /// Full lore summary for a code region
    Context(PathQueryArgs),

    /// Active constraints for a code region
    Constraints(PathQueryArgs),

    /// Previously rejected alternatives for a code region
    Rejected(PathQueryArgs),

    /// Active forward-looking warnings for a code region
    Directives(PathQueryArgs),

    /// Test coverage: what was and was not verified
    #[command(visible_alias = "coverage")]
    Tested(PathQueryArgs),

    /// Decision context for a specific line or line range
    Why(WhyArgs),

    /// Search across all lore with filters
    Search(SearchArgs),

    /// Lore-enriched git log
    Log(LogArgs),

    /// Flag potentially outdated knowledge
    Stale(StaleArgs),

    /// Follow decision chain from a starting atom
    Trace(TraceArgs),

    /// Create a Lore-enriched commit
    Commit(CommitArgs),

    /// Validate commits for Lore protocol compliance
    Validate(ValidateArgs),

    /// Merge atoms for squash-merge preparation
    Squash(SquashArgs),

    /// Health check: broken refs, config issues
    Doctor,

    /// Manage git hooks for Lore protocol enforcement
    Hooks(HooksArgs),
}

/// Parse a CLI value as a strict positive integer; rejects non-numeric
/// trailing characters and zero.
pub fn parse_positive_int(value: &str) -> Result<usize, String> {
    let err = || format!("Expected a positive integer, got \"{value}\"");
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_digit()) {
        return Err(err());
    }
    match value.parse::<usize>() {
        Ok(n) if n >= 1 => Ok(n),
        _ => Err(err()),
    }
}

/// Options shared by the path-scoped query commands
/// (`context`, `constraints`, `rejected`, `directives`, `tested`).
#[derive(Args, Debug, Clone, Default, PartialEq, Eq)]
pub struct PathQueryArgs {
    /// File, directory/, glob, or file:line[-line]
    pub target: String,

    /// Filter by conventional commit scope instead of path
    #[arg(long, value_name = "name")]
    pub scope: Option<String>,

    /// Transitively follow Related/Supersedes/Depends-on links
    #[arg(long)]
    pub follow: bool,

    /// Include superseded entries
    #[arg(long)]
    pub all: bool,

    /// Filter by commit author
    #[arg(long, value_name = "email")]
    pub author: Option<String>,

    /// Maximum number of results to display
    #[arg(long, value_name = "n", value_parser = parse_positive_int)]
    pub limit: Option<usize>,

    /// Maximum git commits to scan (supersession may be incomplete)
    #[arg(long = "max-commits", value_name = "n", value_parser = parse_positive_int)]
    pub max_commits: Option<usize>,

    /// Only consider commits since ref/date
    #[arg(long, value_name = "ref")]
    pub since: Option<String>,
}

#[derive(Args, Debug, Clone, Default, PartialEq, Eq)]
pub struct WhyArgs {
    /// file:line or file:line-line
    pub target: String,
}

#[derive(Args, Debug, Clone, Default, PartialEq, Eq)]
pub struct SearchArgs {
    /// Filter by confidence: low, medium, high
    #[arg(long, value_name = "level")]
    pub confidence: Option<String>,

    /// Filter by scope-risk: narrow, moderate, wide
    #[arg(long = "scope-risk", value_name = "level")]
    pub scope_risk: Option<String>,

    /// Filter by reversibility: clean, migration-needed, irreversible
    #[arg(long, value_name = "level")]
    pub reversibility: Option<String>,

    /// Filter atoms that contain this trailer type
    #[arg(long, value_name = "trailer")]
    pub has: Option<String>,

    /// Filter by commit author
    #[arg(long, value_name = "email")]
    pub author: Option<String>,

    /// Filter by conventional commit scope
    #[arg(long, value_name = "name")]
    pub scope: Option<String>,

    /// Full-text search across intent, body, and trailer values
    #[arg(long, value_name = "query")]
    pub text: Option<String>,

    /// Only consider commits since ref/date
    #[arg(long, value_name = "ref")]
    pub since: Option<String>,

    /// Upper time/revision bound
    #[arg(long, value_name = "ref")]
    pub until: Option<String>,

    /// Include superseded entries
    #[arg(long)]
    pub all: bool,

    /// Maximum number of results to display
    #[arg(long, value_name = "n", value_parser = parse_positive_int)]
    pub limit: Option<usize>,

    /// Maximum git commits to scan (supersession may be incomplete)
    #[arg(long = "max-commits", value_name = "n", value_parser = parse_positive_int)]
    pub max_commits: Option<usize>,
}

#[derive(Args, Debug, Clone, Default, PartialEq, Eq)]
pub struct LogArgs {
    /// Restrict to commits touching these paths
    #[arg(value_name = "paths", num_args = 0..)]
    pub paths: Vec<String>,

    /// Maximum number of results to display
    #[arg(long, value_name = "n", value_parser = parse_positive_int)]
    pub limit: Option<usize>,

    /// Maximum git commits to scan (supersession may be incomplete)
    #[arg(long = "max-commits", value_name = "n", value_parser = parse_positive_int)]
    pub max_commits: Option<usize>,

    /// Only consider commits since ref/date
    #[arg(long, value_name = "ref")]
    pub since: Option<String>,
}

#[derive(Args, Debug, Clone, Default, PartialEq, Eq)]
pub struct StaleArgs {
    /// Optional target; analyzes all atoms when omitted
    pub target: Option<String>,

    /// Time-based staleness threshold (e.g., 6m, 1y)
    #[arg(long = "older-than", value_name = "duration")]
    pub older_than: Option<String>,

    /// File drift threshold (commits since atom)
    #[arg(long, value_name = "n")]
    pub drift: Option<usize>,

    /// Flag low-confidence atoms
    #[arg(long = "low-confidence")]
    pub low_confidence: bool,
}

#[derive(Args, Debug, Clone, PartialEq, Eq)]
pub struct TraceArgs {
    /// Starting atom (8-char hex Lore-id)
    #[arg(value_name = "lore-id")]
    pub lore_id: String,

    /// Maximum BFS traversal depth
    #[arg(long = "max-depth", value_name = "n", default_value_t = 10)]
    pub max_depth: usize,
}

#[derive(Args, Debug, Clone, Default, PartialEq, Eq)]
pub struct CommitArgs {
    /// Amend the last commit
    #[arg(long)]
    pub amend: bool,

    /// Keep the existing commit message (use with --amend)
    #[arg(long = "no-edit")]
    pub no_edit: bool,

    /// Read JSON input from file
    #[arg(long, value_name = "path")]
    pub file: Option<PathBuf>,

    /// Interactive mode (guided prompts)
    #[arg(short = 'i', long)]
    pub interactive: bool,

    /// Intent line (why the change was made)
    #[arg(long, value_name = "text")]
    pub intent: Option<String>,

    /// Body (narrative context)
    #[arg(long, value_name = "text")]
    pub body: Option<String>,

    /// Constraint trailer value (repeatable)
    #[arg(long, value_name = "text", num_args = 1.., action = ArgAction::Append)]
    pub constraint: Option<Vec<String>>,

    /// Rejected trailer value (repeatable)
    #[arg(long, value_name = "text", num_args = 1.., action = ArgAction::Append)]
    pub rejected: Option<Vec<String>>,

    /// Confidence level: low, medium, high
    #[arg(long, value_name = "level")]
    pub confidence: Option<String>,

    /// Scope-risk level: narrow, moderate, wide
    #[arg(long = "scope-risk", value_name = "level")]
    pub scope_risk: Option<String>,

    /// Reversibility level: clean, migration-needed, irreversible
    #[arg(long, value_name = "level")]
    pub reversibility: Option<String>,

    /// Directive trailer value (repeatable)
    #[arg(long, value_name = "text", num_args = 1.., action = ArgAction::Append)]
    pub directive: Option<Vec<String>>,

    /// Tested trailer value (repeatable)
    #[arg(long, value_name = "text", num_args = 1.., action = ArgAction::Append)]
    pub tested: Option<Vec<String>>,

    /// Not-tested trailer value (repeatable)
    #[arg(long = "not-tested", value_name = "text", num_args = 1.., action = ArgAction::Append)]
    pub not_tested: Option<Vec<String>>,

    /// Supersedes Lore-id (repeatable)
    #[arg(long, value_name = "id", num_args = 1.., action = ArgAction::Append)]
    pub supersedes: Option<Vec<String>>,

    /// Depends-on Lore-id (repeatable)
    #[arg(long = "depends-on", value_name = "id", num_args = 1.., action = ArgAction::Append)]
    pub depends_on: Option<Vec<String>>,

    /// Related Lore-id (repeatable)
    #[arg(long, value_name = "id", num_args = 1.., action = ArgAction::Append)]
    pub related: Option<Vec<String>>,
}

impl From<&CommitArgs> for CommitCommandOptions {
    fn from(a: &CommitArgs) -> Self {
        CommitCommandOptions {
            amend: a.amend,
            no_edit: a.no_edit,
            file: a.file.clone(),
            interactive: a.interactive,
            intent: a.intent.clone(),
            body: a.body.clone(),
            constraint: a.constraint.clone(),
            rejected: a.rejected.clone(),
            confidence: a.confidence.clone(),
            scope_risk: a.scope_risk.clone(),
            reversibility: a.reversibility.clone(),
            directive: a.directive.clone(),
            tested: a.tested.clone(),
            not_tested: a.not_tested.clone(),
            supersedes: a.supersedes.clone(),
            depends_on: a.depends_on.clone(),
            related: a.related.clone(),
        }
    }
}

#[derive(Args, Debug, Clone, Default, PartialEq, Eq)]
pub struct ValidateArgs {
    /// Git revision range (default: the last commit)
    pub range: Option<String>,

    /// Validate all commits since ref (e.g., main)
    #[arg(long, value_name = "ref")]
    pub since: Option<String>,

    /// Validate the last N commits
    #[arg(long, value_name = "n")]
    pub last: Option<usize>,

    /// Treat warnings as errors
    #[arg(long)]
    pub strict: bool,

    /// Validate a commit message file (used by git hooks)
    #[arg(long = "commit-msg-file", value_name = "path")]
    pub commit_msg_file: Option<PathBuf>,
}

#[derive(Args, Debug, Clone, PartialEq, Eq)]
pub struct SquashArgs {
    /// Git revision range, e.g. main..HEAD
    pub range: String,

    /// Override the intent line of the merged message
    #[arg(long, value_name = "text")]
    pub intent: Option<String>,

    /// Override the body of the merged message
    #[arg(long, value_name = "text")]
    pub body: Option<String>,
}

#[derive(Args, Debug, Clone, PartialEq, Eq)]
pub struct HooksArgs {
    #[command(subcommand)]
    pub action: HooksAction,
}

#[derive(Subcommand, Debug, Clone, PartialEq, Eq)]
pub enum HooksAction {
    /// Install commit-msg hook for Lore validation
    Install {
        /// Overwrite existing non-Lore hooks (backs up to .bak)
        #[arg(long)]
        force: bool,
    },
    /// Remove Lore-managed commit-msg hook
    Uninstall,
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    fn parse(args: &[&str]) -> Cli {
        Cli::try_parse_from(std::iter::once("lore").chain(args.iter().copied())).unwrap()
    }

    #[test]
    fn definitions_are_consistent() {
        Cli::command().debug_assert();
    }

    #[test]
    fn global_options_work_before_and_after_the_subcommand() {
        let before = parse(&["--json", "log"]);
        let after = parse(&["log", "--json"]);
        assert!(before.wants_json());
        assert!(after.wants_json());
        assert!(parse(&["log", "--format", "json"]).wants_json());
        assert!(parse(&["log", "--format=json"]).wants_json());
        assert!(!parse(&["log"]).wants_json());
        assert!(parse(&["log", "--no-color"]).no_color);
    }

    #[test]
    fn path_query_args_parse() {
        let cli = parse(&[
            "constraints",
            "src/auth.ts:10-20",
            "--follow",
            "--all",
            "--author",
            "alice",
            "--limit",
            "5",
            "--max-commits",
            "100",
            "--since",
            "2025-01-01",
        ]);
        match cli.command {
            Command::Constraints(a) => {
                assert_eq!(a.target, "src/auth.ts:10-20");
                assert!(a.follow && a.all);
                assert_eq!(a.author.as_deref(), Some("alice"));
                assert_eq!(a.limit, Some(5));
                assert_eq!(a.max_commits, Some(100));
                assert_eq!(a.since.as_deref(), Some("2025-01-01"));
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn coverage_is_an_alias_for_tested() {
        let cli = parse(&["coverage", "src/"]);
        assert!(matches!(cli.command, Command::Tested(a) if a.target == "src/"));
    }

    #[test]
    fn positive_int_parser_rejects_bad_values() {
        assert_eq!(parse_positive_int("5"), Ok(5));
        assert!(parse_positive_int("0").is_err());
        assert!(parse_positive_int("5abc").is_err());
        assert!(parse_positive_int("-1").is_err());
        assert!(parse_positive_int("").is_err());
        assert_eq!(
            parse_positive_int("abc").unwrap_err(),
            "Expected a positive integer, got \"abc\""
        );
        assert!(Cli::try_parse_from(["lore", "log", "--limit", "0"]).is_err());
    }

    #[test]
    fn log_accepts_paths_after_double_dash() {
        let cli = parse(&["log", "--limit", "3", "--", "src/", "docs/"]);
        match cli.command {
            Command::Log(a) => {
                assert_eq!(a.paths, vec!["src/", "docs/"]);
                assert_eq!(a.limit, Some(3));
            }
            other => panic!("unexpected {other:?}"),
        }
        let bare = parse(&["log", "src/"]);
        assert!(matches!(bare.command, Command::Log(a) if a.paths == vec!["src/"]));
    }

    #[test]
    fn commit_repeatable_flags_collect_values() {
        let cli = parse(&[
            "commit",
            "--intent",
            "feat: x",
            "--constraint",
            "a",
            "b",
            "--constraint",
            "c",
            "--not-tested",
            "perf",
            "--depends-on",
            "a1b2c3d4",
            "--scope-risk",
            "wide",
            "-i",
        ]);
        match cli.command {
            Command::Commit(a) => {
                assert_eq!(a.intent.as_deref(), Some("feat: x"));
                assert_eq!(
                    a.constraint.as_deref(),
                    Some(&["a", "b", "c"].map(String::from)[..])
                );
                assert_eq!(a.not_tested.as_deref(), Some(&["perf".to_string()][..]));
                assert_eq!(a.depends_on.as_deref(), Some(&["a1b2c3d4".to_string()][..]));
                assert_eq!(a.scope_risk.as_deref(), Some("wide"));
                assert!(a.interactive);
                let opts = CommitCommandOptions::from(&a);
                assert!(opts.has_input());
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn commit_amend_no_edit_parse() {
        let cli = parse(&["commit", "--amend", "--no-edit"]);
        match cli.command {
            Command::Commit(a) => {
                assert!(a.amend && a.no_edit);
                assert!(!CommitCommandOptions::from(&a).has_input());
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn trace_has_default_depth() {
        let cli = parse(&["trace", "a1b2c3d4"]);
        assert!(
            matches!(cli.command, Command::Trace(a) if a.max_depth == 10 && a.lore_id == "a1b2c3d4")
        );
        let cli = parse(&["trace", "a1b2c3d4", "--max-depth", "2"]);
        assert!(matches!(cli.command, Command::Trace(a) if a.max_depth == 2));
    }

    #[test]
    fn validate_and_hooks_parse() {
        let cli = parse(&[
            "validate",
            "--commit-msg-file",
            ".git/COMMIT_EDITMSG",
            "--strict",
        ]);
        match cli.command {
            Command::Validate(a) => {
                assert!(a.strict);
                assert_eq!(
                    a.commit_msg_file,
                    Some(PathBuf::from(".git/COMMIT_EDITMSG"))
                );
                assert!(a.range.is_none());
            }
            other => panic!("unexpected {other:?}"),
        }
        let cli = parse(&["validate", "main..HEAD", "--last", "3"]);
        assert!(
            matches!(cli.command, Command::Validate(a) if a.range.as_deref() == Some("main..HEAD") && a.last == Some(3))
        );

        let cli = parse(&["hooks", "install", "--force"]);
        assert!(matches!(
            cli.command,
            Command::Hooks(HooksArgs {
                action: HooksAction::Install { force: true }
            })
        ));
        let cli = parse(&["hooks", "uninstall"]);
        assert!(matches!(
            cli.command,
            Command::Hooks(HooksArgs {
                action: HooksAction::Uninstall
            })
        ));
    }

    #[test]
    fn stale_target_is_optional() {
        assert!(matches!(parse(&["stale"]).command, Command::Stale(a) if a.target.is_none()));
        let cli = parse(&[
            "stale",
            "src/",
            "--older-than",
            "1y",
            "--drift",
            "5",
            "--low-confidence",
        ]);
        match cli.command {
            Command::Stale(a) => {
                assert_eq!(a.target.as_deref(), Some("src/"));
                assert_eq!(a.older_than.as_deref(), Some("1y"));
                assert_eq!(a.drift, Some(5));
                assert!(a.low_confidence);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn no_subcommand_is_an_error() {
        assert!(Cli::try_parse_from(["lore"]).is_err());
    }
}
