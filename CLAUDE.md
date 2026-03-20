# Lore CLI

Lore CLI is a tool for the Lore protocol -- a convention for embedding structured decision context (constraints, rejected alternatives, directives, confidence, test notes, cross-references) into git commit messages via trailers. It provides query, write, and maintenance commands over git history.

## Tech Stack

TypeScript, Node.js 18+, ESM modules, Commander.js, vitest, chalk, smol-toml, tsup (bundler).

## Build & Test Commands

| Command | Description |
|---------|-------------|
| `npm run build` | Build with tsup |
| `npm run typecheck` | Type-check with `tsc --noEmit` |
| `npm test` | Run all tests with vitest |
| `npm run test:watch` | Tests in watch mode |
| `npm run lint` | ESLint (`src/` and `tests/`) |
| `npm run format` | Prettier (`src/` and `tests/`) |

Run `npm run build && npm run typecheck && npm test` before submitting changes.

## Architecture

Strict layered architecture. Dependencies flow inward/downward only.

```
main.ts          — Composition root (the ONLY place concrete classes are instantiated)
  commands/      — Thin CLI handlers; one file per command
    helpers/     — Shared command logic (e.g., path-query pipeline)
  formatters/    — IOutputFormatter implementations (text, JSON)
  services/      — Business logic (parsing, querying, validation, staleness, commit building)
  interfaces/    — Contracts/ports (IGitClient, IConfigLoader, IOutputFormatter, IPrompt)
  types/         — Domain models, config schema, query/output shapes (pure data, zero logic)
  util/          — Constants and error types
```

**Dependency rules:**
- Commands depend on services and interfaces; never the reverse.
- Services depend on interfaces and types; never on commands or formatters.
- Types and utilities are leaf nodes with no upstream dependencies.
- No file in `services/` imports from `commands/` or `formatters/`.

### Composition Root

`src/main.ts` is the composition root. It:
1. Instantiates all concrete implementations.
2. Loads configuration.
3. Creates services with constructor injection.
4. Creates the formatter factory (`getFormatter`) that defers format selection to call time.
5. Registers all commands with their dependency bags.

No command or service instantiates its own dependencies.

## Code Conventions

- **ESM modules** -- always use `.js` extensions in imports (TypeScript convention for ESM).
- **Readonly by default** -- use `readonly` on interface fields; prefer `ReadonlyArray`/`ReadonlyMap`.
- **No default exports** -- use named exports everywhere.
- **Explicit return types** on exported functions.
- **TypeScript strict mode** -- no `any` without justification.
- **Services are classes with constructor injection.**
- **Commands** export a `registerXxxCommand(program, deps)` function.
- **Path-scoped query commands** (context, constraints, rejected, directives, tested) use the shared pipeline in `src/commands/helpers/path-query.ts`.
- All git interaction goes through `IGitClient`.
- All output goes through `IOutputFormatter`.

## Key Design Patterns

- **Strategy** -- `IOutputFormatter` with `TextFormatter`/`JsonFormatter`; selected at runtime via `getFormatter()` factory.
- **Adapter** -- `GitClient` wraps the git CLI behind the stable `IGitClient` interface.
- **Repository** -- `AtomRepository` is the central query engine for retrieving `LoreAtom` objects from git history.
- **Composition Root** -- `main.ts` owns all wiring (DIP).
- **Template Method (via composition)** -- `executePathQuery()` in `path-query.ts` is a shared six-step pipeline parameterized by `visibleTrailers`.

## Testing

- Unit tests in `tests/` mirror the `src/` directory structure.
- Mock `IGitClient` for service tests -- never mock `child_process` directly.
- Use vitest (`describe`, `it`, `expect`, `vi`).
- Test services through their public interface, not internal methods.
- Every new feature or bug fix must include tests.

## What NOT to Do

- Do not import concrete service classes in other services -- depend on interfaces.
- Do not add git format strings in `AtomRepository` -- `GitClient` owns the format.
- Do not use `process.exit()` -- set `process.exitCode` instead.
- Do not use null bytes in git command arguments (Node.js rejects them).
- Do not parse `process.argv` directly in commands -- use Commander's parsed args.
- Do not instantiate services outside `main.ts`.

## Adding a New Command

1. Create `src/commands/your-command.ts` exporting `registerYourCommand(program, deps)`.
2. Register it in `main.ts` with its dependency bag.
3. Add tests under `tests/`.

## Adding a New Trailer Type

1. Add the key to `TrailerKey` in `src/types/domain.ts`.
2. Add the field to `LoreTrailers` in `src/types/domain.ts`.
3. Add the key to `LORE_TRAILER_KEYS` in `src/util/constants.ts`.
4. Add to `ARRAY_TRAILER_KEYS` or `ENUM_TRAILER_KEYS` as appropriate.
5. Update `TrailerParser`, `CommitBuilder`, both formatters, and add tests.
