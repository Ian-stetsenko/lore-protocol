# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0] - 2026-11-09

### Added

- **`lore commit` reference validation**: `Supersedes`/`Depends-on`/`Related` Lore-ids are now resolved against repository history (the shared all-refs Lore-id index, HEAD-preferred) before the commit is created. An id that resolves on no ref fails the commit with exit 1 and nothing committed; format errors and unresolvable ids are reported together in one batched error, with near-match suggestions (Hamming distance <= 2) and hints for pasted git hashes or upper-case ids. `--no-verify-refs` skips the check for the rare legitimate case (an atom that exists only on an unfetched branch). The gate is best-effort: if the index cannot be built, validation is skipped with a warning so "could not check" stays distinguishable from "check failed". ([#78](https://github.com/Ian-stetsenko/lore-protocol/issues/78), [#79](https://github.com/Ian-stetsenko/lore-protocol/pull/79)) — thanks @TommyC81

### Changed

- **`lore doctor` reference check split by severity**: dangling `Supersedes`/`Depends-on` references report under `Reference resolution (supersedes/depends-on)` at warning status (always present, ok message unchanged), while dangling `Related` references report under `Reference resolution (related)` at info status, emitted only when there are findings. Reference ids now resolve through the shared all-refs Lore-id index, so references to atoms living only on a side branch no longer false-dangle and `doctor` agrees with `lore trace`. An index that cannot be built yields one `Reference resolution (skipped)` warning and the remaining checks still run. JSON consumers keying on the old `Reference resolution` check name need to update. ([#80](https://github.com/Ian-stetsenko/lore-protocol/issues/80), [#81](https://github.com/Ian-stetsenko/lore-protocol/pull/81)) — thanks @TommyC81
- **`lore doctor` dependency check resolves supersession chains**: the check is renamed from `Orphaned dependencies` to `Superseded dependencies` and now follows `Depends-on` targets through supersession chains before flagging. A dependency whose chain reaches a live atom is silent (the supersede carries the decision forward, including dependencies on it); only dead-end chains (cycles, self-supersession) keep the info finding. `lore stale` and its `orphaned-dep` signal are unchanged. The README trailer table now states the carries-forward rule. ([#82](https://github.com/Ian-stetsenko/lore-protocol/issues/82), [#83](https://github.com/Ian-stetsenko/lore-protocol/pull/83)) — thanks @TommyC81

### Removed

- **`lore validate --since <ref>`**: the alias deprecated in 0.7.0 is gone; `lore validate --since` is now rejected as an unknown option. Use `--from <ref>` (or a positional range). `--since` keeps its date meaning on every other command. ([#69](https://github.com/Ian-stetsenko/lore-protocol/issues/69))

## [0.7.1] - 2026-11-03

### Performance

- **Lore-id index build**: the shared index now walks the pinned HEAD commit once and runs `git log --all --not <head>` for the delta, instead of re-walking and re-parsing all of HEAD's history in the `--all` pass. Falls back to a plain `--all` walk on an unborn HEAD or a failed first pass, so coverage never shrinks. Semantics are unchanged: HEAD-reachable atoms still win a shared Lore-id. ([#75](https://github.com/Ian-stetsenko/lore-protocol/pull/75)) — thanks @TommyC81
- **Scope queries pushed down to git**: `lore` scope lookups add a case-insensitive `--grep` for `(scope)` ANDed with the Lore-id pre-filter via `--all-match`, so git skips commits that never mention the scope. The exact conventional-commit scope filter stays authoritative. Completes the scope half of the filter pushdown from #55. ([#76](https://github.com/Ian-stetsenko/lore-protocol/pull/76)) — thanks @TommyC81

### Fixed

- **Lore-id index retry after a failed build**: a rejected index build no longer stays memoized for the lifetime of the `AtomRepository` instance, so a transient git failure is retried on the next call instead of being replayed forever. ([#77](https://github.com/Ian-stetsenko/lore-protocol/pull/77)) — thanks @TommyC81

## [0.7.0] - 2026-11-02

### Added

- **`lore validate --from <ref>`**: explicit revision-range flag that validates `<ref>..HEAD`, so `--since` can keep its date meaning on every other command. Passing both a positional range and `--from` is an error instead of silently dropping one. ([#69](https://github.com/Ian-stetsenko/lore-protocol/issues/69), [#73](https://github.com/Ian-stetsenko/lore-protocol/pull/73)) — thanks @TommyC81
- **`lore doctor --all`**: opts the Lore-id uniqueness check into scanning every ref, reporting ids shared with side branches. The default stays current-branch only to avoid backup-branch noise. ([#57](https://github.com/Ian-stetsenko/lore-protocol/issues/57), [#74](https://github.com/Ian-stetsenko/lore-protocol/pull/74)) — thanks @TommyC81

### Deprecated

- **`lore validate --since <ref>`**: still works with ref semantics but prints a warning to stderr; it will be removed in 0.8. Use `--from <ref>`. ([#69](https://github.com/Ian-stetsenko/lore-protocol/issues/69))

### Fixed

- **Lore-id shadowing across refs**: `lore trace` and every Lore-id lookup now prefer the HEAD-reachable atom and consult other refs only on a miss, so a side branch (or a future-dated commit) sharing a Lore-id can no longer shadow the current branch's decision. The shared Lore-id index is built the same way, keeping trace, follow-link resolution and reference validation consistent. ([#57](https://github.com/Ian-stetsenko/lore-protocol/issues/57), [#74](https://github.com/Ian-stetsenko/lore-protocol/pull/74)) — thanks @TommyC81
- **`lore commit` JSON input validation**: unknown top-level keys (for example a flat `{"intent": ..., "Constraint": [...]}` schema), wrong-typed `intent`/`body`/`trailers`, non-object payloads and invalid JSON now fail with exit 1 and an actionable error naming the allowed schema, instead of silently committing a barren atom. Inner trailer parsing stays lenient. ([#72](https://github.com/Ian-stetsenko/lore-protocol/pull/72)) — thanks @TommyC81

### Maintenance

- **Windows CI**: build, typecheck and tests now run on `windows-latest` alongside `ubuntu-latest`. ([#68](https://github.com/Ian-stetsenko/lore-protocol/issues/68), [#70](https://github.com/Ian-stetsenko/lore-protocol/pull/70)) — thanks @KingEmma7
- The shipped `lore-validate` advisory workflow uses `validate --from origin/main`.

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
