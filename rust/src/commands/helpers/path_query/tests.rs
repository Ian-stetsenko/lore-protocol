//! Port of `tests/unit/commands/helpers/path-query-limit.test.ts`: `--limit`
//! applies after supersession filtering and never reaches git.

use super::*;
use crate::formatters::json_formatter::JsonFormatter;
use crate::interfaces::git_client::RawCommit;
use crate::services::trailer_parser::TrailerParser;
use crate::test_support::{raw_commit, MockGitClient};
use serde_json::Value;

fn commit(id: &str, supersedes: &[&str]) -> RawCommit {
    let mut trailers = format!("Lore-id: {id}");
    for s in supersedes {
        trailers.push_str(&format!("\nSupersedes: {s}"));
    }
    raw_commit()
        .hash(&format!("hash-{id}"))
        .trailers(&trailers)
        .build()
}

fn execute(git: &MockGitClient, args: PathQueryArgs) -> Value {
    let parser = TrailerParser::new();
    let repo = AtomRepository::new(git, &parser, Vec::new());
    let resolver = SupersessionResolver::new();
    let path_resolver = PathResolver::new();
    let formatter = JsonFormatter::new();
    let config = LoreConfig::default();
    let deps = PathQueryDeps {
        atom_repository: &repo,
        supersession_resolver: &resolver,
        path_resolver: &path_resolver,
        formatter: &formatter,
        config: &config,
    };
    let mut out = Vec::new();
    let mut err = Vec::new();
    let mut io = Io::new(&mut out, &mut err);
    let code = execute_path_query(&args, &deps, "context", VisibleTrailers::All, &mut io)
        .expect("query runs");
    assert_eq!(code, 0);
    serde_json::from_slice(&out).expect("json output")
}

fn args(target: &str) -> PathQueryArgs {
    PathQueryArgs {
        target: target.to_owned(),
        ..PathQueryArgs::default()
    }
}

fn result_count(out: &Value) -> usize {
    out["results"].as_array().map(Vec::len).unwrap_or(0)
}

#[test]
fn should_apply_limit_after_supersession_filtering() {
    // 5 atoms from git, 2 are superseded, limit 2
    let git = MockGitClient::new();
    git.set_log_result(vec![
        commit("eeee5555", &[]),
        commit("dddd4444", &["bbbb2222"]),
        commit("cccc3333", &["aaaa1111"]),
        commit("bbbb2222", &[]),
        commit("aaaa1111", &[]),
    ]);

    let out = execute(
        &git,
        PathQueryArgs {
            limit: Some(2),
            ..args("src/test.ts")
        },
    );

    assert_eq!(result_count(&out), 2);
    assert_eq!(out["meta"]["filtered_atoms"], 2);
    assert_eq!(out["meta"]["total_atoms"], 5);
    let ids: Vec<&str> = out["results"]
        .as_array()
        .expect("results")
        .iter()
        .map(|r| r["lore_id"].as_str().unwrap_or(""))
        .collect();
    assert_eq!(
        ids,
        vec!["eeee5555", "dddd4444"],
        "superseded atoms never shown"
    );
}

#[test]
fn should_not_pass_limit_to_atom_repository_only_max_commits() {
    let git = MockGitClient::new();
    execute(
        &git,
        PathQueryArgs {
            limit: Some(5),
            max_commits: Some(100),
            ..args("src/test.ts")
        },
    );

    let (log_args, options) = git.log_calls().remove(0);
    assert!(
        log_args.contains(&"--max-count=100".to_owned()),
        "{log_args:?}"
    );
    assert!(log_args.iter().all(|a| !a.contains('5')), "{log_args:?}");
    assert_eq!(&log_args[log_args.len() - 2..], &["--", "src/test.ts"]);
    assert!(options.lore_only);
}

#[test]
fn should_return_all_atoms_when_limit_is_not_specified() {
    let git = MockGitClient::new();
    git.set_log_result(vec![
        commit("aaaa1111", &[]),
        commit("bbbb2222", &[]),
        commit("cccc3333", &[]),
    ]);
    let out = execute(&git, args("src/test.ts"));
    assert_eq!(result_count(&out), 3);
}

#[test]
fn should_treat_limit_0_as_no_limit() {
    let git = MockGitClient::new();
    git.set_log_result(vec![commit("aaaa1111", &[]), commit("bbbb2222", &[])]);
    let out = execute(
        &git,
        PathQueryArgs {
            limit: Some(0),
            ..args("src/test.ts")
        },
    );
    assert_eq!(result_count(&out), 2);
}

#[test]
fn all_flag_keeps_superseded_atoms_and_scope_switches_target() {
    let git = MockGitClient::new();
    git.set_log_result(vec![
        commit("cccc3333", &["aaaa1111"]),
        commit("aaaa1111", &[]),
    ]);

    let hidden = execute(&git, args("src/test.ts"));
    assert_eq!(result_count(&hidden), 1);
    assert_eq!(hidden["target_type"], "file");

    let shown = execute(
        &git,
        PathQueryArgs {
            all: true,
            ..args("src/")
        },
    );
    assert_eq!(result_count(&shown), 2);
    assert_eq!(shown["results"][1]["superseded_by"], "cccc3333");
    assert_eq!(shown["target_type"], "directory");

    let git = MockGitClient::new();
    git.set_log_result(vec![raw_commit()
        .subject("feat(auth): x")
        .trailers("Lore-id: aaaa1111")
        .build()]);
    let scoped = execute(
        &git,
        PathQueryArgs {
            scope: Some("auth".to_owned()),
            ..args("ignored")
        },
    );
    assert_eq!(scoped["target"], "scope:auth");
    assert_eq!(scoped["target_type"], "global");
    assert_eq!(result_count(&scoped), 1);
    let (log_args, _) = git.log_calls().remove(0);
    assert!(
        !log_args.contains(&"--".to_owned()),
        "scope queries carry no pathspec"
    );
}
