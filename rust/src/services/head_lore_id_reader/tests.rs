//! Ported case-for-case from `tests/unit/services/head-lore-id-reader.test.ts`.

use super::*;
use crate::test_support::MockGitClient;
use crate::util::LoreError;

const PARSER: TrailerParser = TrailerParser;

fn git_with_head(message: &str) -> MockGitClient {
    let git = MockGitClient::new();
    git.set_head_message_result(message);
    git
}

#[test]
fn should_return_lore_id_when_head_has_lore_trailers() {
    let message = [
        "feat: add login flow",
        "",
        "Lore-id: a1b2c3d4",
        "Confidence: high",
    ]
    .join("\n");
    let git = git_with_head(&message);
    let reader = HeadLoreIdReader::new(&git, &PARSER);

    let result = reader.read();

    assert_eq!(result, Some("a1b2c3d4".to_owned()));
}

#[test]
fn should_return_null_when_head_has_no_trailers() {
    let git = git_with_head("feat: simple commit with no trailers");
    let reader = HeadLoreIdReader::new(&git, &PARSER);

    let result = reader.read();

    assert_eq!(result, None);
}

#[test]
fn should_return_null_when_head_has_trailers_but_no_lore_id() {
    let message = [
        "feat: add feature",
        "",
        "Signed-off-by: Someone <someone@example.com>",
    ]
    .join("\n");
    let git = git_with_head(&message);
    let reader = HeadLoreIdReader::new(&git, &PARSER);

    let result = reader.read();

    assert_eq!(result, None);
}

#[test]
fn should_handle_empty_commit_message() {
    let git = git_with_head("");
    let reader = HeadLoreIdReader::new(&git, &PARSER);

    let result = reader.read();

    assert_eq!(result, None);
}

#[test]
fn should_return_lore_id_from_a_full_commit_message_with_body() {
    let message = [
        "feat: add authentication module",
        "",
        "This implements OAuth2 flow with PKCE.",
        "Includes refresh token rotation.",
        "",
        "Lore-id: deadbeef",
        "Constraint: Must use HTTPS",
        "Confidence: medium",
        "Scope-risk: moderate",
    ]
    .join("\n");
    let git = git_with_head(&message);
    let reader = HeadLoreIdReader::new(&git, &PARSER);

    let result = reader.read();

    assert_eq!(result, Some("deadbeef".to_owned()));
}

#[test]
fn should_return_null_when_get_head_message_throws_empty_repo() {
    let git = MockGitClient::new();
    git.set_head_message(|| Err(LoreError::git("fatal: bad default revision")));
    let reader = HeadLoreIdReader::new(&git, &PARSER);

    let result = reader.read();

    assert_eq!(result, None);
}

#[test]
fn should_return_null_when_lore_id_is_not_valid_hex_format() {
    let message = [
        "feat: broken lore-id",
        "",
        "Lore-id: not-valid",
        "Confidence: high",
    ]
    .join("\n");
    let git = git_with_head(&message);
    let reader = HeadLoreIdReader::new(&git, &PARSER);

    let result = reader.read();

    assert_eq!(result, None);
}
