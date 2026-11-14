//! Port of `tests/unit/services/path-resolver.test.ts`.

use super::{BlameArgs, PathResolver};
use crate::types::query::TargetType;

fn resolver() -> PathResolver {
    PathResolver::new()
}

fn strs(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| v.to_string()).collect()
}

// ---- parse_target: line-range targets --------------------------------------

#[test]
fn should_parse_file_start_end_as_line_range() {
    let result = resolver().parse_target("src/utils.ts:45-80");
    assert_eq!(result.target_type, TargetType::LineRange);
    assert_eq!(result.file_path, "src/utils.ts");
    assert_eq!(result.line_start, Some(45));
    assert_eq!(result.line_end, Some(80));
    assert_eq!(result.raw, "src/utils.ts:45-80");
}

#[test]
fn should_parse_file_line_as_line_range_with_start_equal_end() {
    let result = resolver().parse_target("src/utils.ts:45");
    assert_eq!(result.target_type, TargetType::LineRange);
    assert_eq!(result.file_path, "src/utils.ts");
    assert_eq!(result.line_start, Some(45));
    assert_eq!(result.line_end, Some(45));
}

#[test]
fn should_handle_line_1() {
    let result = resolver().parse_target("file.ts:1");
    assert_eq!(result.target_type, TargetType::LineRange);
    assert_eq!(result.line_start, Some(1));
    assert_eq!(result.line_end, Some(1));
}

#[test]
fn should_handle_large_line_numbers() {
    let result = resolver().parse_target("file.ts:10000-20000");
    assert_eq!(result.target_type, TargetType::LineRange);
    assert_eq!(result.line_start, Some(10000));
    assert_eq!(result.line_end, Some(20000));
}

#[test]
fn should_parse_deeply_nested_file_with_line_range() {
    let result = resolver().parse_target("src/services/db/connection.ts:10-20");
    assert_eq!(result.target_type, TargetType::LineRange);
    assert_eq!(result.file_path, "src/services/db/connection.ts");
    assert_eq!(result.line_start, Some(10));
    assert_eq!(result.line_end, Some(20));
}

// ---- parse_target: directory targets ---------------------------------------

#[test]
fn should_classify_trailing_slash_as_directory() {
    let result = resolver().parse_target("src/");
    assert_eq!(result.target_type, TargetType::Directory);
    assert_eq!(result.file_path, "src/");
    assert_eq!(result.line_start, None);
    assert_eq!(result.line_end, None);
}

#[test]
fn should_classify_nested_path_with_trailing_slash_as_directory() {
    let result = resolver().parse_target("src/services/db/");
    assert_eq!(result.target_type, TargetType::Directory);
    assert_eq!(result.file_path, "src/services/db/");
}

#[test]
fn should_classify_root_relative_directory() {
    let result = resolver().parse_target("./src/");
    assert_eq!(result.target_type, TargetType::Directory);
}

// ---- parse_target: glob targets --------------------------------------------

#[test]
fn should_classify_patterns_with_star_as_glob() {
    let result = resolver().parse_target("**/*.ts");
    assert_eq!(result.target_type, TargetType::Glob);
    assert_eq!(result.file_path, "**/*.ts");
    assert_eq!(result.line_start, None);
    assert_eq!(result.line_end, None);
}

#[test]
fn should_classify_patterns_with_question_mark_as_glob() {
    let result = resolver().parse_target("src/file?.ts");
    assert_eq!(result.target_type, TargetType::Glob);
    assert_eq!(result.file_path, "src/file?.ts");
}

#[test]
fn should_classify_star_js_as_glob() {
    let result = resolver().parse_target("*.js");
    assert_eq!(result.target_type, TargetType::Glob);
}

#[test]
fn should_classify_src_double_star_test_ts_as_glob() {
    let result = resolver().parse_target("src/**/*.test.ts");
    assert_eq!(result.target_type, TargetType::Glob);
}

// ---- parse_target: file targets --------------------------------------------

#[test]
fn should_classify_a_plain_file_path_as_file() {
    let result = resolver().parse_target("src/main.ts");
    assert_eq!(result.target_type, TargetType::File);
    assert_eq!(result.file_path, "src/main.ts");
    assert_eq!(result.line_start, None);
    assert_eq!(result.line_end, None);
}

#[test]
fn should_classify_a_file_without_extension_as_file() {
    let result = resolver().parse_target("Makefile");
    assert_eq!(result.target_type, TargetType::File);
    assert_eq!(result.file_path, "Makefile");
}

#[test]
fn should_classify_a_dotfile_as_file() {
    let result = resolver().parse_target(".gitignore");
    assert_eq!(result.target_type, TargetType::File);
}

#[test]
fn should_classify_a_deeply_nested_file_as_file() {
    let result = resolver().parse_target("src/services/db/connection.ts");
    assert_eq!(result.target_type, TargetType::File);
}

#[test]
fn should_classify_a_file_with_spaces_as_file() {
    let result = resolver().parse_target("my file.ts");
    assert_eq!(result.target_type, TargetType::File);
}

#[test]
fn should_classify_a_relative_path_as_file() {
    let result = resolver().parse_target("./src/main.ts");
    assert_eq!(result.target_type, TargetType::File);
}

// ---- parse_target: raw field -----------------------------------------------

#[test]
fn should_always_preserve_the_original_raw_input() {
    let inputs = [
        "src/main.ts",
        "src/main.ts:42",
        "src/main.ts:10-20",
        "src/",
        "**/*.ts",
    ];
    for input in inputs {
        assert_eq!(resolver().parse_target(input).raw, input);
    }
}

// ---- to_git_log_args --------------------------------------------------------

#[test]
fn should_produce_dashdash_file_path_for_file_targets() {
    let r = resolver();
    let target = r.parse_target("src/main.ts");
    let args = r.to_git_log_args(&target);
    assert_eq!(args, strs(&["--", "src/main.ts"]));
}

#[test]
fn should_produce_dashdash_file_path_for_directory_targets() {
    let r = resolver();
    let target = r.parse_target("src/services/");
    let args = r.to_git_log_args(&target);
    assert_eq!(args, strs(&["--", "src/services/"]));
}

#[test]
fn should_produce_dashdash_file_path_for_glob_targets() {
    let r = resolver();
    let target = r.parse_target("**/*.ts");
    let args = r.to_git_log_args(&target);
    assert_eq!(args, strs(&["--", "**/*.ts"]));
}

#[test]
fn should_produce_l_start_end_file_for_line_range_targets() {
    let r = resolver();
    let target = r.parse_target("src/main.ts:10-20");
    let args = r.to_git_log_args(&target);
    assert_eq!(args, strs(&["-L", "10,20:src/main.ts"]));
}

#[test]
fn should_produce_l_line_line_file_for_single_line_targets() {
    let r = resolver();
    let target = r.parse_target("src/main.ts:42");
    let args = r.to_git_log_args(&target);
    assert_eq!(args, strs(&["-L", "42,42:src/main.ts"]));
}

// ---- to_git_blame_args ------------------------------------------------------

#[test]
fn should_return_file_line_start_line_end_for_line_range_targets() {
    let r = resolver();
    let target = r.parse_target("src/main.ts:10-20");
    let args = r.to_git_blame_args(&target);
    assert_eq!(
        args,
        BlameArgs {
            file: "src/main.ts".to_owned(),
            line_start: 10,
            line_end: Some(20),
        }
    );
}

#[test]
fn should_return_file_line_line_for_single_line_targets() {
    let r = resolver();
    let target = r.parse_target("src/main.ts:42");
    let args = r.to_git_blame_args(&target);
    assert_eq!(
        args,
        BlameArgs {
            file: "src/main.ts".to_owned(),
            line_start: 42,
            line_end: Some(42),
        }
    );
}

#[test]
fn should_return_file_with_line_start_1_and_line_end_none_for_file_targets() {
    let r = resolver();
    let target = r.parse_target("src/main.ts");
    let args = r.to_git_blame_args(&target);
    assert_eq!(
        args,
        BlameArgs {
            file: "src/main.ts".to_owned(),
            line_start: 1,
            line_end: None,
        }
    );
}

#[test]
fn should_return_file_with_line_start_1_and_line_end_none_for_directory_targets() {
    let r = resolver();
    let target = r.parse_target("src/");
    let args = r.to_git_blame_args(&target);
    assert_eq!(
        args,
        BlameArgs {
            file: "src/".to_owned(),
            line_start: 1,
            line_end: None,
        }
    );
}

#[test]
fn should_return_file_with_line_start_1_and_line_end_none_for_glob_targets() {
    let r = resolver();
    let target = r.parse_target("**/*.ts");
    let args = r.to_git_blame_args(&target);
    assert_eq!(
        args,
        BlameArgs {
            file: "**/*.ts".to_owned(),
            line_start: 1,
            line_end: None,
        }
    );
}
