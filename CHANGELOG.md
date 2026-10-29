# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-10-29

### Added

- **`lore hooks install` / `lore hooks uninstall`**: commit-msg hook that validates each commit via `lore validate --commit-msg-file`, with a `[hooks]` config section (`enforce`, `allow_fixup`, `skip_authors`, `skip_patterns`), a pre-commit framework hook definition, and an advisory GitHub Actions workflow. ([#41](https://github.com/Ian-stetsenko/lore-protocol/issues/41), [#52](https://github.com/Ian-stetsenko/lore-protocol/pull/52))
- **Lore-id in `lore commit` output**: text output shows `| Lore-id: <id>` and JSON output includes `loreId`, so agents can reference the new atom without a follow-up query. ([#59](https://github.com/Ian-stetsenko/lore-protocol/pull/59)) — thanks @c-ferrier
- **`lore init` drift detection**: re-running init on an existing project reports missing options, lists customized keys, and gives recovery hints for corrupted TOML. ([#56](https://github.com/Ian-stetsenko/lore-protocol/pull/56)) — thanks @c-ferrier

### Performance

- **Bulk file collection**: changed files are collected in one extra `git log --name-only` pass instead of one `git diff-tree` spawn per Lore commit. `lore log --json` on an 840-atom repository went from 36s to 0.7s on Windows. Root commits now report their files; `--full-diff` keeps the complete file list on path-scoped queries. ([#65](https://github.com/Ian-stetsenko/lore-protocol/issues/65), [#66](https://github.com/Ian-stetsenko/lore-protocol/pull/66)) — thanks @TommyC81
- **Shared Lore-id index**: `lore trace`, follow-link resolution and reference validation resolve ids against one lazily built index (a single `git log --all` pass) instead of one full-history grep per reference. A full-depth trace went from 148s to 0.86s. ([#67](https://github.com/Ian-stetsenko/lore-protocol/pull/67)) — thanks @TommyC81
- **Git-level Lore-id pre-filter**: discovery queries (`log`, path commands, `search`, `trace` index) pass a `--grep` for the `Lore-id` trailer line, so git skips non-Lore history natively. Lore's work now scales with the number of atoms rather than total commits; a 1.4M-commit repository that previously crashed scans in seconds. The trailer parser remains authoritative. ([#55](https://github.com/Ian-stetsenko/lore-protocol/pull/55)) — thanks @c-ferrier

### Fixed

- **Windows test suite**: two tests hard-coded `/tmp`; the suite is now green on Windows.
- **`lore stale` from a subdirectory**: drift was silently reported as zero when run from a nested directory because repository-relative paths were resolved against the current directory. Paths are now anchored at the repository root via the `:(top)` pathspec. ([#60](https://github.com/Ian-stetsenko/lore-protocol/issues/60), diagnosed in [#61](https://github.com/Ian-stetsenko/lore-protocol/pull/61)) — thanks @c-ferrier

### Maintenance

- npm publishing is gated to the project owner via the publish workflow and an `npm-publish` environment; maintainers listed in CODEOWNERS can review and merge.

## [0.5.0] - 2026-05-11

### Added

- **Update notifier**: Non-blocking check for new versions on subsequent runs. Suppressed automatically in CI, non-TTY, JSON output, or via `--no-update-notifier` / `LORE_NO_UPDATE_CHECK` env var. ([#42](https://github.com/Ian-stetsenko/lore-protocol/issues/42)) — thanks @c-ferrier
- **`shouldCheckForUpdate` utility**: Extracted to `src/util/update-check.ts` to avoid side-effect-on-import from `main.ts`.

### Fixed

- **`--no-edit` silently discards input**: When `--amend --no-edit` was combined with any input flags or piped JSON, the input was silently ignored. Now detects conflicting input via exclusion-based check and throws an actionable error. ([#48](https://github.com/Ian-stetsenko/lore-protocol/issues/48)) — thanks @c-ferrier
- **Duplicate trailers in body display**: Fixed `stripTrailersFromBody` for commits with no narrative body paragraph — trailers no longer appear twice in text output. ([#43](https://github.com/Ian-stetsenko/lore-protocol/issues/43)) — thanks @c-ferrier

## [0.4.0] - 2026-04-30

### Added

- **`lore commit --amend`**: Amend the last commit while preserving the existing Lore-id, keeping knowledge-graph references (Related, Supersedes, Depends-on) valid. ([#39](https://github.com/Ian-stetsenko/lore-protocol/issues/39))
- **`lore commit --amend --no-edit`**: Add staged files to the last commit without changing the message or trailers — passes through directly to git.
- **`HeadLoreIdReader` service**: Reads the Lore-id from HEAD's commit message for reuse during amend.
- **Command-level tests for amend**: 8 tests covering all amend code paths including Lore-id preservation, --no-edit passthrough, validation, and edge cases.

### Fixed

- **`--no-edit` Commander.js registration**: Fixed option registration to use `.option('--no-edit')` (Commander's boolean negation pattern) instead of `.option('--edit', ..., true)` which didn't recognize `--no-edit` from the CLI.

## [0.3.0] - 2026-04-26

### Fixed

- **`--version` flag stuck on old version**: Now reads dynamically from `package.json` via `createRequire` instead of a hardcoded string. Added smoke test to prevent regression. ([#27](https://github.com/Ian-stetsenko/lore-protocol/issues/27))
- **`--limit` semantics and query pipeline**: Hardened query pipeline edge cases for limit handling. ([#24](https://github.com/Ian-stetsenko/lore-protocol/issues/24), [#26](https://github.com/Ian-stetsenko/lore-protocol/issues/26))

### Added

- **CI/CD**: GitHub Actions for CI (typecheck + tests) and npm publish workflow with OIDC trusted publishing.

## [0.2.0] - 2026-04-25

### Fixed

- **Custom trailers in JSON input**: Custom trailers (e.g., `Assisted-by`, `Ticket`) passed in JSON input to `lore commit` were silently stripped. Now collected and persisted in the commit message. ([#20](https://github.com/Ian-stetsenko/lore-protocol/issues/20))
- **Validation error detail in text mode**: `ValidationError` now shows each specific issue (e.g., "Required trailer 'Assisted-by' is missing") instead of a generic "Commit input validation failed" message.
- **`hasTrailer` for custom trailers**: Required trailer validation now correctly recognizes custom trailers as present.

### Added

- **`CustomTrailerCollection` value object**: Encapsulates all custom trailer logic — extraction from JSON, presence detection, line counting, iteration, and serialization. Replaces scattered `Map` handling across `CommitBuilder` and `JsonInputReader`.
- **`lore coverage`**: Alias for `lore tested`, matching the paper's CLI interface (Figure 2).
- **Agent skill files**: Drop-in instruction files for Claude Code, Cursor, GitHub Copilot, Windsurf, and Aider. Teach AI agents to query Lore before modifying code and write Lore-enriched commits.
- **String-to-array coercion**: JSON input now accepts `"Directive": "value"` (string) in addition to `"Directive": ["value"]` (array) for array trailers.

### Changed

- **`CommitInput.trailers.custom`** type changed from `Record<string, readonly string[]>` to `CustomTrailerCollection`.
- **`LoreTrailers.custom`** type changed from `ReadonlyMap<string, readonly string[]>` to `CustomTrailerCollection`.

## [0.1.0] - 2026-03-20

Initial release implementing the Lore protocol ([arXiv:2603.15566](https://arxiv.org/abs/2603.15566)).

### Added

- **Core protocol**: 12 trailer types (Lore-id, Constraint, Rejected, Confidence, Scope-risk, Reversibility, Directive, Tested, Not-tested, Supersedes, Depends-on, Related) with parsing and serialization.
- **`lore init`**: Initialize `.lore/config.toml` with default configuration.
- **`lore commit`**: Create Lore-enriched commits via interactive mode (`-i`), CLI flags, JSON file (`--file`), or JSON on stdin.
- **Path-based queries**: `lore context`, `lore constraints`, `lore rejected`, `lore directives`, `lore tested` -- query decision context for files and directories.
- **`lore why`**: Line-level blame integration showing Lore context for specific lines (`file:line` or `file:line-line`).
- **`lore search`**: Cross-cutting search with filters (confidence, scope-risk, reversibility, author, text, trailer presence).
- **`lore log`**: Lore-enriched git log showing all annotated commits.
- **`lore stale`**: Staleness detection based on age, file drift, and confidence level.
- **`lore trace`**: Decision chain traversal via Supersedes, Depends-on, and Related references.
- **`lore validate`**: Protocol compliance validation for commit ranges with strict mode.
- **`lore squash`**: Merge Lore atoms from a revision range for squash merge workflows.
- **`lore doctor`**: Repository health checks (config validity, Lore-id uniqueness, reference integrity).
- **Supersession resolution**: Automatic filtering of superseded atoms in query results.
- **Dual output formats**: Human-readable text (with color) and structured JSON for AI agents.
- **Custom trailers**: Extend the vocabulary via `config.toml` without code changes.
- **Configurable validation**: Required trailers, strict mode, message length limits.

[0.5.0]: https://github.com/Ian-stetsenko/lore-protocol/releases/tag/v0.5.0
[0.4.0]: https://github.com/Ian-stetsenko/lore-protocol/releases/tag/v0.4.0
[0.3.0]: https://github.com/Ian-stetsenko/lore-protocol/releases/tag/v0.3.0
[0.2.0]: https://github.com/Ian-stetsenko/lore-protocol/releases/tag/v0.2.0
[0.1.0]: https://github.com/Ian-stetsenko/lore-protocol/releases/tag/v0.1.0
