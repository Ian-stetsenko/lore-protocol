# Lore CLI -- Project Architecture

> Authoritative reference for contributors (human or AI) to the lore-cli codebase.
> Generated 2026-03-20. Reflects the codebase at that point in time.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Module Map](#2-module-map)
3. [Design Patterns Applied](#3-design-patterns-applied)
4. [SOLID Compliance Assessment](#4-solid-compliance-assessment)
5. [Service Dependency Graph](#5-service-dependency-graph)
6. [Data Flow](#6-data-flow)
7. [Configuration System](#7-configuration-system)
8. [Error Handling Strategy](#8-error-handling-strategy)
9. [Testing Architecture](#9-testing-architecture)
10. [Known Limitations and Technical Debt](#10-known-limitations-and-technical-debt)
11. [Extension Points](#11-extension-points)

---

## 1. Architecture Overview

### What the Tool Does

`lore-cli` is a CLI tool for the **Lore protocol** -- a convention for embedding structured decision context (constraints, rejected alternatives, directives, confidence levels, test coverage notes, and cross-references) into git commit messages via trailers. The CLI provides:

- **Query commands** (`context`, `constraints`, `rejected`, `directives`, `tested`, `why`, `search`, `log`) that extract and display Lore atoms from git history for a given file, directory, line range, or global scope.
- **Write commands** (`commit`, `squash`) that compose and create Lore-enriched git commits.
- **Maintenance commands** (`validate`, `stale`, `trace`, `doctor`, `init`) that check protocol compliance, detect stale knowledge, follow decision chains, and run health checks.

### Layered Architecture

The codebase follows a strict layered architecture with dependencies flowing top-down:

```
                        +-----------+
                        |  main.ts  |  <-- Composition Root
                        +-----------+
                             |
                    (creates and wires)
                             |
              +--------------+--------------+
              |                             |
       +------v------+             +-------v--------+
       |   Commands   |             |   Formatters   |
       |  (commands/) |             | (formatters/)  |
       +--------------+             +----------------+
              |                             |
              |   (depends on)              |   (implements)
              |                             |
       +------v------+             +-------v--------+
       |   Services   |             |   Interfaces   |
       |  (services/) |             | (interfaces/)  |
       +--------------+             +----------------+
              |                             |
              |   (depends on)              |   (depends on)
              |                             |
       +------v------+             +-------v--------+
       |    Types     |             |   Utilities    |
       |   (types/)   |             |    (util/)     |
       +--------------+             +----------------+
```

**Layer responsibilities:**

| Layer | Directory | Responsibility |
|-------|-----------|----------------|
| Types | `src/types/` | Domain models, config schema, query/output types. Pure data definitions with zero logic. |
| Interfaces | `src/interfaces/` | Contracts for volatile dependencies (git, config loader, output formatting, terminal prompt). |
| Utilities | `src/util/` | Constants and error types. No behavior, no dependencies on services. |
| Services | `src/services/` | Business logic: parsing, querying, validation, staleness detection, commit building. |
| Formatters | `src/formatters/` | `IOutputFormatter` implementations (text with chalk, JSON). |
| Commands | `src/commands/` | CLI command registration. Thin orchestrators that call services and output via formatters. |
| Main | `src/main.ts` | Composition root. The **only** place concrete classes are instantiated and wired together. |

### Dependency Flow Direction

Dependencies flow **inward and downward** only:

- Commands depend on services and interfaces; never the reverse.
- Services depend on interfaces and types; never on commands or formatters.
- Types and utilities are leaf nodes with no upstream dependencies.

This is enforced by import structure: no file in `services/` imports from `commands/` or `formatters/`.

### Composition Root Pattern

`src/main.ts` (lines 48-176) is the composition root. It:

1. Instantiates all concrete implementations (lines 65-69).
2. Loads configuration (lines 72-79).
3. Creates services that depend on others, injecting dependencies via constructors (lines 82-88).
4. Creates a **formatter factory** (`getFormatter`) that defers formatter selection to call time based on `--json`/`--format` flags (lines 91-97).
5. Registers all commands, passing dependency bags (lines 101-172).
6. Parses CLI arguments and runs the selected command (line 175).

No command or service instantiates its own dependencies. All wiring is centralized here.

---

## 2. Module Map

### Types Layer

#### `src/types/domain.ts`
- **Contains**: `LoreId` type alias, `TrailerKey`/`ArrayTrailerKey`/`EnumTrailerKey` union types, `ConfidenceLevel`/`ScopeRiskLevel`/`ReversibilityLevel` enums, `LoreTrailers` interface, `LoreAtom` interface, `SupersessionStatus` interface.
- **Single Responsibility**: Defines the core domain model -- what a Lore atom is, what trailers exist, and their value types.
- **Dependencies**: None.
- **Dependents**: Nearly every file in the project. This is the foundational type file.

#### `src/types/config.ts`
- **Contains**: `LoreConfig` interface, `DEFAULT_CONFIG` constant.
- **Single Responsibility**: Defines the configuration schema and its default values.
- **Dependencies**: None.
- **Dependents**: `IConfigLoader`, `ConfigLoader`, `CommitBuilder`, `StalenessDetector`, `Validator`, `main.ts`, `path-query.ts`.

#### `src/types/query.ts`
- **Contains**: `TargetType` type, `QueryTarget` interface, `PathQueryOptions` interface, `SearchOptions` interface, `QueryResult` interface, `QueryMeta` interface.
- **Single Responsibility**: Defines the shape of queries (inputs) and their results (outputs) for the query pipeline.
- **Dependencies**: `domain.ts` (for `LoreAtom`, `ConfidenceLevel`, etc.).
- **Dependents**: `PathResolver`, `AtomRepository`, `path-query.ts`, command files, formatters.

#### `src/types/output.ts`
- **Contains**: `FormattableQueryResult`, `FormattableValidationResult`, `FormattableStalenessResult`, `FormattableTraceResult`, `FormattableDoctorResult`, plus supporting types (`CommitValidationResult`, `ValidationIssue`, `StaleReason`, `StaleAtomReport`, `TraceEdge`, `DoctorCheck`).
- **Single Responsibility**: Defines the "view model" types that bridge services and formatters. Each formattable type bundles the data a formatter needs.
- **Dependencies**: `domain.ts`, `query.ts`.
- **Dependents**: `IOutputFormatter`, `TextFormatter`, `JsonFormatter`, `Validator`, `StalenessDetector`, commands.

### Interfaces Layer

#### `src/interfaces/git-client.ts`
- **Contains**: `RawCommit` interface, `BlameLine` interface, `CommitResult` interface, `IGitClient` interface.
- **Single Responsibility**: Defines the contract for all git operations the application needs.
- **Dependencies**: None.
- **Dependents**: `GitClient` (implements), `AtomRepository`, `StalenessDetector`, `Validator`, `commit.ts`, `validate.ts`, `why.ts`.

#### `src/interfaces/config-loader.ts`
- **Contains**: `IConfigLoader` interface.
- **Single Responsibility**: Contract for loading and finding Lore config files.
- **Dependencies**: `config.ts`.
- **Dependents**: `ConfigLoader` (implements), `doctor.ts`, `main.ts`.

#### `src/interfaces/output-formatter.ts`
- **Contains**: `ErrorMessage` interface, `IOutputFormatter` interface.
- **Single Responsibility**: Contract for formatting all output types (queries, validation, staleness, traces, doctor, success, errors).
- **Dependencies**: `output.ts`.
- **Dependents**: `TextFormatter` (implements), `JsonFormatter` (implements), all commands, `main.ts`.

#### `src/interfaces/prompt.ts`
- **Contains**: `IPrompt` interface.
- **Single Responsibility**: Contract for interactive terminal prompts (text, multiline, choice, confirm).
- **Dependencies**: None.
- **Dependents**: `TerminalPrompt` (implements), `commit.ts`, `main.ts`.

### Utilities Layer

#### `src/util/errors.ts`
- **Contains**: `LoreError` class, `ValidationError` class (extends `LoreError`), `GitError` class (extends `LoreError`), `NoStagedChangesError` class (extends `LoreError`).
- **Single Responsibility**: Defines the error hierarchy. Each error carries a semantic exit code.
- **Dependencies**: `output.ts` (`ValidationIssue`).
- **Dependents**: `GitClient`, `commit.ts`, `squash.ts`, `trace.ts`, `why.ts`, `main.ts`.

#### `src/util/constants.ts`
- **Contains**: All protocol constants: `LORE_TRAILER_KEYS`, `ARRAY_TRAILER_KEYS`, `ENUM_TRAILER_KEYS`, valid enum value arrays, `LORE_ID_PATTERN` regex, `REFERENCE_TRAILER_KEYS`, default limits/thresholds, config file names, exit codes.
- **Single Responsibility**: Central registry of all protocol-level constants. Changing a trailer name or adding a new one starts here.
- **Dependencies**: `domain.ts` (type imports only).
- **Dependents**: `TrailerParser`, `PathResolver`, `AtomRepository`, `SupersessionResolver`, `CommitBuilder`, `StalenessDetector`, `Validator`, `init.ts`, `search.ts`, `trace.ts`, `doctor.ts`, `why.ts`.

### Services Layer

#### `src/services/trailer-parser.ts`
- **Contains**: `TrailerParser` class.
- **Single Responsibility**: Parses raw trailer text (multi-line `Key: Value` format) into structured `LoreTrailers` objects, and serializes back. Also detects whether text contains Lore trailers and extracts trailer blocks from full commit messages.
- **Dependencies**: `domain.ts`, `constants.ts`.
- **Dependents**: `AtomRepository`, `CommitBuilder`, `Validator`, `why.ts`, `main.ts`.
- **Key methods**: `parse()`, `serialize()`, `containsLoreTrailers()`, `extractTrailerBlock()`.

#### `src/services/path-resolver.ts`
- **Contains**: `PathResolver` class.
- **Single Responsibility**: Classifies a CLI target string (e.g., `src/auth.ts:45-80`) into a `QueryTarget` and converts it to git log or git blame arguments.
- **Dependencies**: `query.ts`.
- **Dependents**: Commands (`context`, `constraints`, `rejected`, `directives`, `tested`, `stale`, `why`), `main.ts`.
- **Key methods**: `parseTarget()`, `toGitLogArgs()`, `toGitBlameArgs()`.

#### `src/services/lore-id-generator.ts`
- **Contains**: `LoreIdGenerator` class.
- **Single Responsibility**: Generates 8-character random hex Lore IDs using `crypto.randomBytes`.
- **Dependencies**: `domain.ts`, `constants.ts`, Node.js `crypto`.
- **Dependents**: `CommitBuilder`, `SquashMerger`, `main.ts`.
- **Key methods**: `generate()`.

#### `src/services/atom-repository.ts`
- **Contains**: `AtomRepository` class.
- **Single Responsibility**: Central query engine. Retrieves `LoreAtom` objects from git history by target path, Lore-id, revision range, scope, or globally. Handles follow-link BFS traversal.
- **Dependencies**: `IGitClient`, `TrailerParser`, `domain.ts`, `query.ts`, `constants.ts`.
- **Dependents**: Commands (`context`, `constraints`, `rejected`, `directives`, `tested`, `search`, `log`, `stale`, `trace`, `squash`, `doctor`), `Validator`, `main.ts`.
- **Key methods**: `findByTarget()`, `findByLoreId()`, `findByRange()`, `findAll()`, `findByScope()`, `resolveFollowLinks()`.

#### `src/services/supersession-resolver.ts`
- **Contains**: `SupersessionResolver` class.
- **Single Responsibility**: Computes which Lore atoms are superseded (replaced by newer atoms) and resolves transitive supersession chains.
- **Dependencies**: `domain.ts`, `constants.ts`.
- **Dependents**: Commands (`context`, `constraints`, `rejected`, `directives`, `tested`, `search`, `stale`), `main.ts`.
- **Key methods**: `resolve()`, `filterActive()`.

#### `src/services/staleness-detector.ts`
- **Contains**: `StalenessDetector` class.
- **Single Responsibility**: Multi-signal staleness analysis. Checks five signals: age, drift (commits since atom), low confidence, expired `[until:...]` hints in directives, and orphaned dependencies.
- **Dependencies**: `IGitClient`, `LoreConfig`, `domain.ts`, `output.ts`, `constants.ts`.
- **Dependents**: `stale.ts`, `main.ts`.
- **Key methods**: `analyze()`.

#### `src/services/commit-builder.ts`
- **Contains**: `CommitInput` interface, `CommitBuilder` class.
- **Single Responsibility**: Builds a complete git commit message string from structured input (intent, body, trailers) and validates the input before building.
- **Dependencies**: `TrailerParser`, `LoreIdGenerator`, `LoreConfig`, `domain.ts`, `output.ts`, `constants.ts`.
- **Dependents**: `commit.ts`, `main.ts`.
- **Key methods**: `build()`, `validate()`.

#### `src/services/squash-merger.ts`
- **Contains**: `SquashMerger` class.
- **Single Responsibility**: Merges multiple `LoreAtom` objects into a single commit message for squash-merge scenarios. Handles trailer deduplication, enum merging (most conservative for confidence, least conservative for risk), and reference filtering.
- **Dependencies**: `LoreIdGenerator`, `domain.ts`.
- **Dependents**: `squash.ts`, `main.ts`.
- **Key methods**: `merge()`.

#### `src/services/validator.ts`
- **Contains**: `Validator` class.
- **Single Responsibility**: Validates existing git commits for Lore protocol compliance. Checks 10 rules: trailer format, Lore-id presence/format, enum values, intent length, required trailers, message length, reference formats, trailer counts, and reference existence.
- **Dependencies**: `TrailerParser`, `AtomRepository`, `LoreConfig`, `IGitClient`, `domain.ts`, `output.ts`, `constants.ts`.
- **Dependents**: `validate.ts`, `main.ts`.
- **Key methods**: `validate()`.

#### `src/services/config-loader.ts`
- **Contains**: `ConfigLoader` class.
- **Single Responsibility**: Loads `.lore/config.toml` files, walks up the directory tree for monorepo support, merges multiple config files (child overrides parent), and fills in defaults.
- **Dependencies**: `IConfigLoader`, `LoreConfig`, `constants.ts`, Node.js `fs`, `path`, `smol-toml`.
- **Dependents**: `main.ts`, `doctor.ts`.
- **Key methods**: `loadForPath()`, `loadFromFile()`, `findConfigPath()`.

#### `src/services/git-client.ts`
- **Contains**: `GitClient` class.
- **Single Responsibility**: Wraps the git CLI via `child_process.execFile`. Translates git output formats into `RawCommit` and `BlameLine` objects.
- **Dependencies**: `IGitClient`, `errors.ts`, Node.js `child_process`.
- **Dependents**: `main.ts` (instantiation only; all other code depends on `IGitClient`).
- **Key methods**: `log()`, `blame()`, `commit()`, `hasStagedChanges()`, `getRepoRoot()`, `isInsideRepo()`, `getFilesChanged()`, `countCommitsSince()`, `resolveRef()`.

#### `src/services/terminal-prompt.ts`
- **Contains**: `TerminalPrompt` class.
- **Single Responsibility**: Interactive terminal prompts using Node.js `readline/promises`. Lazy-initializes the readline interface.
- **Dependencies**: `IPrompt`, Node.js `readline/promises`.
- **Dependents**: `main.ts` (instantiation only; command depends on `IPrompt`).
- **Key methods**: `askText()`, `askMultiline()`, `askChoice()`, `askConfirm()`, `close()`.

### Formatters Layer

#### `src/formatters/text-formatter.ts`
- **Contains**: `TextFormatter` class.
- **Single Responsibility**: Human-readable terminal output with chalk coloring. Formats all result types (queries, validation, staleness, traces, doctor results, success, errors).
- **Dependencies**: `IOutputFormatter`, `output.ts`, `domain.ts`, `chalk`.
- **Dependents**: `main.ts`.
- **Key methods**: All `IOutputFormatter` methods.

#### `src/formatters/json-formatter.ts`
- **Contains**: `JsonFormatter` class.
- **Single Responsibility**: Machine-readable JSON output. Converts all result types to `lore_version: "1.0"` prefixed JSON with snake_case keys.
- **Dependencies**: `IOutputFormatter`, `output.ts`, `domain.ts`.
- **Dependents**: `main.ts`.
- **Key methods**: All `IOutputFormatter` methods.

### Commands Layer

#### `src/commands/helpers/path-query.ts`
- **Contains**: `PathQueryDeps` interface, `PathQueryCommandOptions` interface, `executePathQuery()` function, `addPathQueryOptions()` function.
- **Single Responsibility**: Shared pipeline for path-scoped query commands. Implements a resolve -> query -> follow -> supersession -> filter -> format pipeline. Parameterized by `visibleTrailers` to control which trailers each command shows.
- **Dependencies**: `AtomRepository`, `SupersessionResolver`, `PathResolver`, `IOutputFormatter`, `LoreConfig`, types.
- **Dependents**: `context.ts`, `constraints.ts`, `rejected.ts`, `directives.ts`, `tested.ts`.

#### `src/commands/init.ts`
- **Contains**: `registerInitCommand()` function.
- **Single Responsibility**: Creates `.lore/config.toml` with default content. Shows existing config if already present.
- **Dependencies**: `IOutputFormatter`, `constants.ts`, Node.js `fs`.

#### `src/commands/context.ts`
- **Contains**: `registerContextCommand()` function.
- **Single Responsibility**: Full lore summary showing ALL trailer types. Delegates to `executePathQuery()` with `visibleTrailers: 'all'`.
- **Dependencies**: `path-query.ts`.

#### `src/commands/constraints.ts`
- **Contains**: `registerConstraintsCommand()` function.
- **Single Responsibility**: Shows only `Constraint` trailers. Delegates to `executePathQuery()` with `visibleTrailers: ['Constraint']`.
- **Dependencies**: `path-query.ts`.

#### `src/commands/rejected.ts`
- **Contains**: `registerRejectedCommand()` function.
- **Single Responsibility**: Shows only `Rejected` trailers. Delegates to `executePathQuery()` with `visibleTrailers: ['Rejected']`.
- **Dependencies**: `path-query.ts`.

#### `src/commands/directives.ts`
- **Contains**: `registerDirectivesCommand()` function.
- **Single Responsibility**: Shows only `Directive` trailers. Delegates to `executePathQuery()` with `visibleTrailers: ['Directive']`.
- **Dependencies**: `path-query.ts`.

#### `src/commands/tested.ts`
- **Contains**: `registerTestedCommand()` function.
- **Single Responsibility**: Shows `Tested` and `Not-tested` trailers. Delegates to `executePathQuery()` with `visibleTrailers: ['Tested', 'Not-tested']`.
- **Dependencies**: `path-query.ts`.

#### `src/commands/why.ts`
- **Contains**: `registerWhyCommand()` function.
- **Single Responsibility**: Decision context for a specific line/range. Uses `git blame` to find commits touching those lines, then extracts Lore trailers from each unique blame commit.
- **Dependencies**: `TrailerParser`, `IGitClient`, `PathResolver`, `IOutputFormatter`, `constants.ts`, `errors.ts`.

#### `src/commands/search.ts`
- **Contains**: `registerSearchCommand()` function, `applySearchFilters()`, `atomHasTrailer()`, `atomMatchesText()`, `buildSearchTargetDescription()` helper functions.
- **Single Responsibility**: Cross-cutting search across all Lore atoms with filters (confidence, scope-risk, reversibility, has-trailer, author, scope, text, date range).
- **Dependencies**: `AtomRepository`, `SupersessionResolver`, `IOutputFormatter`, types, `constants.ts`.

#### `src/commands/log.ts`
- **Contains**: `registerLogCommand()` function.
- **Single Responsibility**: Lore-enriched git log. Shows all Lore-enriched commits, optionally filtered by path (passed after `--`).
- **Dependencies**: `AtomRepository`, `IOutputFormatter`, types.

#### `src/commands/stale.ts`
- **Contains**: `registerStaleCommand()` function.
- **Single Responsibility**: Orchestrates staleness detection. Optionally scoped to a target path. Filters by CLI-level staleness signal options.
- **Dependencies**: `AtomRepository`, `SupersessionResolver`, `StalenessDetector`, `PathResolver`, `IOutputFormatter`, types.

#### `src/commands/trace.ts`
- **Contains**: `registerTraceCommand()` function.
- **Single Responsibility**: BFS traversal of the decision chain starting from a Lore-id, following `Supersedes`, `Depends-on`, and `Related` references.
- **Dependencies**: `AtomRepository`, `IOutputFormatter`, `errors.ts`, `constants.ts`.

#### `src/commands/commit.ts`
- **Contains**: `registerCommitCommand()` function plus input-parsing and interactive-collection helpers.
- **Single Responsibility**: Creates Lore-enriched commits. Supports four input modes: stdin JSON (default), file JSON, CLI flags, and interactive prompts.
- **Dependencies**: `CommitBuilder`, `IGitClient`, `IOutputFormatter`, `IPrompt`, `errors.ts`, `constants.ts`.

#### `src/commands/validate.ts`
- **Contains**: `registerValidateCommand()` function.
- **Single Responsibility**: Validates commits for Lore protocol compliance. Supports revision range, `--since`, `--last`, and `--strict` modes.
- **Dependencies**: `Validator`, `IGitClient`, `IOutputFormatter`, types.

#### `src/commands/squash.ts`
- **Contains**: `registerSquashCommand()` function.
- **Single Responsibility**: Takes a git revision range, gets all Lore atoms, and outputs a merged commit message via `SquashMerger`.
- **Dependencies**: `AtomRepository`, `SquashMerger`, `IOutputFormatter`, `errors.ts`.

#### `src/commands/doctor.ts`
- **Contains**: `registerDoctorCommand()` function plus health-check helpers.
- **Single Responsibility**: Runs four health checks: config validity, Lore-id uniqueness, reference resolution, and orphaned dependencies.
- **Dependencies**: `AtomRepository`, `IConfigLoader`, `IOutputFormatter`, `constants.ts`.

### Entry Point

#### `src/main.ts`
- **Contains**: `main()` async function, top-level error handler.
- **Single Responsibility**: Composition root. Instantiates all concrete implementations, wires dependencies, registers commands, and runs the CLI.
- **Dependencies**: All service classes, all command registration functions, all interfaces, `LoreError`, `commander`.
- **Dependents**: None (it is the entry point).

---

## 3. Design Patterns Applied

### Adapter (GoF -- Structural)

**Where**: `GitClient` (`src/services/git-client.ts`)

**Why**: The volatile git CLI (which uses `child_process.execFile`, custom format strings, and porcelain output) is wrapped behind the stable `IGitClient` domain interface. The `GitClient` class translates between the git binary's text-based protocol and the application's `RawCommit`/`BlameLine` types.

**How**: `GitClient implements IGitClient`. The `exec()` private method runs git commands and converts errors to `GitError`. Private parser methods (`parseLogOutput`, `parseLFlagOutput`, `parseBlameOutput`) adapt git's various output formats into the application's data structures.

---

### Strategy (GoF -- Behavioral)

**Where**: `IOutputFormatter` with `TextFormatter` and `JsonFormatter` (`src/interfaces/output-formatter.ts`, `src/formatters/`)

**Why**: The output format (human-readable text vs. machine-readable JSON) varies by user preference (`--json`, `--format`). Both formatters implement the same `IOutputFormatter` interface, and the strategy is selected at runtime by the `getFormatter()` factory in `main.ts` (line 91).

**How**: Each command calls `getFormatter()` at call time, which reads the CLI flags and returns the appropriate formatter. Commands are completely decoupled from output format concerns.

---

### Template Method (GoF -- Behavioral -- via Composition)

**Where**: `executePathQuery()` in `src/commands/helpers/path-query.ts`

**Why**: Five commands (`context`, `constraints`, `rejected`, `directives`, `tested`) follow the same six-step pipeline but differ only in which trailers they display. Rather than using inheritance, the "template" is a shared function parameterized by `commandName` and `visibleTrailers`.

**How**: The pipeline steps are:
1. Resolve target (path or scope).
2. Query atoms via `AtomRepository`.
3. Follow links if requested.
4. Compute supersession.
5. Filter superseded atoms.
6. Format and output.

Each command calls `executePathQuery()` with its specific `visibleTrailers` parameter, making the step-variation explicit.

---

### Composition Root (DI Pattern)

**Where**: `main()` in `src/main.ts` (lines 48-176)

**Why**: To honor DIP (no service instantiates its own dependencies) and centralize all concrete-to-interface wiring in one place.

**How**: `main()` creates all concrete instances, loads config, wires services together via constructor injection, and passes dependency bags to command registration functions. The entire object graph is built here.

---

### Pure Fabrication (GRASP)

**Where**:
- `AtomRepository` -- persistence access abstracted from domain logic.
- `ConfigLoader` -- filesystem I/O abstracted from domain.
- `LoreIdGenerator` -- random ID generation extracted as infrastructure.
- `TerminalPrompt` -- terminal I/O extracted as infrastructure.

**Why**: These classes don't represent domain concepts (there is no "repository" or "prompt" in the Lore protocol domain). They exist to decouple domain logic from infrastructure concerns (git, filesystem, crypto, terminal), improving testability and cohesion.

---

### Information Expert (GRASP)

**Where**:
- `TrailerParser` -- knows trailer format rules and owns parsing/serialization.
- `PathResolver` -- knows path classification rules and owns target-to-git-args translation.
- `SupersessionResolver` -- knows supersession logic and has access to the `Supersedes` trailer data.
- `StalenessDetector` -- knows staleness rules (age, drift, confidence, expired hints, orphaned deps).

**Why**: Each class owns the behavior that operates on the data it has. `TrailerParser` has the format rules, so it does the parsing. `SupersessionResolver` needs `Supersedes` trailers, which live on atoms, so it receives the atoms.

---

### Protected Variations (GRASP)

**Where**:
- `IGitClient` wraps the volatile git CLI.
- `IConfigLoader` wraps volatile filesystem config loading.
- `IPrompt` wraps volatile terminal I/O.
- `IOutputFormatter` wraps the output format decision.

**Why**: All four are points of predicted variation. Git might change its output format. Config might come from a different source. Terminal I/O might be replaced by a GUI. Output format might gain new variants. Wrapping them behind stable interfaces isolates the rest of the system.

---

### Factory Method (GoF -- Creational -- Lightweight)

**Where**: `getFormatter()` closure in `main.ts` (lines 91-97)

**Why**: Formatter creation depends on runtime CLI flags (`--json`, `--format`) which aren't known until command execution. The factory defers creation and selection to call time.

**How**: The closure captures a reference to the `program` object and reads its options at invocation time, returning either `TextFormatter` or `JsonFormatter`.

---

### Controller (GRASP)

**Where**: All command files in `src/commands/`

**Why**: Commands are thin orchestrators. They parse CLI options, delegate to services for business logic, and delegate to formatters for output. They contain no business logic themselves.

**How**: Each `register*Command()` function registers a Commander `action` callback that:
1. Reads options.
2. Calls service methods.
3. Calls formatter methods.
4. Writes to `console.log`.

---

## 4. SOLID Compliance Assessment

### S -- Single Responsibility Principle

**Followed well:**
- Every service class has a clear, single responsibility. `TrailerParser` only parses/serializes. `PathResolver` only resolves targets. `LoreIdGenerator` only generates IDs. `SupersessionResolver` only computes supersession chains.
- The `CommitBuilder` separates validation (`validate()`) from message construction (`build()`), but both relate to the single responsibility of "preparing a commit message."
- Commands are thin controllers. Business logic is in services.
- The `path-query.ts` helper eliminates duplication across five commands by extracting the shared pipeline.

**Gaps / Risks:**
- `AtomRepository` (line count: 294) has the most methods of any service (6 public: `findByTarget`, `findByLoreId`, `findByRange`, `findAll`, `findByScope`, `resolveFollowLinks`). While all relate to "retrieving atoms from git," the `resolveFollowLinks` BFS traversal is a distinct concern that could be extracted into a `FollowLinkResolver` service.
- `Validator` (line count: 315) has 10 validation rules implemented as private methods within a single class. If the rule set grows, a rule-based dispatch pattern (array of validation rule objects) would improve OCP compliance.
- `search.ts` contains module-level helper functions (`applySearchFilters`, `atomHasTrailer`, `atomMatchesText`) that could belong on an `AtomFilter` or similar service class.

### O -- Open/Closed Principle

**Followed well:**
- The `IOutputFormatter` interface + Strategy pattern means adding a new output format (e.g., YAML) requires only a new class -- no modification to existing code.
- Adding a new path-scoped query command (e.g., `lore risks`) requires only a new file calling `executePathQuery()` with a different `visibleTrailers` list.

**Gaps / Risks:**
- `atomHasTrailer()` in `search.ts` (lines 155-184) uses a `switch` statement on all `TrailerKey` values. Adding a new trailer type requires modifying this function. A lookup map or method on `LoreTrailers` would be more OCP-compliant.
- `TextFormatter.formatTrailers()` (lines 230-294) has an `if` block for each trailer key. Same issue -- adding a new trailer type requires modifying this method. A data-driven approach (iterating over `LORE_TRAILER_KEYS` with a config for display) would eliminate this.
- `Validator.trailerHasValue()` (lines 187-219) has a `switch` over all trailer keys. Same structural issue.
- The staleness signals in `StalenessDetector.analyze()` are hardcoded as five sequential method calls. A signal-registry approach would make it open for extension.

### L -- Liskov Substitution Principle

**Followed well:**
- `TextFormatter` and `JsonFormatter` are fully substitutable for `IOutputFormatter`. All seven interface methods are implemented by both.
- `GitClient` fully implements `IGitClient`. All nine methods are present with correct signatures.
- `ConfigLoader` fully implements `IConfigLoader`. All three methods are present.
- `TerminalPrompt` fully implements `IPrompt`. All five methods are present.

**Gaps / Risks:**
- No violations detected. The interface hierarchy is flat (no inheritance beyond `LoreError` subtypes), and all implementations fully honor their contracts.

### I -- Interface Segregation Principle

**Followed well:**
- `IPrompt` is focused (5 methods, all related to prompting).
- `IConfigLoader` is minimal (3 methods).
- `IGitClient` has 9 methods, which is on the boundary but acceptable because all callers use a subset and the interface represents a single external system.

**Gaps / Risks:**
- `IOutputFormatter` has 7 methods. All current implementers (`TextFormatter`, `JsonFormatter`) implement all 7. However, if a formatter only needed to support queries (not validation, staleness, etc.), it would be forced to implement unused methods. Splitting into `IQueryFormatter`, `IValidationFormatter`, etc. would improve ISP but might be premature given only two implementers exist.

### D -- Dependency Inversion Principle

**Followed well:**
- All services depend on interfaces, not concrete implementations. `AtomRepository` depends on `IGitClient`, not `GitClient`. `CommitBuilder` depends on `TrailerParser` (class type used as interface -- see gap below).
- All wiring happens in `main.ts`. No service uses `new` to create its own dependencies.

**Gaps / Risks:**
- Several services depend on concrete class types rather than interfaces: `AtomRepository` takes `TrailerParser` directly, `CommitBuilder` takes `TrailerParser` and `LoreIdGenerator`, `Validator` takes `TrailerParser` and `AtomRepository`, `SquashMerger` takes `LoreIdGenerator`. These classes don't have corresponding `I*` interfaces. While this works for constructor injection, it means tests must use the real class or use duck typing. Extracting interfaces (`ITrailerParser`, `IAtomRepository`, `ILoreIdGenerator`) would strengthen DIP and make mock boundaries explicit.
- The `path-query.ts` helper's `PathQueryDeps` interface references concrete class types (`AtomRepository`, `SupersessionResolver`, `PathResolver`) instead of interfaces. Same issue.

---

## 5. Service Dependency Graph

```
main.ts (Composition Root)
  |
  |-- creates -> GitClient : IGitClient
  |-- creates -> TrailerParser
  |-- creates -> PathResolver
  |-- creates -> LoreIdGenerator
  |-- creates -> ConfigLoader : IConfigLoader
  |-- creates -> TerminalPrompt : IPrompt
  |
  |-- creates -> AtomRepository(IGitClient, TrailerParser, customTrailerKeys: string[])
  |-- creates -> SupersessionResolver()
  |-- creates -> StalenessDetector(IGitClient, LoreConfig)
  |-- creates -> CommitBuilder(TrailerParser, LoreIdGenerator, LoreConfig)
  |-- creates -> SquashMerger(LoreIdGenerator)
  |-- creates -> Validator(TrailerParser, AtomRepository, LoreConfig)
  |
  |-- registers commands with dependency bags:
  |
  |   init         <- { getFormatter }
  |   context      <- { AtomRepository, SupersessionResolver, PathResolver, getFormatter, LoreConfig }
  |   constraints  <- (same as context)
  |   rejected     <- (same as context)
  |   directives   <- (same as context)
  |   tested       <- (same as context)
  |   why          <- { TrailerParser, IGitClient, PathResolver, getFormatter, customTrailerKeys }
  |   search       <- { AtomRepository, SupersessionResolver, getFormatter }
  |   log          <- { AtomRepository, getFormatter }
  |   stale        <- { AtomRepository, SupersessionResolver, StalenessDetector, PathResolver, getFormatter }
  |   trace        <- { AtomRepository, getFormatter }
  |   commit       <- { CommitBuilder, IGitClient, getFormatter, IPrompt }
  |   validate     <- { Validator, IGitClient, getFormatter }
  |   squash       <- { AtomRepository, SquashMerger, getFormatter }
  |   doctor       <- { AtomRepository, IConfigLoader, getFormatter }
```

### Constructor Injection Signatures

```typescript
AtomRepository(
  gitClient: IGitClient,
  trailerParser: TrailerParser,
  customTrailerKeys: readonly string[]
)

SupersessionResolver()  // no dependencies

StalenessDetector(
  gitClient: IGitClient,
  config: LoreConfig
)

CommitBuilder(
  trailerParser: TrailerParser,
  loreIdGenerator: LoreIdGenerator,
  config: LoreConfig
)

SquashMerger(
  loreIdGenerator: LoreIdGenerator
)

Validator(
  trailerParser: TrailerParser,
  atomRepository: AtomRepository,
  config: LoreConfig
)

GitClient(cwd?: string)          // defaults to process.cwd()
ConfigLoader()                   // no dependencies
TerminalPrompt()                 // no dependencies
TrailerParser()                  // no dependencies
PathResolver()                   // no dependencies
LoreIdGenerator()                // no dependencies
TextFormatter({ color: boolean })
JsonFormatter()                  // no dependencies
```

---

## 6. Data Flow

### Query Flow: `lore constraints src/auth.ts`

```
User runs: lore constraints src/auth.ts

1. main.ts parses CLI -> Commander routes to constraints command

2. constraints.ts action calls:
   executePathQuery("src/auth.ts", options, deps, "constraints", ["Constraint"])

3. path-query.ts: PathResolver.parseTarget("src/auth.ts")
   -> QueryTarget { type: "file", filePath: "src/auth.ts", ... }

4. path-query.ts: PathResolver.toGitLogArgs(target)
   -> ["--", "src/auth.ts"]

5. path-query.ts: AtomRepository.findByTarget(["--", "src/auth.ts"], queryOptions)
   a. AtomRepository.buildLogArgs(options)
      -> [] (no filters in this case)
   b. GitClient.log(["--", "src/auth.ts"])
      -> execFile("git", ["log", "--format=<custom>", "--", "src/auth.ts"])
      -> parses stdout into RawCommit[]
   c. AtomRepository.parseRawCommits(rawCommits)
      For each RawCommit:
        - TrailerParser.containsLoreTrailers(raw.trailers) -> filter non-Lore commits
        - TrailerParser.parse(raw.trailers, customKeys) -> LoreTrailers
        - GitClient.getFilesChanged(raw.hash) -> string[]
        - Construct LoreAtom
   d. AtomRepository.applyFilters(atoms, options)
      -> apply author, since, limit filters
   -> LoreAtom[]

6. path-query.ts: SupersessionResolver.resolve(atoms)
   -> Iterates atoms, builds supersession map from Supersedes trailers
   -> Resolves transitive chains via BFS
   -> Map<string, SupersessionStatus>

7. path-query.ts: SupersessionResolver.filterActive(atoms, supersessionMap)
   -> Removes superseded atoms from display list

8. path-query.ts: Constructs QueryResult and FormattableQueryResult
   -> Sets visibleTrailers: ["Constraint"]

9. path-query.ts: getFormatter() -> TextFormatter or JsonFormatter

10. TextFormatter.formatQueryResult(data):
    For each atom:
      - Format header (lore-id, date, author)
      - Format body (if present)
      - formatTrailers() filters to only show "Constraint" trailer lines
    Appends summary line

11. console.log(output) -> terminal
```

### Commit Flow: Agent pipes JSON to `lore commit`

```
Agent runs: echo '{"intent":"fix(auth): ...","trailers":{...}}' | lore commit

1. main.ts parses CLI -> Commander routes to commit command

2. commit.ts action:
   a. GitClient.hasStagedChanges()
      -> execFile("git", ["diff", "--cached", "--name-only"])
      -> true (has staged changes) or throws NoStagedChangesError

   b. No --interactive, no --file, no --intent flag
      -> readInputFromStdin()
      -> process.stdin collects chunks until EOF
      -> Buffer.concat(chunks).toString("utf-8")
      -> parseJsonInput(content):
         - JSON.parse(content)
         - Extract intent (string)
         - Extract body (string | undefined)
         - Extract trailers (parse each field with type guards)
      -> CommitInput

   c. CommitBuilder.validate(input):
      - Check intent length (max 72)
      - Check intent not empty
      - Validate enum values (Confidence, Scope-risk, Reversibility)
      - Validate Lore-id format in reference trailers (Supersedes, Depends-on, Related)
      - Check required trailers from config
      - Check total line count
      -> ValidationIssue[]
      If errors: throw ValidationError

   d. CommitBuilder.build(input):
      - LoreIdGenerator.generate() -> "a7f3b2c1" (8-char random hex)
      - buildTrailers(loreId, input) -> LoreTrailers object
      - TrailerParser.serialize(trailers) -> "Lore-id: a7f3b2c1\nConstraint: ..."
      - Assemble: intent + blank + body + blank + serialized trailers
      -> complete commit message string

   e. GitClient.commit(message):
      -> execFile("git", ["commit", "-m", message])
      -> Parse output for commit hash
      -> CommitResult { hash, success: true }

   f. getFormatter().formatSuccess("Commit created: abc1234", { hash: "abc1234" })
      -> console.log(output)
```

---

## 7. Configuration System

### Config File Location

The Lore config file is located at `.lore/config.toml` relative to the project root. The constants for these paths are:

```
CONFIG_DIR = '.lore'          (src/util/constants.ts, line 49)
CONFIG_FILENAME = 'config.toml'  (src/util/constants.ts, line 48)
```

### Monorepo Merging

`ConfigLoader.loadForPath()` (line 28) walks **up the directory tree** from the target path to the filesystem root, collecting all `.lore/config.toml` files found along the way.

Multiple config files are merged with **child overrides parent**. The files are ordered nearest-to-farthest, reversed, and merged parent-first so the nearest config wins.

```
/repo/.lore/config.toml         <- parent (applied first)
/repo/packages/api/.lore/config.toml  <- child (overrides parent)
```

Merge strategy: **shallow merge at the section level**. If the child defines `[validation]`, the entire `[validation]` section replaces the parent's.

### Defaults

Every field has a default value defined in `DEFAULT_CONFIG` (`src/types/config.ts`, lines 26-33). If no config file is found, the entire default is used. If a config file is found, `mergeWithDefaults()` fills in any missing sections.

### Full Config Schema

```toml
[protocol]
version = "1.0"                # Protocol version string

[trailers]
required = []                  # Array of trailer keys required on every commit
                               # e.g., ["Constraint", "Confidence"]
custom = []                    # Array of custom trailer key names to recognize
                               # e.g., ["Team", "Ticket"]

[validation]
strict = false                 # When true, missing required trailers are errors (not warnings)
max_message_lines = 50         # Maximum total lines in a commit message
intent_max_length = 72         # Maximum character length of the intent (subject) line

[stale]
older_than = "6m"              # Duration threshold for age-based staleness
                               # Supported units: d (days), w (weeks), m (months), y (years)
drift_threshold = 20           # Number of commits to a file since an atom before it's "drifted"

[output]
default_format = "text"        # Default output format: "text" or "json"

[follow]
max_depth = 3                  # Maximum BFS depth when following Related/Supersedes/Depends-on links
```

### TOML Key Naming

The config loader accepts **both** snake_case (TOML convention) and camelCase for field names within sections:

| TOML key | Also accepts | Maps to |
|----------|-------------|---------|
| `max_message_lines` | `maxMessageLines` | `validation.maxMessageLines` |
| `intent_max_length` | `intentMaxLength` | `validation.intentMaxLength` |
| `older_than` | `olderThan` | `stale.olderThan` |
| `drift_threshold` | `driftThreshold` | `stale.driftThreshold` |
| `default_format` | `defaultFormat` | `output.defaultFormat` |
| `max_depth` | `maxDepth` | `follow.maxDepth` |

This dual-key support is implemented in `ConfigLoader.toPartialConfig()` (lines 143-213) using fallback ternaries.

---

## 8. Error Handling Strategy

### Error Type Hierarchy

```
Error (built-in)
  |
  +-- LoreError
        message: string
        exitCode: number
        |
        +-- ValidationError
        |     exitCode: 1
        |     issues: readonly ValidationIssue[]
        |
        +-- GitError
        |     exitCode: 2
        |
        +-- NoStagedChangesError
              exitCode: 3
              message: "No staged changes. Stage files with `git add` before running `lore commit`."
```

### Exit Codes

| Code | Constant | Meaning |
|------|----------|---------|
| 0 | `EXIT_CODE_SUCCESS` | Success |
| 1 | `EXIT_CODE_VALIDATION_ERROR` | Validation error, invalid input, or not-found |
| 2 | `EXIT_CODE_GIT_ERROR` | Git command failed |
| 3 | `EXIT_CODE_NO_STAGED_CHANGES` | `lore commit` invoked without staged changes |

### Propagation Flow

1. **Services** throw typed errors:
   - `GitClient.exec()` catches `execFile` failures and throws `GitError`.
   - `CommitBuilder.validate()` returns `ValidationIssue[]` but does not throw. The command checks for errors and throws `ValidationError`.
   - Commands throw `LoreError` for user-facing errors (e.g., invalid Lore-id format, no blame data found).

2. **Commands** either handle errors locally or let them propagate to the top-level handler:
   - `validate.ts` sets `process.exitCode` directly for non-zero results.
   - `doctor.ts` sets `process.exitCode = 1` on errors.
   - Most commands let errors propagate.

3. **Top-level handler** (`main.ts`, lines 179-208):
   - Catches all errors from `main().catch(...)`.
   - Detects `--json` in `process.argv` to select the appropriate formatter for error output (since Commander parsing may have failed).
   - `LoreError` instances: formats with the error's exit code and message, sets `process.exitCode`.
   - Generic `Error` instances: formats with exit code 1.
   - Unknown errors: prints a generic message, sets exit code 1.

### Error Formatting

Both `TextFormatter` and `JsonFormatter` implement `formatError(code, messages)`:

- **Text**: `error: <message>` in red, `warning: <message>` in yellow, dim `(exit code N)`.
- **JSON**: `{ "lore_version": "1.0", "error": true, "code": N, "messages": [...] }`.

---

## 9. Testing Architecture

### Framework and Configuration

- **Framework**: Vitest (`vitest ^3.1.1`)
- **Config**: `vitest.config.ts` -- includes `tests/**/*.test.ts`, globals enabled, 10-second timeout.
- **Test runner**: `npm run test` (single run) or `npm run test:watch` (watch mode).

### Directory Structure

```
tests/
  unit/
    services/
      trailer-parser.test.ts
      path-resolver.test.ts
      lore-id-generator.test.ts
      supersession-resolver.test.ts
      commit-builder.test.ts
      squash-merger.test.ts
      staleness-detector.test.ts
      atom-repository.test.ts
      validator.test.ts
      config-loader.test.ts
    formatters/
      text-formatter.test.ts
      json-formatter.test.ts
```

### What Is Tested

**Unit-tested services** (10 files):
- `TrailerParser` -- parse, serialize, roundtrip, containsLoreTrailers, extractTrailerBlock.
- `PathResolver` -- target parsing (file, line-range, directory, glob), toGitLogArgs, toGitBlameArgs.
- `LoreIdGenerator` -- generates valid 8-char hex, randomness.
- `SupersessionResolver` -- direct supersession, transitive chains, filterActive.
- `CommitBuilder` -- build message structure, validate rules.
- `SquashMerger` -- trailer merging, enum conservatism, body concatenation, external-only references.
- `StalenessDetector` -- age, drift, low-confidence, expired hints, orphaned dependencies.
- `AtomRepository` -- query pipeline, Lore-id lookup, follow links.
- `Validator` -- all 10 validation rules.
- `ConfigLoader` -- file loading, directory walking, merging, defaults.

**Unit-tested formatters** (2 files):
- `TextFormatter` -- all seven `IOutputFormatter` methods.
- `JsonFormatter` -- all seven `IOutputFormatter` methods.

### Mock Boundaries

Tests that involve services with dependencies use **manual mocks** (not vitest module mocks):

- `AtomRepository` tests create a mock `IGitClient` with `vi.fn()` implementations and a mock `TrailerParser`.
- `StalenessDetector` tests create a mock `IGitClient`.
- `Validator` tests create mock `TrailerParser` and `AtomRepository`.
- `ConfigLoader` tests use the real `smol-toml` parser but mock the filesystem by writing temp files.

The interfaces (`IGitClient`, `IConfigLoader`, `IPrompt`, `IOutputFormatter`) define the natural mock boundaries. Tests for services that depend on these interfaces create mock implementations inline.

### Test Helpers

Tests commonly use `makeTrailers()` and `makeAtom()` factory functions (defined locally in each test file) to create test data with sensible defaults and overrides.

### What Is NOT Tested

- **Commands** (`src/commands/`) -- No command-level tests exist. Command logic is tested indirectly via service tests, but the orchestration (option parsing, error handling within actions, stdin reading, interactive prompts) is untested.
- **main.ts** -- No integration test covers the composition root or top-level error handler.
- **End-to-end** -- No tests that invoke the actual CLI binary against a real git repository.

---

## 10. Known Limitations and Technical Debt

### Missing Interfaces for Service Dependencies

Several services use **concrete class types** as constructor parameters instead of interfaces:

| Service | Concrete dependency | Should be |
|---------|-------------------|-----------|
| `AtomRepository` | `TrailerParser` | `ITrailerParser` |
| `CommitBuilder` | `TrailerParser`, `LoreIdGenerator` | `ITrailerParser`, `ILoreIdGenerator` |
| `Validator` | `TrailerParser`, `AtomRepository` | `ITrailerParser`, `IAtomRepository` |
| `SquashMerger` | `LoreIdGenerator` | `ILoreIdGenerator` |

**Impact**: Tests must rely on duck-typing or use the real class. If these services gained complex logic, testing would become harder. **Recommendation**: Extract interfaces for `TrailerParser`, `AtomRepository`, and `LoreIdGenerator`.

**Files**: `src/services/atom-repository.ts` (line 16), `src/services/commit-builder.ts` (lines 1-2), `src/services/validator.ts` (lines 1-2), `src/services/squash-merger.ts` (line 1).

---

### No Command-Level Tests

All 15 commands lack dedicated test files. While service tests cover business logic, the following is untested:
- CLI option parsing and type coercion.
- Stdin JSON parsing edge cases (malformed JSON, empty stdin).
- Interactive prompt flow (the full `collectInteractiveInput` sequence).
- `process.exitCode` setting in `validate.ts` and `doctor.ts`.
- The top-level error handler in `main.ts`.

**Recommendation**: Add at least smoke tests for each command using a mock `IGitClient` and captured `console.log` output.

---

### OCP Violations in Trailer Enumeration

Multiple files contain hard-coded `switch`/`if` blocks that enumerate all trailer keys:

| File | Location | Pattern |
|------|----------|---------|
| `search.ts` | `atomHasTrailer()`, lines 155-184 | `switch(trailerKey)` over all keys |
| `text-formatter.ts` | `formatTrailers()`, lines 230-294 | `if(shouldShow(key))` for each key |
| `json-formatter.ts` | `serializeTrailers()`, lines 180-235 | `if(shouldShow(key))` for each key |
| `validator.ts` | `trailerHasValue()`, lines 187-219 | `switch(key)` over all keys |

Adding a new trailer type requires modifying all four locations. **Recommendation**: Create a data-driven trailer registry (e.g., `TRAILER_DEFINITIONS` array with key, kind, display color, etc.) and derive these switch/if blocks from the registry.

---

### `why` Command Duplicates Atom Construction

`why.ts` (lines 63-101) constructs `LoreAtom` objects directly from `RawCommit` data rather than going through `AtomRepository.parseRawCommits()`. This duplicates the parsing logic (trailer parsing, filesChanged lookup, body stripping) that `AtomRepository` already encapsulates.

**Root cause**: `why` uses `git blame` to find specific commits, then queries each commit individually with `git log -1 <hash>`. `AtomRepository` doesn't expose a `findByCommitHash()` method.

**Recommendation**: Add `AtomRepository.findByCommitHash(hash: string)` and use it in `why.ts` to eliminate the duplication.

---

### `search.ts` Contains Business Logic in Command File

`search.ts` defines four helper functions (`applySearchFilters`, `atomHasTrailer`, `atomMatchesText`, `buildSearchTargetDescription`) at module scope. The first three contain filtering/matching logic that should arguably live in a service (e.g., `AtomFilter`) per GRASP Controller pattern (commands should coordinate, not compute).

**Recommendation**: Extract a `SearchService` or `AtomFilter` service.

---

### `log.ts` Doesn't Compute Supersession

The `log` command (line 63-69) explicitly creates a map marking all atoms as `superseded: false`. This means the log output cannot indicate which entries have been superseded. All other query commands compute supersession properly.

**Impact**: Users viewing `lore log` output cannot tell which decisions are still active. **Recommendation**: Use `SupersessionResolver.resolve()` like other commands do.

---

### Staleness Drift Check Serializes Per-File

`StalenessDetector.checkDrift()` (lines 87-107) runs `gitClient.countCommitsSince()` for **every file** in `atom.filesChanged`. For atoms touching many files, this generates many git subprocess calls.

**Impact**: Performance bottleneck for atoms with large changesets. **Recommendation**: Consider batch git operations or a threshold to stop after the first drifted file.

---

### No `bin/lore.js` File in Repository

`package.json` declares `"bin": { "lore": "./bin/lore.js" }`, but no `bin/` files exist in the glob search. The `bin/` directory exists but was empty at search time. This file is likely generated during `npm run build` (tsup), but its absence means `npm link` will fail without a build step first.

---

### Config Loader Directory Detection Heuristic

`ConfigLoader.findConfigPath()` and `findAllConfigPaths()` determine whether the start path is a file or directory by checking `parsePath(startPath).ext` (lines 68, 104). This heuristic is fragile: a directory named `data.v2` would be misidentified as a file. A `stat()` call would be more reliable.

---

### No Graceful Handling of Large Repos

`AtomRepository.findAll()` has no built-in pagination. `doctor.ts` passes `limit: 10000` (line 39), but other callers (e.g., `stale` without a target) call `findAll()` with no limit, potentially loading all Lore atoms in a large monorepo into memory.

---

## 11. Extension Points

### How to Add a New Command

1. Create `src/commands/<command-name>.ts`.
2. Export a `register<CommandName>Command(program: Command, deps: { ... })` function.
3. Define the dependency bag interface inline (or use `PathQueryDeps` if it's a path-query command).
4. If it's a path-scoped query (like `constraints`, `rejected`), call `executePathQuery()` from `path-query.ts` with the appropriate `visibleTrailers`.
5. If it's a unique command, implement the orchestration logic in the action callback, calling services and formatters.
6. Register in `main.ts`: import the registration function, and call it with the appropriate dependency bag.

**Example** (adding `lore risks` to show risk-related trailers):
```typescript
// src/commands/risks.ts
import type { Command } from 'commander';
import { executePathQuery, addPathQueryOptions, type PathQueryDeps, type PathQueryCommandOptions } from './helpers/path-query.js';

export function registerRisksCommand(program: Command, deps: PathQueryDeps): void {
  const cmd = program.command('risks <target>').description('Risk assessment for a code region');
  addPathQueryOptions(cmd);
  cmd.action(async (target: string, options: PathQueryCommandOptions) => {
    await executePathQuery(target, options, deps, 'risks', ['Confidence', 'Scope-risk', 'Reversibility']);
  });
}
```

Then in `main.ts`, add:
```typescript
import { registerRisksCommand } from './commands/risks.js';
// ...
registerRisksCommand(program, pathQueryDeps);
```

### How to Add a New Trailer Type

1. **`src/types/domain.ts`**: Add the key to the `TrailerKey` union. If it's array-valued, add to `ArrayTrailerKey`. If it's enum-valued, add to `EnumTrailerKey` and define its value type. Add the field to `LoreTrailers`.

2. **`src/util/constants.ts`**: Add the key to `LORE_TRAILER_KEYS`. Add to `ARRAY_TRAILER_KEYS` or `ENUM_TRAILER_KEYS` as appropriate. If enum, add its valid values array.

3. **`src/services/trailer-parser.ts`**: `parse()` and `serialize()` use `ARRAY_TRAILER_KEYS` and `ENUM_TRAILER_KEYS` from constants, so they will pick up the new key automatically for parsing. Serialization order follows the iteration order of these arrays.

4. **`src/formatters/text-formatter.ts`**: Add a rendering block in `formatTrailers()` (around line 242) with the desired color.

5. **`src/formatters/json-formatter.ts`**: Add a serialization block in `serializeTrailers()` (around line 193).

6. **`src/services/commit-builder.ts`**: Add the field to `CommitInput.trailers` and to `buildTrailers()`.

7. **(Optional)** Update `search.ts` `atomHasTrailer()` and `validator.ts` `trailerHasValue()` if the new trailer should be searchable/validatable.

### How to Add a New Output Format

1. Create `src/formatters/<format>-formatter.ts`.
2. Implement `IOutputFormatter` (all 7 methods).
3. In `main.ts`, update the `getFormatter()` factory to recognize the new format string:
   ```typescript
   if (opts.format === 'yaml') {
     return new YamlFormatter();
   }
   ```
4. Update the `--format` option description in `main.ts` (line 59).

### How to Add a New Staleness Signal

1. Add a new `signal` value to the `StaleReason.signal` union type in `src/types/output.ts` (line 34).

2. In `StalenessDetector` (`src/services/staleness-detector.ts`):
   a. Create a new private `check<SignalName>()` method following the pattern of existing check methods.
   b. Call it from `analyze()` (around line 53).

3. **No formatter changes needed** -- formatters render `StaleReason` generically using `reason.description`.

4. **(Optional)** Add a CLI flag in `stale.ts` to filter by the new signal.

### How to Add a New Reference Trailer Type

If you need a new cross-reference trailer (beyond `Supersedes`, `Depends-on`, `Related`):

1. Add the key to `TrailerKey`, `ArrayTrailerKey` in `domain.ts`.
2. Add the field to `LoreTrailers` in `domain.ts`.
3. Add to `REFERENCE_TRAILER_KEYS` in `constants.ts`.
4. `AtomRepository.extractReferenceIds()` iterates `REFERENCE_TRAILER_KEYS`, so follow-link resolution picks it up automatically.
5. `trace.ts` iterates `REFERENCE_TRAILER_KEYS`, so trace follows the new reference automatically.
6. Add to `TraceEdge.relationship` union type in `output.ts`.
7. Update `SupersessionResolver` if the new reference type implies supersession.
8. Add formatter rendering.

---

*End of document.*
