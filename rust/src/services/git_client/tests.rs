use super::*;

const HASH_A: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const HASH_B: &str = "b2c3d4e5f60718293a4b5c6d7e8f9012345678a1";
const HASH_C: &str = "c3d4e5f60718293a4b5c6d7e8f9012345678a1b2";

mod parse_log_output {
    use super::*;

    fn record(hash: &str, subject: &str, body: &str, trailers: &str) -> String {
        format!(
            "{hash}\x1F2025-01-15T10:00:00+00:00\x1Falice@example.com\x1F{subject}\x1F{body}\x1F{trailers}\x1E"
        )
    }

    #[test]
    fn returns_empty_for_blank_output() {
        assert!(ProcessGitClient::parse_log_output("").is_empty());
        assert!(ProcessGitClient::parse_log_output("  \n").is_empty());
    }

    #[test]
    fn parses_a_single_formatted_record() {
        let out = record(
            HASH_A,
            "feat(auth): add login flow",
            "Longer explanation.\n",
            "Lore-id: a1b2c3d4\nConfidence: high\n",
        );
        let commits = ProcessGitClient::parse_log_output(&out);

        assert_eq!(commits.len(), 1);
        let c = &commits[0];
        assert_eq!(c.hash, HASH_A);
        assert_eq!(c.date, "2025-01-15T10:00:00+00:00");
        assert_eq!(c.author, "alice@example.com");
        assert_eq!(c.subject, "feat(auth): add login flow");
        assert_eq!(c.body, "Longer explanation.");
        assert_eq!(c.trailers, "Lore-id: a1b2c3d4\nConfidence: high");
        assert!(c.files_changed.is_empty());
    }

    #[test]
    fn parses_multiple_records_separated_by_newlines() {
        let out = format!(
            "{}\n{}\n",
            record(HASH_A, "first", "", "Lore-id: aaaa1111"),
            record(HASH_B, "second", "body", "")
        );
        let commits = ProcessGitClient::parse_log_output(&out);

        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].hash, HASH_A);
        assert_eq!(commits[0].trailers, "Lore-id: aaaa1111");
        assert_eq!(commits[1].hash, HASH_B);
        assert_eq!(commits[1].body, "body");
        assert_eq!(commits[1].trailers, "");
    }

    #[test]
    fn skips_records_with_too_few_fields() {
        let out = format!(
            "{HASH_A}\x1Fonly\x1Ftwo\x1E{}",
            record(HASH_B, "ok", "", "")
        );
        let commits = ProcessGitClient::parse_log_output(&out);

        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].hash, HASH_B);
    }
}

mod parse_l_flag_output {
    use super::*;

    fn sample() -> String {
        format!(
            "commit {HASH_A}\n\
             Author: Alice Example <alice@example.com>\n\
             Date:   Wed Jan 15 10:00:00 2025 +0000\n\
             \n\
             \x20   feat(auth): add login flow\n\
             \n\
             \x20   Explains why the change was made.\n\
             \x20   Second line of the body.\n\
             \n\
             \x20   Lore-id: a1b2c3d4\n\
             \x20   Confidence: high\n\
             \n\
             diff --git a/src/auth.ts b/src/auth.ts\n\
             --- a/src/auth.ts\n\
             +++ b/src/auth.ts\n\
             @@ -1,3 +1,4 @@\n\
             +export const x = 1;\n\
             \n\
             commit {HASH_B}\n\
             Author: Bob <bob@example.com>\n\
             Date:   Tue Jan 14 09:00:00 2025 +0000\n\
             \n\
             \x20   chore: no trailers here\n\
             \n\
             \x20   Just a body paragraph.\n\
             \n\
             diff --git a/src/auth.ts b/src/auth.ts\n\
             --- a/src/auth.ts\n\
             +++ b/src/auth.ts\n\
             @@ -1,2 +1,3 @@\n\
             +const y = 2;\n"
        )
    }

    #[test]
    fn returns_empty_for_blank_output() {
        assert!(ProcessGitClient::parse_l_flag_output("").is_empty());
    }

    #[test]
    fn splits_blocks_on_commit_lines_and_extracts_header_fields() {
        let commits = ProcessGitClient::parse_l_flag_output(&sample());

        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].hash, HASH_A);
        assert_eq!(commits[0].author, "alice@example.com");
        assert_eq!(commits[0].date, "Wed Jan 15 10:00:00 2025 +0000");
        assert_eq!(commits[1].hash, HASH_B);
        assert_eq!(commits[1].author, "bob@example.com");
    }

    #[test]
    fn dedents_the_message_and_separates_subject_body_and_trailers() {
        let commits = ProcessGitClient::parse_l_flag_output(&sample());

        let first = &commits[0];
        assert_eq!(first.subject, "feat(auth): add login flow");
        assert_eq!(
            first.body,
            "Explains why the change was made.\nSecond line of the body."
        );
        assert_eq!(first.trailers, "Lore-id: a1b2c3d4\nConfidence: high");
        assert!(first.files_changed.is_empty());
    }

    #[test]
    fn treats_last_paragraph_as_body_when_it_has_no_trailer_line() {
        let commits = ProcessGitClient::parse_l_flag_output(&sample());

        let second = &commits[1];
        assert_eq!(second.subject, "chore: no trailers here");
        assert_eq!(second.body, "Just a body paragraph.");
        assert_eq!(second.trailers, "");
    }

    #[test]
    fn handles_subject_only_messages() {
        let out = format!(
            "commit {HASH_C}\nAuthor: Carol <carol@example.com>\nDate:   Mon Jan 13 08:00:00 2025 +0000\n\n    fix: subject only\n\ndiff --git a/f b/f\n"
        );
        let commits = ProcessGitClient::parse_l_flag_output(&out);

        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].subject, "fix: subject only");
        assert_eq!(commits[0].body, "");
        assert_eq!(commits[0].trailers, "");
    }

    #[test]
    fn ignores_leading_noise_before_the_first_commit_block() {
        let out = format!("warning: something\n{}", sample());
        let commits = ProcessGitClient::parse_l_flag_output(&out);

        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].hash, HASH_A);
    }
}

mod parse_blame_output {
    use super::*;

    fn sample() -> String {
        format!(
            "{HASH_A} 1 1 2\n\
             author Alice Example\n\
             author-mail <alice@example.com>\n\
             author-time 1736935200\n\
             author-tz +0000\n\
             committer Alice Example\n\
             committer-mail <alice@example.com>\n\
             committer-time 1736935200\n\
             committer-tz +0000\n\
             summary feat(auth): add login flow\n\
             filename src/auth.ts\n\
             \texport function login() {{\n\
             {HASH_A} 2 2\n\
             \t  return true;\n\
             {HASH_B} 7 3 1\n\
             author Bob\n\
             author-mail <bob@example.com>\n\
             summary chore: tidy\n\
             previous {HASH_A} src/auth.ts\n\
             filename src/auth.ts\n\
             \t}}\n"
        )
    }

    #[test]
    fn returns_empty_for_blank_output() {
        assert!(ProcessGitClient::parse_blame_output("").is_empty());
        assert!(ProcessGitClient::parse_blame_output("\n\n").is_empty());
    }

    #[test]
    fn pairs_each_header_with_its_tab_prefixed_content_line() {
        let lines = ProcessGitClient::parse_blame_output(&sample());

        assert_eq!(
            lines,
            vec![
                BlameLine {
                    commit_hash: HASH_A.to_owned(),
                    line_number: 1,
                    content: "export function login() {".to_owned(),
                },
                BlameLine {
                    commit_hash: HASH_A.to_owned(),
                    line_number: 2,
                    content: "  return true;".to_owned(),
                },
                BlameLine {
                    commit_hash: HASH_B.to_owned(),
                    line_number: 3,
                    content: "}".to_owned(),
                },
            ]
        );
    }

    #[test]
    fn uses_the_final_line_number_not_the_original_one() {
        let out = format!("{HASH_C} 40 12 1\nfilename f\n\tx\n");
        let lines = ProcessGitClient::parse_blame_output(&out);

        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].line_number, 12);
    }

    #[test]
    fn ignores_content_lines_without_a_preceding_header() {
        let out = "\torphan line\nauthor Nobody\n";
        assert!(ProcessGitClient::parse_blame_output(out).is_empty());
    }
}

mod parse_files_changed_output {
    use super::*;

    #[test]
    fn returns_empty_map_for_blank_output() {
        assert!(ProcessGitClient::parse_files_changed_output("").is_empty());
        assert!(ProcessGitClient::parse_files_changed_output(" \n").is_empty());
    }

    #[test]
    fn maps_each_hash_to_its_file_list() {
        let out =
            format!("\x1E{HASH_A}\n\nsrc/auth.ts\nsrc/index.ts\n\n\x1E{HASH_B}\n\nREADME.md\n");
        let map = ProcessGitClient::parse_files_changed_output(&out);

        assert_eq!(map.len(), 2);
        assert_eq!(
            map[HASH_A],
            vec!["src/auth.ts".to_owned(), "src/index.ts".to_owned()]
        );
        assert_eq!(map[HASH_B], vec!["README.md".to_owned()]);
    }

    #[test]
    fn records_merge_commits_with_no_diff_as_empty_lists() {
        let out = format!("\x1E{HASH_A}\n\x1E{HASH_B}\n\nsrc/a.ts\n");
        let map = ProcessGitClient::parse_files_changed_output(&out);

        assert_eq!(map[HASH_A], Vec::<String>::new());
        assert_eq!(map[HASH_B], vec!["src/a.ts".to_owned()]);
    }

    #[test]
    fn drops_blank_lines_between_file_names() {
        let out = format!("\x1E{HASH_C}\n\na.ts\n\nb.ts\n\n\n");
        let map = ProcessGitClient::parse_files_changed_output(&out);

        assert_eq!(map[HASH_C], vec!["a.ts".to_owned(), "b.ts".to_owned()]);
    }
}

mod commit_hash_extraction {
    use super::*;

    #[test]
    fn extracts_the_short_hash_from_git_commit_output() {
        let caps = COMMIT_HASH_PATTERN
            .captures("[main abc1234] feat: thing\n 1 file changed")
            .unwrap();
        assert_eq!(&caps[1], "abc1234");

        let caps = COMMIT_HASH_PATTERN
            .captures("[feature/my-branch (root-commit) 0123abc] init")
            .map(|c| c[1].to_owned());
        // "(root-commit)" breaks the `[\w/-]+\s+hash]` shape, as in TS.
        assert_eq!(caps, None);

        let caps = COMMIT_HASH_PATTERN
            .captures("[rust/port-c deadbee] msg")
            .unwrap();
        assert_eq!(&caps[1], "deadbee");
    }
}

mod log_args {
    use super::*;

    #[test]
    fn lore_only_args_are_a_single_extended_regexp_grep() {
        assert_eq!(LORE_ONLY_ARGS[0], "--extended-regexp");
        assert!(LORE_ONLY_ARGS[1].starts_with("--grep=^Lore-id:"));
    }

    #[test]
    fn log_format_uses_hex_escaped_separators() {
        assert!(LOG_FORMAT.contains("%x1F"));
        assert!(LOG_FORMAT.ends_with("%x1E"));
        assert_eq!(LOG_FORMAT.matches("%x1F").count(), 5);
    }
}
