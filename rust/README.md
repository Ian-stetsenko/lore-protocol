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

Requires Rust 1.80 or newer (`rustup` recommended) and `git` on `PATH`.

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
executable end to end.

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
  Commander did. `--help` and `--version` exit 0.
- **Formatter selection.** The TypeScript code deferred formatter creation
  because Commander parsed global options lazily. clap parses everything up
  front, so `main.rs` builds the formatter once and passes it down.
- **Dates.** Author dates are parsed from git's ISO output and, for `-L`
  queries, from git's default date format. A date that fails to parse is
  reported as the Unix epoch instead of crashing (`new Date(x).toISOString()`
  threw in Node).
- **Intent length.** Counted in Unicode scalar values rather than UTF-16 code
  units; identical for all text outside astral planes.

## Status and migration plan

This directory is additive: the npm package in the repository root keeps
shipping unchanged, and both implementations share the same test fixtures in
spirit (the Rust unit tests are a port of `tests/`). The plan is:

1. Ship this port, build it in CI on Linux, macOS and Windows.
2. Publish prebuilt binaries from tags and an npm shim that installs the
   matching binary, so `npm install -g lore-protocol` keeps working.
3. Once a release has been exercised by the hook and by agents, retire the
   TypeScript sources and move `rust/` to the repository root.
