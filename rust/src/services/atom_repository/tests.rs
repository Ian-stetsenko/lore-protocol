//! Ported case-for-case from `tests/unit/services/atom-repository.test.ts`.
//! The TS suite mocks the trailer parser with a simple `Key: value` parser;
//! the real `TrailerParser` yields identical results for these inputs.

use super::*;
use crate::interfaces::git_client::LogOptions;
use crate::test_support::{atom, date, raw_commit, MockGitClient};

struct LoreCommit {
    hash: &'static str,
    date: &'static str,
    author: &'static str,
    subject: &'static str,
    body: &'static str,
    lore_id: String,
    trailer_extras: &'static str,
    files_changed: Vec<&'static str>,
}

impl Default for LoreCommit {
    fn default() -> Self {
        LoreCommit {
            hash: "abc12345",
            date: "2025-01-15T10:00:00Z",
            author: "dev@example.com",
            subject: "feat(auth): add login",
            body: "Implemented login flow.",
            lore_id: "a1b2c3d4".to_owned(),
            trailer_extras: "",
            files_changed: vec!["src/auth.ts"],
        }
    }
}

/// Mirrors `makeLoreCommit` from the TS suite.
fn make_lore_commit(c: LoreCommit) -> RawCommit {
    let trailers = format!("Lore-id: {}\n{}", c.lore_id, c.trailer_extras)
        .trim()
        .to_owned();
    raw_commit()
        .hash(c.hash)
        .date(c.date)
        .author(c.author)
        .subject(c.subject)
        .body(c.body)
        .trailers(&trailers)
        .files(&c.files_changed)
        .build()
}

fn lore_commit(lore_id: &str) -> RawCommit {
    make_lore_commit(LoreCommit {
        lore_id: lore_id.to_owned(),
        ..LoreCommit::default()
    })
}

fn lore_commit_with_hash(hash: &'static str, lore_id: &str) -> RawCommit {
    make_lore_commit(LoreCommit {
        hash,
        lore_id: lore_id.to_owned(),
        ..LoreCommit::default()
    })
}

fn lore_commit_with_extras(hash: &'static str, lore_id: &str, extras: &'static str) -> RawCommit {
    make_lore_commit(LoreCommit {
        hash,
        lore_id: lore_id.to_owned(),
        trailer_extras: extras,
        ..LoreCommit::default()
    })
}

fn non_lore_commit(hash: &str, subject: &str) -> RawCommit {
    raw_commit()
        .hash(hash)
        .date("2025-01-16T10:00:00Z")
        .author("dev@example.com")
        .subject(subject)
        .body("")
        .trailers("")
        .files(&[])
        .build()
}

fn git_log_args() -> Vec<String> {
    vec!["--".to_owned(), "src/auth.ts".to_owned()]
}

fn query_options() -> PathQueryOptions {
    PathQueryOptions::default()
}

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| v.to_string()).collect()
}

/// `atomA`-style fixture used throughout the follow-link tests: id
/// `aaaa1111`, hash `aaa`, `Related: bbbb2222`.
fn atom_a_related_b() -> LoreAtom {
    atom()
        .id("aaaa1111")
        .hash("aaa")
        .author("dev@example.com")
        .intent("test")
        .files(&[])
        .related(&["bbbb2222"])
        .build()
}

fn ids(atoms: &[LoreAtom]) -> Vec<&str> {
    atoms.iter().map(|a| a.lore_id.as_str()).collect()
}

const PARSER: TrailerParser = TrailerParser;

// ---------------------------------------------------------------------------
// describe('findByTarget')
// ---------------------------------------------------------------------------
mod find_by_target {
    use super::*;

    #[test]
    fn should_return_atoms_for_a_file_target() {
        let git = MockGitClient::new();
        git.set_log_result(vec![lore_commit("a1b2c3d4")]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo
            .find_by_target(&git_log_args(), &query_options())
            .unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].lore_id, "a1b2c3d4");
        assert_eq!(result[0].commit_hash, "abc12345");
        assert_eq!(result[0].author, "dev@example.com");
        assert_eq!(result[0].files_changed, strings(&["src/auth.ts"]));
        assert_eq!(result[0].date, date("2025-01-15T10:00:00Z"));
        assert_eq!(result[0].body, "Implemented login flow.");
    }

    #[test]
    fn should_filter_out_non_lore_commits() {
        let git = MockGitClient::new();
        git.set_log_result(vec![
            lore_commit("a1b2c3d4"),
            non_lore_commit("def456", "chore: update deps"),
        ]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo
            .find_by_target(&git_log_args(), &query_options())
            .unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].lore_id, "a1b2c3d4");
    }

    #[test]
    fn should_pass_author_filter_to_git_log_args() {
        let git = MockGitClient::new();
        let repo = AtomRepository::new(&git, &PARSER, vec![]);
        let options = PathQueryOptions {
            author: Some("alice@example.com".to_owned()),
            ..query_options()
        };

        repo.find_by_target(&git_log_args(), &options).unwrap();

        let (args, _) = &git.log_calls()[0];
        assert!(args.contains(&"--author=alice@example.com".to_owned()));
    }

    #[test]
    fn should_pass_since_filter_to_git_log_args() {
        let git = MockGitClient::new();
        let repo = AtomRepository::new(&git, &PARSER, vec![]);
        let options = PathQueryOptions {
            since: Some("2025-01-01".to_owned()),
            ..query_options()
        };

        repo.find_by_target(&git_log_args(), &options).unwrap();

        let (args, _) = &git.log_calls()[0];
        assert!(args.contains(&"--since=2025-01-01".to_owned()));
    }

    #[test]
    fn should_pass_max_commits_to_git_log_args() {
        let git = MockGitClient::new();
        let repo = AtomRepository::new(&git, &PARSER, vec![]);
        let options = PathQueryOptions {
            max_commits: Some(5),
            ..query_options()
        };

        repo.find_by_target(&git_log_args(), &options).unwrap();

        let (args, _) = &git.log_calls()[0];
        assert!(args.contains(&"--max-count=5".to_owned()));
    }

    #[test]
    fn should_return_empty_array_when_no_commits_match() {
        let git = MockGitClient::new();
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo
            .find_by_target(&git_log_args(), &query_options())
            .unwrap();

        assert!(result.is_empty());
    }

    #[test]
    fn should_apply_author_filter_at_the_application_level() {
        let git = MockGitClient::new();
        git.set_log_result(vec![
            make_lore_commit(LoreCommit {
                hash: "aaa",
                author: "alice@example.com",
                lore_id: "aaaa1111".to_owned(),
                ..LoreCommit::default()
            }),
            make_lore_commit(LoreCommit {
                hash: "bbb",
                author: "bob@example.com",
                lore_id: "bbbb2222".to_owned(),
                ..LoreCommit::default()
            }),
        ]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);
        let options = PathQueryOptions {
            author: Some("alice".to_owned()),
            ..query_options()
        };

        let result = repo.find_by_target(&git_log_args(), &options).unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].author, "alice@example.com");
    }

    #[test]
    fn should_not_apply_limit_at_the_repository_level_caller_responsibility() {
        let git = MockGitClient::new();
        git.set_log_result(vec![
            lore_commit_with_hash("aaa", "aaaa1111"),
            lore_commit_with_hash("bbb", "bbbb2222"),
            lore_commit_with_hash("ccc", "cccc3333"),
        ]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);
        let options = PathQueryOptions {
            limit: Some(2),
            ..query_options()
        };

        let result = repo.find_by_target(&git_log_args(), &options).unwrap();

        assert_eq!(result.len(), 3);
    }

    // Rust-specific coverage of the second-layer `since` filter.
    #[test]
    fn should_apply_since_filter_at_the_application_level_for_absolute_dates() {
        let git = MockGitClient::new();
        git.set_log_result(vec![
            make_lore_commit(LoreCommit {
                hash: "old",
                date: "2024-12-31T23:59:59Z",
                lore_id: "aaaa1111".to_owned(),
                ..LoreCommit::default()
            }),
            make_lore_commit(LoreCommit {
                hash: "new",
                date: "2025-01-01T00:00:00Z",
                lore_id: "bbbb2222".to_owned(),
                ..LoreCommit::default()
            }),
        ]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);
        let options = PathQueryOptions {
            since: Some("2025-01-01".to_owned()),
            ..query_options()
        };

        let result = repo.find_by_target(&git_log_args(), &options).unwrap();

        assert_eq!(ids(&result), vec!["bbbb2222"]);
    }

    #[test]
    fn should_skip_the_application_level_since_filter_for_relative_dates() {
        let git = MockGitClient::new();
        git.set_log_result(vec![make_lore_commit(LoreCommit {
            date: "2020-01-01T00:00:00Z",
            ..LoreCommit::default()
        })]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);
        let options = PathQueryOptions {
            since: Some("1 week ago".to_owned()),
            ..query_options()
        };

        let result = repo.find_by_target(&git_log_args(), &options).unwrap();

        assert_eq!(result.len(), 1);
        let (args, _) = &git.log_calls()[0];
        assert!(args.contains(&"--since=1 week ago".to_owned()));
    }
}

// ---------------------------------------------------------------------------
// describe('findByLoreId')
// ---------------------------------------------------------------------------
mod find_by_lore_id {
    use super::*;

    #[test]
    fn should_find_an_atom_by_its_lore_id() {
        let git = MockGitClient::new();
        git.set_log_result(vec![lore_commit("deadbeef")]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.find_by_lore_id("deadbeef").unwrap();

        assert_eq!(result.map(|a| a.lore_id), Some("deadbeef".to_owned()));
    }

    #[test]
    fn should_return_null_if_no_atom_matches_the_lore_id() {
        let git = MockGitClient::new();
        git.set_log_result(vec![lore_commit("a1b2c3d4")]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.find_by_lore_id("deadbeef").unwrap();

        assert!(result.is_none());
    }

    #[test]
    fn should_return_null_for_invalid_lore_id_format() {
        let git = MockGitClient::new();
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.find_by_lore_id("not-valid").unwrap();

        assert!(result.is_none());
        assert_eq!(git.log_call_count(), 0);
    }

    #[test]
    fn should_return_null_for_empty_lore_id() {
        let git = MockGitClient::new();
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.find_by_lore_id("").unwrap();

        assert!(result.is_none());
    }
}

// ---------------------------------------------------------------------------
// describe('findAll')
// ---------------------------------------------------------------------------
mod find_all {
    use super::*;

    #[test]
    fn should_return_all_lore_atoms() {
        let git = MockGitClient::new();
        git.set_log_result(vec![
            lore_commit_with_hash("aaa", "aaaa1111"),
            lore_commit_with_hash("bbb", "bbbb2222"),
        ]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.find_all(&FindAllOptions::default()).unwrap();

        assert_eq!(result.len(), 2);
    }

    #[test]
    fn should_strip_trailers_from_body_when_body_is_exactly_the_trailer_block() {
        let trailers_raw = "Lore-id: aaaa1111\nDirective: keep simple";
        let git = MockGitClient::new();
        git.set_log_result(vec![raw_commit()
            .hash("aaa")
            .date("2025-01-15T10:00:00Z")
            .author("dev@example.com")
            .subject("feat: no body")
            .body(trailers_raw)
            .trailers(trailers_raw)
            .files(&[])
            .build()]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.find_all(&FindAllOptions::default()).unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].body, "");
    }

    #[test]
    fn should_pass_since_option_to_git_log() {
        let git = MockGitClient::new();
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        repo.find_all(&FindAllOptions {
            since: Some("2025-01-01".to_owned()),
            ..FindAllOptions::default()
        })
        .unwrap();

        let (args, _) = &git.log_calls()[0];
        assert!(args.contains(&"--since=2025-01-01".to_owned()));
    }

    #[test]
    fn should_pass_until_option_to_git_log() {
        let git = MockGitClient::new();
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        repo.find_all(&FindAllOptions {
            until: Some("2025-06-01".to_owned()),
            ..FindAllOptions::default()
        })
        .unwrap();

        let (args, _) = &git.log_calls()[0];
        assert!(args.contains(&"--until=2025-06-01".to_owned()));
    }

    #[test]
    fn should_pass_max_commits_option_to_git_log() {
        let git = MockGitClient::new();
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        repo.find_all(&FindAllOptions {
            max_commits: Some(10),
            ..FindAllOptions::default()
        })
        .unwrap();

        let (args, _) = &git.log_calls()[0];
        assert!(args.contains(&"--max-count=10".to_owned()));
    }

    #[test]
    fn should_not_pass_a_zero_max_commits_to_git_log() {
        let git = MockGitClient::new();
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        repo.find_all(&FindAllOptions {
            max_commits: Some(0),
            ..FindAllOptions::default()
        })
        .unwrap();

        let (args, _) = &git.log_calls()[0];
        assert!(args.is_empty());
    }

    #[test]
    fn should_return_empty_array_when_no_lore_commits_exist() {
        let git = MockGitClient::new();
        git.set_log_result(vec![non_lore_commit("abc", "chore: update deps")]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.find_all(&FindAllOptions::default()).unwrap();

        assert!(result.is_empty());
    }
}

// ---------------------------------------------------------------------------
// describe('findByScope')
// ---------------------------------------------------------------------------
mod find_by_scope {
    use super::*;

    #[test]
    fn should_find_atoms_matching_the_scope() {
        let git = MockGitClient::new();
        git.set_log_result(vec![
            make_lore_commit(LoreCommit {
                subject: "feat(auth): add login",
                lore_id: "aaaa1111".to_owned(),
                ..LoreCommit::default()
            }),
            make_lore_commit(LoreCommit {
                subject: "fix(database): fix query",
                lore_id: "bbbb2222".to_owned(),
                ..LoreCommit::default()
            }),
        ]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.find_by_scope("auth", &query_options()).unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].lore_id, "aaaa1111");
    }

    #[test]
    fn should_match_scope_case_insensitively() {
        let git = MockGitClient::new();
        git.set_log_result(vec![make_lore_commit(LoreCommit {
            subject: "feat(Auth): add login",
            lore_id: "aaaa1111".to_owned(),
            ..LoreCommit::default()
        })]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.find_by_scope("auth", &query_options()).unwrap();

        assert_eq!(result.len(), 1);
    }

    #[test]
    fn should_return_empty_array_when_no_scope_matches() {
        let git = MockGitClient::new();
        git.set_log_result(vec![make_lore_commit(LoreCommit {
            subject: "feat(auth): add login",
            lore_id: "aaaa1111".to_owned(),
            ..LoreCommit::default()
        })]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.find_by_scope("payments", &query_options()).unwrap();

        assert!(result.is_empty());
    }

    #[test]
    fn should_handle_commits_without_scope_in_subject() {
        let git = MockGitClient::new();
        git.set_log_result(vec![make_lore_commit(LoreCommit {
            subject: "fix: typo",
            lore_id: "aaaa1111".to_owned(),
            ..LoreCommit::default()
        })]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.find_by_scope("auth", &query_options()).unwrap();

        assert!(result.is_empty());
    }
}

// ---------------------------------------------------------------------------
// describe('resolveFollowLinks')
// ---------------------------------------------------------------------------
mod resolve_follow_links {
    use super::*;

    #[test]
    fn should_resolve_atoms_referenced_by_related_trailers() {
        let git = MockGitClient::new();
        git.set_log_result(vec![
            lore_commit_with_extras("aaa", "aaaa1111", "Related: bbbb2222"),
            lore_commit_with_hash("bbb", "bbbb2222"),
        ]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);
        let initial = vec![atom()
            .id("aaaa1111")
            .hash("aaa")
            .date("2025-01-15T10:00:00Z")
            .author("dev@example.com")
            .intent("feat(auth): add login")
            .files(&[])
            .related(&["bbbb2222"])
            .build()];

        let result = repo.resolve_follow_links(&initial, 2).unwrap();

        assert_eq!(result.len(), 2);
        let ids = ids(&result);
        assert!(ids.contains(&"aaaa1111"));
        assert!(ids.contains(&"bbbb2222"));
    }

    #[test]
    fn should_return_original_atoms_when_max_depth_is_0() {
        let git = MockGitClient::new();
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.resolve_follow_links(&[atom_a_related_b()], 0).unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].lore_id, "aaaa1111");
        assert_eq!(git.log_call_count(), 0);
    }

    #[test]
    fn should_return_original_atoms_when_no_follow_links_exist() {
        let git = MockGitClient::new();
        let repo = AtomRepository::new(&git, &PARSER, vec![]);
        let atoms = vec![atom()
            .id("aaaa1111")
            .hash("aaa")
            .author("dev@example.com")
            .intent("test")
            .files(&[])
            .build()];

        let result = repo.resolve_follow_links(&atoms, 3).unwrap();

        assert_eq!(result.len(), 1);
    }

    #[test]
    fn should_handle_circular_references_without_infinite_loop() {
        let git = MockGitClient::new();
        git.set_log_result(vec![
            lore_commit_with_extras("aaa", "aaaa1111", "Related: bbbb2222"),
            lore_commit_with_extras("bbb", "bbbb2222", "Related: aaaa1111"),
        ]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.resolve_follow_links(&[atom_a_related_b()], 5).unwrap();

        assert_eq!(result.len(), 2);
    }

    #[test]
    fn should_not_exceed_max_depth_in_transitive_resolution() {
        // Chain: A -> B -> C -> D, but max_depth = 1
        let git = MockGitClient::new();
        git.set_log_result(vec![
            lore_commit_with_extras("bbb", "bbbb2222", "Related: cccc3333"),
            lore_commit_with_extras("ccc", "cccc3333", "Related: dddd4444"),
            lore_commit_with_hash("ddd", "dddd4444"),
        ]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.resolve_follow_links(&[atom_a_related_b()], 1).unwrap();

        // A and B only (depth 1), not C or D
        assert_eq!(result.len(), 2);
        let ids = ids(&result);
        assert!(ids.contains(&"aaaa1111"));
        assert!(ids.contains(&"bbbb2222"));
    }

    #[test]
    fn should_return_empty_array_for_empty_input() {
        let git = MockGitClient::new();
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.resolve_follow_links(&[], 3).unwrap();

        assert!(result.is_empty());
    }

    /// Mirrors the TS `Map` insertion order: seed atoms first, then the
    /// resolved references in BFS discovery order.
    #[test]
    fn should_keep_seed_atoms_first_and_resolved_atoms_in_bfs_order() {
        let git = MockGitClient::new();
        git.set_log_result(vec![
            lore_commit_with_extras("ddd", "dddd4444", ""),
            lore_commit_with_extras("ccc", "cccc3333", "Related: dddd4444"),
            lore_commit_with_extras("aaa", "aaaa1111", ""),
        ]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);
        let seed = atom()
            .id("bbbb2222")
            .hash("bbb")
            .depends_on(&["aaaa1111"])
            .related(&["cccc3333"])
            .build();

        let result = repo.resolve_follow_links(&[seed], 3).unwrap();

        assert_eq!(
            ids(&result),
            vec!["bbbb2222", "aaaa1111", "cccc3333", "dddd4444"]
        );
    }

    #[test]
    fn should_propagate_git_errors_from_the_index_build() {
        let git = MockGitClient::new();
        git.set_log_error("boom");
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.resolve_follow_links(&[atom_a_related_b()], 3);

        assert!(matches!(result, Err(crate::util::LoreError::Git(_))));
    }
}

// ---------------------------------------------------------------------------
// describe('getLoreIdIndex')
// ---------------------------------------------------------------------------
mod lore_id_index {
    use super::*;

    #[test]
    fn should_index_atoms_by_lore_id_from_a_single_all_pass() {
        let git = MockGitClient::new();
        git.set_log_result(vec![
            lore_commit_with_extras("aaa", "aaaa1111", "Related: bbbb2222"),
            lore_commit_with_hash("bbb", "bbbb2222"),
        ]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let index = repo.lore_id_index().unwrap();

        assert_eq!(index.len(), 2);
        assert_eq!(
            index.get("aaaa1111").map(|a| a.commit_hash.as_str()),
            Some("aaa")
        );
        assert_eq!(git.log_call_count(), 1);
        let (args, _) = &git.log_calls()[0];
        assert!(args.contains(&"--all".to_owned()));
    }

    #[test]
    fn should_keep_the_newest_atom_when_a_lore_id_appears_twice() {
        let git = MockGitClient::new();
        git.set_log_result(vec![
            lore_commit_with_hash("newest", "aaaa1111"),
            lore_commit_with_hash("older", "aaaa1111"),
        ]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let index = repo.lore_id_index().unwrap();

        assert_eq!(index.len(), 1);
        assert_eq!(
            index.get("aaaa1111").map(|a| a.commit_hash.as_str()),
            Some("newest")
        );
    }

    #[test]
    fn should_build_the_index_once_per_repository_instance() {
        let git = MockGitClient::new();
        git.set_log_result(vec![lore_commit("aaaa1111")]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        repo.lore_id_index().unwrap();
        repo.lore_id_index().unwrap();

        assert_eq!(git.log_call_count(), 1);
    }

    /// Deliberate deviation from TS (which caches the rejected promise):
    /// a failed build is not cached, so the next call retries git.
    #[test]
    fn should_not_cache_a_failed_index_build() {
        let git = MockGitClient::new();
        git.set_log_error("boom");
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        assert!(repo.lore_id_index().is_err());

        git.set_log_result(vec![lore_commit("aaaa1111")]);
        let index = repo.lore_id_index().unwrap();

        assert_eq!(index.len(), 1);
        assert_eq!(git.log_call_count(), 2);
    }
}

// ---------------------------------------------------------------------------
// describe('resolveFollowLinks index usage')
// ---------------------------------------------------------------------------
mod resolve_follow_links_index_usage {
    use super::*;

    #[test]
    fn should_resolve_referenced_ids_with_a_single_all_pass() {
        let git = MockGitClient::new();
        git.set_log_result(vec![lore_commit_with_hash("bbb", "bbbb2222")]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.resolve_follow_links(&[atom_a_related_b()], 3).unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(git.log_call_count(), 1);
        let (args, _) = &git.log_calls()[0];
        assert!(args.contains(&"--all".to_owned()));
    }
}

// ---------------------------------------------------------------------------
// describe('git log format')
// ---------------------------------------------------------------------------
mod git_log_format {
    use super::*;

    #[test]
    fn should_pass_args_to_git_client_log_format_is_applied_by_git_client() {
        let git = MockGitClient::new();
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        repo.find_all(&FindAllOptions::default()).unwrap();

        // The format string is applied by GitClient::log, not the repository.
        let (args, _) = &git.log_calls()[0];
        assert!(args.iter().all(|a| !a.starts_with("--format")));
        assert!(args.iter().all(|a| !a.starts_with("--pretty")));
    }

    #[test]
    fn should_pass_pre_resolved_git_log_args_including_separator_to_git_client() {
        let git = MockGitClient::new();
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        repo.find_by_target(&git_log_args(), &query_options())
            .unwrap();

        let (args, _) = &git.log_calls()[0];
        assert!(args.contains(&"--".to_owned()));
        assert!(args.contains(&"src/auth.ts".to_owned()));
    }
}

// ---------------------------------------------------------------------------
// describe('bulk files')
// ---------------------------------------------------------------------------
mod bulk_files {
    use super::*;
    use crate::test_support::GitCall;

    fn files_changed_calls(git: &MockGitClient) -> usize {
        git.calls()
            .iter()
            .filter(|c| matches!(c, GitCall::FilesChanged(_)))
            .count()
    }

    #[test]
    fn should_take_changed_files_from_the_raw_commit_without_per_commit_git_calls() {
        let git = MockGitClient::new();
        git.set_log_result(vec![
            make_lore_commit(LoreCommit {
                lore_id: "aaaa1111".to_owned(),
                files_changed: vec!["src/auth.ts"],
                ..LoreCommit::default()
            }),
            non_lore_commit("non-lore", "chore: deps"),
        ]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo
            .find_by_target(&git_log_args(), &query_options())
            .unwrap();

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].files_changed, strings(&["src/auth.ts"]));
        assert_eq!(files_changed_calls(&git), 0);
    }

    #[test]
    fn should_handle_many_commits_without_per_commit_git_calls() {
        let git = MockGitClient::new();
        let commits: Vec<RawCommit> = (0..25)
            .map(|i| {
                raw_commit()
                    .hash(&format!("hash{i}"))
                    .date("2025-01-15T10:00:00Z")
                    .author("dev@example.com")
                    .subject("feat(auth): add login")
                    .body("Implemented login flow.")
                    .trailers(&format!("Lore-id: {i:08}"))
                    .files(&["src/auth.ts"])
                    .build()
            })
            .collect();
        git.set_log_result(commits);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo
            .find_by_target(&git_log_args(), &query_options())
            .unwrap();

        assert_eq!(result.len(), 25);
        assert_eq!(files_changed_calls(&git), 0);
    }
}

// ---------------------------------------------------------------------------
// describe('AtomRepository lore-only discovery (git-level pre-filter)')
// ---------------------------------------------------------------------------
mod lore_only_discovery {
    use super::*;

    #[test]
    fn asks_git_client_for_lore_commits_only_on_discovery_queries() {
        let git = MockGitClient::new();
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        repo.find_all(&FindAllOptions::default()).unwrap();
        repo.find_by_target(&git_log_args(), &query_options())
            .unwrap();
        repo.find_by_scope("auth", &query_options()).unwrap();
        repo.lore_id_index().unwrap();

        let calls = git.log_calls();
        assert_eq!(calls.len(), 4);
        for (_, options) in calls {
            assert_eq!(options, LogOptions { lore_only: true });
        }
    }

    #[test]
    fn does_not_pre_filter_single_commit_lookups_where_grep_would_walk_to_an_ancestor() {
        let git = MockGitClient::new();
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        repo.find_by_commit_hash("abc123").unwrap();
        repo.find_by_range("main..HEAD").unwrap();

        let calls = git.log_calls();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].0, strings(&["-1", "abc123"]));
        assert_eq!(calls[1].0, strings(&["main..HEAD"]));
        for (_, options) in calls {
            assert_eq!(options, LogOptions::default());
        }
    }

    #[test]
    fn find_by_lore_id_greps_a_trailer_line_and_tolerates_whitespace_after_the_colon() {
        let git = MockGitClient::new();
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        repo.find_by_lore_id("deadbeef").unwrap();

        let (args, options) = &git.log_calls()[0];
        assert!(args.contains(&"--all".to_owned()));
        assert!(args.contains(&"--extended-regexp".to_owned()));
        assert!(args.contains(&"--grep=^Lore-id:[[:space:]]*deadbeef".to_owned()));
        // Its own grep must not be OR-ed with the generic Lore-id grep
        assert_eq!(*options, LogOptions::default());
    }
}

// ---------------------------------------------------------------------------
// find_by_commit_hash / find_by_range result mapping (Rust-only coverage)
// ---------------------------------------------------------------------------
mod single_commit_lookups {
    use super::*;

    #[test]
    fn find_by_commit_hash_returns_the_first_parsed_atom() {
        let git = MockGitClient::new();
        git.set_log_result(vec![lore_commit_with_hash("abc123", "aaaa1111")]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.find_by_commit_hash("abc123").unwrap();

        assert_eq!(result.map(|a| a.commit_hash), Some("abc123".to_owned()));
    }

    #[test]
    fn find_by_commit_hash_returns_none_for_a_non_lore_commit() {
        let git = MockGitClient::new();
        git.set_log_result(vec![non_lore_commit("abc123", "chore: deps")]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        assert!(repo.find_by_commit_hash("abc123").unwrap().is_none());
    }

    #[test]
    fn find_by_range_returns_every_lore_atom_in_the_range() {
        let git = MockGitClient::new();
        git.set_log_result(vec![
            lore_commit_with_hash("aaa", "aaaa1111"),
            non_lore_commit("bbb", "chore: deps"),
            lore_commit_with_hash("ccc", "cccc3333"),
        ]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.find_by_range("main..HEAD").unwrap();

        assert_eq!(ids(&result), vec!["aaaa1111", "cccc3333"]);
    }
}

// ---------------------------------------------------------------------------
// parse_git_date / body stripping / custom trailer keys (Rust-only coverage)
// ---------------------------------------------------------------------------
mod atom_mapping {
    use super::*;

    #[test]
    fn parse_git_date_accepts_rfc_3339() {
        assert_eq!(
            AtomRepository::parse_git_date("2025-01-15T10:00:00+02:00"),
            date("2025-01-15T08:00:00Z")
        );
        assert_eq!(
            AtomRepository::parse_git_date("2025-01-15T10:00:00Z"),
            date("2025-01-15T10:00:00Z")
        );
    }

    #[test]
    fn parse_git_date_accepts_gits_default_log_format() {
        assert_eq!(
            AtomRepository::parse_git_date("Thu Oct 29 13:20:00 2026 +0100"),
            date("2026-10-29T12:20:00Z")
        );
        // Single-digit day as git prints it (no padding).
        assert_eq!(
            AtomRepository::parse_git_date("Thu Apr 7 15:13:13 2005 -0700"),
            date("2005-04-07T22:13:13Z")
        );
    }

    #[test]
    fn parse_git_date_falls_back_to_the_unix_epoch() {
        assert_eq!(
            AtomRepository::parse_git_date("not a date"),
            DateTime::<Utc>::UNIX_EPOCH
        );
        assert_eq!(
            AtomRepository::parse_git_date(""),
            DateTime::<Utc>::UNIX_EPOCH
        );
    }

    #[test]
    fn strips_a_trailer_block_that_follows_a_body_paragraph() {
        let git = MockGitClient::new();
        git.set_log_result(vec![raw_commit()
            .body("Implemented login flow.\n\nLore-id: a1b2c3d4\nConfidence: high")
            .trailers("Lore-id: a1b2c3d4\nConfidence: high")
            .build()]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.find_all(&FindAllOptions::default()).unwrap();

        assert_eq!(result[0].body, "Implemented login flow.");
    }

    #[test]
    fn leaves_the_body_alone_when_it_does_not_contain_the_trailer_line() {
        let git = MockGitClient::new();
        git.set_log_result(vec![raw_commit()
            .body("Just a body.")
            .trailers("Lore-id: a1b2c3d4")
            .build()]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.find_all(&FindAllOptions::default()).unwrap();

        assert_eq!(result[0].body, "Just a body.");
    }

    #[test]
    fn drops_commits_whose_lore_id_is_malformed() {
        let git = MockGitClient::new();
        git.set_log_result(vec![raw_commit().trailers("Lore-id: not-valid").build()]);
        let repo = AtomRepository::new(&git, &PARSER, vec![]);

        let result = repo.find_all(&FindAllOptions::default()).unwrap();

        assert!(result.is_empty());
    }

    #[test]
    fn forwards_custom_trailer_keys_to_the_parser() {
        let git = MockGitClient::new();
        git.set_log_result(vec![raw_commit()
            .trailers("Lore-id: a1b2c3d4\nTicket: JIRA-1\nOther: x")
            .build()]);
        let repo = AtomRepository::new(&git, &PARSER, vec!["Ticket".to_owned()]);

        let result = repo.find_all(&FindAllOptions::default()).unwrap();

        let custom = &result[0].trailers.custom;
        assert_eq!(custom.get("Ticket"), Some(&["JIRA-1".to_owned()][..]));
        assert!(!custom.has("Other"));
    }
}
