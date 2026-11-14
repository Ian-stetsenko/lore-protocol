//! Port of `tests/unit/commands/log.test.ts` (issue #22: positional paths and
//! the `--` pass-through route through `find_by_target`).

use super::*;
use crate::cli::{Cli, Command};
use crate::formatters::json_formatter::JsonFormatter;
use crate::interfaces::git_client::{LogOptions, RawCommit};
use crate::services::trailer_parser::TrailerParser;
use crate::test_support::{raw_commit, MockGitClient};
use clap::Parser;
use serde_json::Value;

fn parse(args: &[&str]) -> LogArgs {
    let cli = Cli::try_parse_from(["lore", "log"].iter().chain(args)).expect("valid args");
    match cli.command {
        Command::Log(a) => a,
        other => panic!("unexpected {other:?}"),
    }
}

fn commit(id: &str, file: &str) -> RawCommit {
    raw_commit()
        .hash(&format!("{id}{}", "0".repeat(32)))
        .trailers(&format!("Lore-id: {id}"))
        .files(&[file])
        .build()
}

/// `all` is returned for path-less queries, `filtered` when the args carry
/// a `--` pathspec separator.
struct Harness {
    git: MockGitClient,
    out: Vec<u8>,
}

impl Harness {
    fn new(all: Vec<RawCommit>, filtered: Vec<RawCommit>) -> Self {
        let git = MockGitClient::new();
        git.set_log(move |args, _| {
            Ok(if args.iter().any(|a| a == "--") {
                filtered.clone()
            } else {
                all.clone()
            })
        });
        Harness {
            git,
            out: Vec::new(),
        }
    }

    fn run(&mut self, args: &[&str]) -> Value {
        let parser = TrailerParser::new();
        let repo = AtomRepository::new(&self.git, &parser, Vec::new());
        let resolver = SupersessionResolver::new();
        let formatter = JsonFormatter::new();
        let deps = LogDeps {
            atom_repository: &repo,
            supersession_resolver: &resolver,
            formatter: &formatter,
        };
        let mut err = Vec::new();
        let mut io = Io::new(&mut self.out, &mut err);
        assert_eq!(run(&parse(args), &deps, &mut io).expect("log runs"), 0);
        serde_json::from_slice(&self.out).expect("json output")
    }

    /// Arguments of the first `git log` call (the atom query, not the bulk
    /// files pass, which the mock does not perform).
    fn first_log_args(&self) -> (Vec<String>, LogOptions) {
        self.git.log_calls().remove(0)
    }

    fn path_queries(&self) -> usize {
        self.git
            .log_calls()
            .iter()
            .filter(|(args, _)| args.iter().any(|a| a == "--"))
            .count()
    }
}

fn ids(out: &Value) -> Vec<String> {
    out["results"]
        .as_array()
        .expect("results")
        .iter()
        .map(|r| r["lore_id"].as_str().unwrap_or("").to_owned())
        .collect()
}

#[test]
fn accepts_a_positional_path_and_routes_through_find_by_target() {
    let matching = commit("aaaa0001", "src/main.ts");
    let mut h = Harness::new(vec![matching.clone()], vec![matching]);

    let out = h.run(&["src/main.ts"]);

    assert_eq!(h.git.log_call_count(), 1);
    assert_eq!(h.path_queries(), 1);
    let (args, options) = h.first_log_args();
    assert_eq!(args, vec!["--", "src/main.ts"]);
    assert!(options.lore_only);
    assert_eq!(ids(&out), vec!["aaaa0001"]);
    assert_eq!(out["target"], "src/main.ts");
}

#[test]
fn accepts_the_double_dash_pass_through_and_routes_identically() {
    let matching = commit("aaaa0002", "src/main.ts");
    let mut h = Harness::new(vec![matching.clone()], vec![matching]);

    let out = h.run(&["--", "src/main.ts"]);

    assert_eq!(h.path_queries(), 1);
    assert_eq!(h.first_log_args().0, vec!["--", "src/main.ts"]);
    assert_eq!(ids(&out), vec!["aaaa0002"]);
}

#[test]
fn uses_find_all_not_find_by_target_when_no_path_argument_is_provided() {
    let a = commit("aaaa0001", "src/a.ts");
    let b = commit("bbbb0002", "src/b.ts");
    let mut h = Harness::new(vec![a, b], Vec::new());

    let out = h.run(&[]);

    assert_eq!(h.git.log_call_count(), 1);
    assert_eq!(h.path_queries(), 0);
    let (args, options) = h.first_log_args();
    assert!(args.is_empty(), "{args:?}");
    assert!(options.lore_only);
    assert_eq!(ids(&out).len(), 2);
    assert_eq!(out["target"], "all");
    assert_eq!(out["target_type"], "global");
}

#[test]
fn combines_limit_with_a_positional_path_argument_limit_applied_client_side() {
    let a = commit("aaaa0001", "src/main.ts");
    let b = commit("bbbb0002", "src/main.ts");
    let mut h = Harness::new(Vec::new(), vec![a, b]);

    let out = h.run(&["--limit", "1", "src/main.ts"]);

    assert_eq!(h.path_queries(), 1);
    assert_eq!(h.first_log_args().0, vec!["--", "src/main.ts"]);
    assert_eq!(ids(&out), vec!["aaaa0001"]);
}

#[test]
fn passes_max_commits_to_find_by_target_as_max_count() {
    let atom = commit("cccc0001", "src/main.ts");
    let mut h = Harness::new(Vec::new(), vec![atom]);

    h.run(&["--max-commits", "50", "src/main.ts"]);

    let (args, _) = h.first_log_args();
    assert!(args.contains(&"--max-count=50".to_owned()), "{args:?}");
    // --limit never reaches git
    let mut h2 = Harness::new(Vec::new(), vec![commit("cccc0002", "src/main.ts")]);
    h2.run(&["--limit", "7", "src/main.ts"]);
    assert!(h2
        .first_log_args()
        .0
        .iter()
        .all(|a| !a.contains("--max-count")));
}

#[test]
fn reflects_total_atoms_before_limit_in_meta() {
    let atoms = vec![
        commit("aaaa0001", "src/a.ts"),
        commit("bbbb0002", "src/b.ts"),
        commit("cccc0003", "src/c.ts"),
    ];
    let mut h = Harness::new(atoms, Vec::new());

    let out = h.run(&["--limit", "1"]);

    assert_eq!(out["meta"]["total_atoms"], 3);
    assert_eq!(out["meta"]["filtered_atoms"], 1);
    assert_eq!(ids(&out).len(), 1);
}

#[test]
fn shows_superseded_atoms_with_their_status() {
    let old = commit("aaaa0001", "src/a.ts");
    let new = raw_commit()
        .hash(&"b".repeat(40))
        .trailers("Lore-id: bbbb0002\nSupersedes: aaaa0001")
        .build();
    let mut h = Harness::new(vec![new, old], Vec::new());

    let out = h.run(&[]);

    assert_eq!(ids(&out), vec!["bbbb0002", "aaaa0001"]);
    assert_eq!(out["results"][1]["superseded"], Value::Bool(true));
    assert_eq!(out["results"][1]["superseded_by"], "bbbb0002");
}
