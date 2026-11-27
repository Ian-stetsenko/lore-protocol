# Lore CLI (Rust)

Native implementation of the [Lore CLI](../README.md). It is a parity port of
the TypeScript implementation in `../src`: same commands, same flags, same
text and JSON output, same exit codes, same `.lore/config.toml`, same hook
script. The protocol is unchanged; only the runtime is.

## Why a native binary

- **Startup.** The commit-msg hook runs `lore validate` on every commit and
  agents call `lore` in tight loops. A native binary starts in a few
  milliseconds; Node needs tens of milliseconds before any code runs.
- **Distribution.** A single static binary has no runtime dependency. Hooks
  stop breaking when Node is missing or the wrong version.
- **Headroom.** In-process git access (gitoxide) and a persistent atom index
  become possible without a language boundary. Neither is in this port; it
  shells out to `git` exactly like the TypeScript client so behaviour stays
  byte-for-byte comparable.

## Build

Requires Rust 1.85 or newer (`rustup` recommended) and `git` on `PATH`.

```sh
cd rust
cargo build --release          # binary at target/release/lore
cargo install --path .         # installs `lore` into ~/.cargo/bin
```

## Test

```sh
cd rust
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test                     # unit tests + git integration tests
```

Unit tests mirror the TypeScript suite case-for-case and live next to each
module in `src/<module>/tests.rs`. Integration tests under `tests/` drive the
real `git` binary against throwaway repositories and run the built `lore`
executable end to end. Their hermetic git fixtures live in `tests/common`.

### Differential parity

`tests/parity.rs` runs this binary and the TypeScript CLI on identical
repositories (fixed identities and dates, so both get the same commit hashes)
and compares exit codes, stdout and stderr byte for byte, then the state each
CLI left behind: every commit message, `git status --porcelain`,
`.lore/config.toml` and the commit-msg hook. It covers all 16
commands in text and `--json` modes. It is skipped unless `LORE_TS_CLI`
points at a built TypeScript CLI:

```sh
npm ci && npm run build        # in the repository root
cd rust
LORE_TS_CLI="$PWD/../dist/main.js" cargo test --test parity
```

The `parity` job in `.github/workflows/rust.yml` runs it on every change to
either implementation. It is advisory (`continue-on-error`) until the Rust
binary replaces the TypeScript CLI; see the Rust Parity section of
`CONTRIBUTING.md`. Normalised before comparing: Lore-ids and commit hashes
that a case generated (anything already in the fixture history, such as the
Lore-id an amend must keep, is compared exactly), the repository path, the
JSON parse-error suffix, and clap's usage and help text (exit code only).

## Layout

```
src/
  main.rs          composition root: the ONLY place concrete types are wired
  cli.rs           clap definitions for every command and flag
  commands/        thin handlers, one module per command
    helpers/       shared path-query pipeline and query meta
  formatters/      OutputFormatter implementations (text, JSON)
  services/        business logic (parsing, querying, validation, staleness, ...)
  interfaces/      traits/ports (GitClient, ConfigLoader, OutputFormatter, Prompt, ...)
  types/           domain models, config schema, query/output shapes
  util/            constants, error/exit-code mapping, update-check gate
  test_support/    shared mocks and fixtures (test builds only)
```

The dependency rules are the ones in the repository `CLAUDE.md`: commands
depend on services and interfaces, services on interfaces and types, and
nothing in `services/` imports from `commands/` or `formatters/`.

Module names map 1:1 onto the TypeScript files (`atom-repository.ts` is
`atom_repository.rs`, and so on), so a reviewer can diff behaviour side by
side.

## Behavioural notes

Where the two implementations differ it is deliberate and listed here.

- **Update notifier.** The Node package checked the npm registry for a newer
  version. The native binary honours every opt-out (`--no-update-notifier`,
  `LORE_NO_UPDATE_CHECK`, `NO_UPDATE_NOTIFIER`, `CI`, JSON output,
  `[cli] update_check = false`) but performs no network check until a release
  channel for binaries exists.
- **Usage errors.** Unknown flags and missing arguments exit with code 1, as
  Commander did, and `--help` and `--version` exit 0. The usage and help text
  itself is clap's, not Commander's, so only the exit codes are identical.
  An invalid `--limit` / `--max-commits` value is not a usage error in
  either CLI: it renders through the output formatter (a JSON envelope when
  the arguments contain `--json` or `--format=json`), as in TS.
- **Non-numeric counts.** `validate --last` rejects a non-numeric value with
  exit 1. TS parses it with a bare `parseInt`, so `--last abc` silently
  becomes `NaN`, falls back to the default and exits 0, and `--last 3x`
  means three. `trace --max-depth`, `stale --drift`, `stale --older-than`,
  `--limit` and `--max-commits` match TS exactly: a strict parser whose error
  renders through the output formatter, and a value starting with `-`
  (`--max-depth -1`) is taken as the value, as Commander does. One edge
  remains: Commander claims the global `--json` / `--format` options before
  the subcommand sees them, so `--limit --json` is "argument missing" usage
  text in TS and an invalid-value error in Rust (exit 1 in both).
- **Config arrays.** Array options in `.lore/config.toml` (for example
  `trailers.required`) keep only their string elements. The TypeScript loader
  kept the array as-is, untyped, so a non-string element reached the code that
  used it.
- **Hook permissions.** `lore hooks install` marks the hook executable
  (`0o755`) only on Unix (`cfg(unix)`). Node's `chmod` ran on every platform
  and had no effect on Windows; the Windows result is the same.
- **Formatter selection.** The TypeScript code deferred formatter creation
  because Commander parsed global options lazily. clap parses everything up
  front, so `main.rs` builds the formatter once and passes it down.
- **Dates.** Author dates are parsed from git's ISO output and, for `-L`
  queries, from git's default date format. A date that fails to parse is
  reported as the Unix epoch instead of crashing (`new Date(x).toISOString()`
  threw in Node).
- **Intent length.** Counted in Unicode scalar values rather than UTF-16 code
  units; identical for all text outside astral planes.
- **JSON commit input errors.** Schema errors (non-object input, unknown or
  wrong-typed top-level keys) are byte-identical to the TypeScript CLI. Only the
  text after `Commit input is not valid JSON: ` differs, because it comes from
  the parser: serde reports e.g. `key must be a string at line 1 column 3`,
  V8 reports e.g. `Expected property name or '}' in JSON at position 2`.
- **Unknown-key order.** Unknown top-level keys in commit input are listed in
  document order. V8's `Object.keys` lists integer-like keys (`"1"`) first, so
  the two messages differ only when such a key is present.
- **JSON key order.** Every `--json` envelope emits its keys in the same order
  as the TypeScript formatter; `json_output_preserves_key_order` in
  `tests/cli_e2e.rs` pins it.

## Status and migration plan

This directory is additive: the npm package in the repository root keeps
shipping unchanged, and both implementations share the same test fixtures in
spirit (the Rust unit tests are a port of `tests/`). The plan is:

1. Ship this port, build it in CI on Linux, macOS and Windows.
2. Publish prebuilt binaries from tags and an npm shim that installs the
   matching binary, so `npm install -g lore-protocol` keeps working.
3. Once a release has been exercised by the hook and by agents, retire the
   TypeScript sources and move `rust/` to the repository root.
