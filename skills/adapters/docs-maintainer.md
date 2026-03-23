# Lore Documentation Maintainer Skill

You are responsible for keeping the Lore Protocol documentation website in sync with the CLI implementation. The website is the official public documentation — it must accurately reflect the current state of the CLI tool.

## Source of Truth Hierarchy

1. **CLI source code** (`lore-cli/src/`) — the authoritative truth for behavior
2. **Types and constants** (`src/types/domain.ts`, `src/util/constants.ts`) — authoritative for trailer vocabulary, enums, config schema
3. **README.md** — authoritative for user-facing descriptions and examples
4. **Architecture doc** (`documents/PROJECT_ARCHITECTURE.md`) — authoritative for internal architecture

The website docs derive from these sources. When they conflict, the code wins.

## Website Structure

The website is an Astro Starlight site at `lore-website/`. Content lives in `src/content/docs/docs/`.

### Page → Source Mapping

| Website Page | Source File | Derives From |
|---|---|---|
| Introduction | `docs/introduction.md` | README.md (problem/solution sections) |
| Quick Start | `docs/quick-start.md` | README.md (install + quick start sections) |
| Protocol Fundamentals | `docs/protocol-fundamentals.md` | Paper Section 3.1 (Lore atom properties) |
| Trailer Vocabulary | `docs/trailer-vocabulary.md` | `src/types/domain.ts` (LoreTrailers interface), `src/util/constants.ts` |
| Commit Message Format | `docs/commit-format.md` | `src/services/commit-builder.ts`, `src/services/trailer-parser.ts` |
| CLI Command Overview | `docs/cli-commands.md` | `src/main.ts` (command registrations), all files in `src/commands/` |
| Path Resolution | `docs/path-resolution.md` | `src/services/path-resolver.ts` |
| Output Formats | `docs/output-formats.md` | `src/formatters/json-formatter.ts`, `src/formatters/text-formatter.ts` |
| Configuration | `docs/configuration.md` | `src/types/config.ts` (DEFAULT_CONFIG), `src/commands/init.ts` |
| Git Workflow Survival | `docs/git-workflows.md` | `src/services/squash-merger.ts`, `src/commands/squash.ts` |
| Agent Consumption Model | `docs/agent-consumption.md` | `skills/lore-agent-instructions.md`, README agent section |
| Validation & CI | `docs/validation.md` | `src/services/validator.ts`, `src/commands/validate.ts` |
| Blog posts | `docs/blog/*.md` | Release notes, announcements |

### Sidebar Configuration

Defined in `astro.config.mjs` in the `sidebar` array. When adding a new page, add it to the appropriate section.

## Sync Workflow

When asked to sync or update docs, follow this process:

### Step 1: Detect Changes

Compare the CLI source against current website docs:

```sh
# Check what changed in the CLI since docs were last updated
git log --oneline --since="<last-docs-update-date>" -- src/ README.md CHANGELOG.md

# Read the current CLI state
cat src/types/domain.ts        # Trailer types
cat src/types/config.ts        # Config schema
cat src/util/constants.ts      # Constants, enums, prompt strings
node dist/main.js --help       # Current command tree
```

### Step 2: Identify Gaps

For each website page, check:

1. **Trailer Vocabulary page** — Does it list all trailers from `LoreTrailers` interface? All enum values from constants? Any new trailers added?
2. **CLI Commands page** — Does it list all commands from `main.ts`? All options per command? Any new commands or options?
3. **Configuration page** — Does it match `DEFAULT_CONFIG`? All config keys? Snake_case TOML key names?
4. **Output Formats page** — Does the JSON schema match `JsonFormatter` output? Field names correct?
5. **Quick Start page** — Do the examples still work? Install command correct?
6. **Agent Consumption page** — Does it match `skills/lore-agent-instructions.md`?

### Step 3: Update Pages

For each page that needs updating:

1. Read the current website page
2. Read the corresponding CLI source files
3. Update the page content to match the CLI
4. Preserve the Starlight frontmatter (title, description)
5. Preserve the page structure and writing style

### Step 4: Version Tracking

After updating, add a comment at the bottom of each updated page:

```md
<!-- Synced with lore-cli at commit <short-hash> on <date> -->
```

## Writing Style Guide

- **Voice**: Direct, technical, practical. No marketing language.
- **Code examples**: Must be copy-pasteable and correct. Test them against the built CLI.
- **Structure**: Lead with usage, then explain. Users scan for commands first.
- **Links**: Use relative links between docs pages. Link to GitHub for source references.
- **Frontmatter**: Every page needs `title` and `description` in YAML frontmatter.

## Content Rules

### Trailer Vocabulary Page

Must include for each trailer:
- Name (exact casing, e.g., `Scope-risk`)
- Cardinality (exactly 1, 0..1, 0..n)
- Allowed values (for enums) or format (for free text)
- Semantics (what it means)
- Example usage

Source: `src/types/domain.ts` lines defining `LoreTrailers`, plus `src/util/constants.ts` for enum values.

### CLI Commands Page

Must include for each command:
- Command syntax with all arguments
- Description
- All options with types and defaults
- At least one example (text output and JSON output)
- Which trailers/features it relates to

Source: Each file in `src/commands/`, specifically the Commander `.command()`, `.option()`, and `.description()` calls.

### Configuration Page

Must show:
- Full `config.toml` with every key
- Default values (from `DEFAULT_CONFIG` in `src/types/config.ts`)
- Both snake_case TOML keys and camelCase internal names
- Monorepo merging behavior
- What each config key controls

### Output Formats Page

Must show:
- Text output example for at least `context` and `validate`
- JSON output example matching the exact schema from `JsonFormatter`
- Field name mapping (the JSON uses snake_case: `lore_id`, `commit`, etc.)

### Agent Consumption Page

Must cover:
- Discovery (`lore init`, `lore --help`)
- Pre-modification queries (`constraints`, `rejected`, `directives`)
- The three behavioral rules (Constraint = obey, Rejected = don't re-explore, Directive = follow)
- Commit creation via JSON stdin
- The JSON input schema
- Link to the `skills/` directory for drop-in agent setup

## Adding a New Doc Page

1. Create the file at `src/content/docs/docs/<slug>.md` with frontmatter
2. Add it to the sidebar in `astro.config.mjs`
3. Add it to the Page → Source Mapping table above

## Versioning Docs for Releases

When a new CLI version is released:

1. Update `docs/quick-start.md` install command if the package name changed
2. Update all examples to use current CLI output
3. Add a blog post at `src/content/docs/blog/` with:
   - Release version and date
   - What's new (features, fixes)
   - Migration notes if breaking changes
   - Author frontmatter: `authors: [ivan]`
4. Update the CHANGELOG.md in the CLI repo
5. Commit sync markers on all updated pages
