# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/Ian-stetsenko/lore-protocol/releases/tag/v0.1.0
