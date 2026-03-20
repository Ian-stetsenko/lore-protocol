# Contributing to Lore CLI

Thanks for your interest in contributing. This guide covers development setup, architecture, and guidelines.

## Development Setup

```sh
# Clone the repository
git clone https://github.com/Ian-stetsenko/lore-protocol.git
cd lore-protocol

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Type-check without emitting
npm run typecheck
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Build with tsup |
| `npm run dev` | Build in watch mode |
| `npm test` | Run tests with vitest |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint with eslint |
| `npm run format` | Format with prettier |
| `npm run typecheck` | Type-check with tsc |

## Architecture

The codebase follows a layered architecture with strict dependency direction: lower layers never import from higher layers.

```
main.ts (composition root)
  |
  +-- commands/          CLI command handlers (one file per command)
  |     |
  |     +-- helpers/     Shared command logic (e.g., path-query pattern)
  |
  +-- formatters/        Output formatting (text, JSON)
  |
  +-- services/          Core business logic
  |
  +-- interfaces/        Abstractions (ports)
  |
  +-- types/             Domain types, config, query/output shapes
  |
  +-- util/              Constants, errors, helpers
```

### Key Design Decisions

- **Dependency Injection via Composition Root**: `main.ts` is the only file that instantiates concrete implementations. All other code depends on interfaces. This makes testing straightforward and keeps coupling low.

- **Interface Segregation**: Services depend on narrow interfaces (`IGitClient`, `IConfigLoader`, `IOutputFormatter`), not on concrete classes.

- **One Command per File**: Each CLI command lives in its own file under `src/commands/`. Commands are thin -- they parse options, call services, and format output.

- **Formatter Abstraction**: All output goes through `IOutputFormatter`. Text and JSON formatters implement the same interface, so `--json` works on every command without per-command logic.

## How to Add a New Command

1. **Create the command file** at `src/commands/your-command.ts`:

```typescript
import type { Command } from 'commander';

export function registerYourCommand(
  program: Command,
  deps: {
    // Declare your dependencies here
  },
): void {
  program
    .command('your-command <arg>')
    .description('One-line description')
    .option('--flag <value>', 'Description')
    .action(async (arg: string, options) => {
      // Implementation
    });
}
```

2. **Register it in `main.ts`**:
   - Import the register function
   - Call it with the program and its dependencies

3. **Add tests** under `tests/`.

## How to Add a New Trailer Type

The standard trailer vocabulary is defined in the Lore protocol paper. Custom trailers can be added via config without code changes:

```toml
[trailers]
custom = ["My-trailer"]
```

If you're extending the *protocol-level* trailer set (requires paper discussion):

1. Add the key to `TrailerKey` in `src/types/domain.ts`
2. Add the field to `LoreTrailers` in `src/types/domain.ts`
3. Add the key to `LORE_TRAILER_KEYS` in `src/util/constants.ts`
4. If it's an array trailer, add to `ARRAY_TRAILER_KEYS`; if enum, add to `ENUM_TRAILER_KEYS`
5. Update `TrailerParser` to handle parsing/serialization
6. Update `CommitBuilder` to accept and validate the new trailer
7. Update both formatters (`TextFormatter`, `JsonFormatter`)
8. Add tests for parsing, building, and formatting

## Testing

Tests use [vitest](https://vitest.dev/). Run them with:

```sh
# Run all tests
npm test

# Run in watch mode during development
npm run test:watch

# Run a specific test file
npx vitest run tests/services/trailer-parser.test.ts
```

### Test Guidelines

- Place tests in `tests/` mirroring the `src/` directory structure
- Test services through their public interface, not internal methods
- Mock external dependencies (git, filesystem) via the interface boundaries
- Every new feature or bug fix should include tests

## Pull Request Guidelines

- **One concern per PR.** A single bug fix, a single feature, or a single refactor. Don't mix.
- **Tests required.** PRs without tests for new behavior will be asked to add them.
- **Build must pass.** Run `npm run build && npm run typecheck && npm test` before submitting.
- **Clear description.** Explain *what* changed and *why*. If it closes an issue, reference it.
- **Small diffs preferred.** If your change is large, consider splitting it into a stack of PRs.

## Code Style

- **Prettier** handles formatting. Run `npm run format` before committing.
- **ESLint** handles linting. Run `npm run lint` to check.
- **TypeScript strict mode** is enabled. No `any` without justification.
- **Readonly by default.** Use `readonly` on interface fields and prefer `ReadonlyArray` / `ReadonlyMap`.
- **Explicit return types** on exported functions.
- **No default exports.** Use named exports everywhere.

## Reporting Issues

- **Bugs**: Use the [bug report template](https://github.com/Ian-stetsenko/lore-protocol/issues/new?template=bug_report.md)
- **Features**: Use the [feature request template](https://github.com/Ian-stetsenko/lore-protocol/issues/new?template=feature_request.md)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
