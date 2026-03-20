# Lore CLI

**Structured decision context in git commits -- queryable by humans and AI agents.**

Implements the [Lore protocol](https://arxiv.org/abs/2603.15566) from the paper *"Lore: Repurposing Git Commit Messages as a Structured Knowledge Protocol for AI Coding Agents"* by Ivan Stetsenko.

## The Problem

Every codebase accumulates a **Decision Shadow** -- the reasoning behind *why* code exists in its current form. Why was this approach chosen? What alternatives were rejected? What constraints apply? This knowledge lives in developers' heads, gets lost in Slack threads, and vanishes when people leave.

AI coding agents suffer most. They see *what* the code does but not *why*, leading them to repeat rejected approaches, violate undocumented constraints, and undo intentional decisions.

## The Solution

Lore encodes decision context directly into git commit messages using **native git trailers** -- key-value pairs that git already supports. No extra files, no external databases, no separate tools. The knowledge lives where the code lives and travels with it.

```
feat(auth): switch session store from JWT to server-side sessions

Client-side JWTs leaked user roles into browser storage.
Server-side sessions let us revoke access instantly on permission changes.

Lore-id: a1b2c3d4
Constraint: must support horizontal scaling -- use Redis-backed store
Constraint: session TTL must not exceed 24h per compliance policy
Rejected: JWT with short expiry | still leaks roles to client
Rejected: encrypted JWT | adds decryption overhead on every request
Confidence: high
Scope-risk: wide
Reversibility: migration-needed
Directive: do not cache session objects at the application layer
Tested: concurrent session creation under load
Not-tested: Redis failover behavior
Supersedes: f7e8d9c0
```

This commit is now a queryable knowledge atom. Any developer or AI agent can ask: *"What constraints apply to the auth module?"* and get a precise, structured answer.

## Install

```sh
npm install -g lore-cli
```

Requires Node.js >= 18.

## Quick Start

### 1. Initialize Lore in your repository

```sh
cd your-repo
lore init
```

Creates `.lore/config.toml` with default settings.

### 2. Make a Lore-enriched commit

Stage your changes, then:

```sh
# Interactive mode -- walks you through each trailer
lore commit -i

# Or use flags directly
lore commit \
  --intent "refactor: extract validation into dedicated service" \
  --constraint "must remain synchronous -- called in hot path" \
  --rejected "class-validator decorators | too much magic for simple checks" \
  --confidence high \
  --scope-risk narrow \
  --tested "unit tests for all validation rules"

# Or pipe JSON (ideal for AI agents)
echo '{"intent":"fix: handle null user in auth middleware","trailers":{"Constraint":["must not throw -- return 401 instead"],"Confidence":"high"}}' | lore commit
```

### 3. Query decision context

```sh
# Full context for a file or directory
lore context src/services/auth.ts

# What constraints apply?
lore constraints src/services/

# What was rejected and why?
lore rejected src/services/auth.ts

# Why does this specific line exist?
lore why src/services/auth.ts:42

# Search across all lore
lore search --text "session" --confidence high
```

## Commands

| Command | Description |
|---------|-------------|
| `lore init` | Initialize `.lore/` config in repository |
| `lore commit` | Create a Lore-enriched commit |
| `lore context <target>` | Full lore summary for a code region |
| `lore constraints <target>` | Active constraints for a code region |
| `lore rejected <target>` | Previously rejected alternatives for a code region |
| `lore directives <target>` | Active forward-looking warnings for a code region |
| `lore tested <target>` | Test coverage: what was and was not verified |
| `lore why <target>` | Line-level blame with Lore context (`file:line` or `file:line-line`) |
| `lore search` | Search across all lore with filters |
| `lore log` | Lore-enriched git log |
| `lore stale [target]` | Flag potentially outdated knowledge |
| `lore trace <lore-id>` | Trace decision chain via references (Supersedes, Depends-on, Related) |
| `lore validate [range]` | Validate commits for Lore protocol compliance |
| `lore squash <range>` | Merge Lore atoms from a revision range for squash merges |
| `lore doctor` | Health checks: config validity, ID uniqueness, reference integrity |

### Global Options

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON (shorthand for `--format json`) |
| `--format <type>` | Output format: `text` (default) or `json` |
| `--no-color` | Disable colored output |
| `--limit <n>` | Limit number of results |
| `--since <ref>` | Only consider commits since ref/date |

## Trailer Vocabulary

Every Lore-enriched commit carries a `Lore-id` and any combination of these trailers:

| Trailer | Cardinality | Values | Semantics |
|---------|-------------|--------|-----------|
| `Lore-id` | exactly 1 | 8-char hex (e.g. `a1b2c3d4`) | Unique identifier for this knowledge atom |
| `Constraint` | 0..n | free text | Hard requirement that must hold. Violations are bugs. |
| `Rejected` | 0..n | `alternative \| reason` | Approach that was considered and deliberately not taken |
| `Confidence` | 0..1 | `low`, `medium`, `high` | Author's confidence this is the right approach |
| `Scope-risk` | 0..1 | `narrow`, `moderate`, `wide` | Blast radius of the change |
| `Reversibility` | 0..1 | `clean`, `migration-needed`, `irreversible` | How hard it is to undo this decision |
| `Directive` | 0..n | free text | Forward-looking instruction for future maintainers |
| `Tested` | 0..n | free text | What was verified before committing |
| `Not-tested` | 0..n | free text | What was explicitly *not* verified (known gaps) |
| `Supersedes` | 0..n | Lore-id | This atom replaces a previous decision |
| `Depends-on` | 0..n | Lore-id | This atom requires another atom to hold |
| `Related` | 0..n | Lore-id | Informational link to another atom |

## Configuration

`lore init` creates `.lore/config.toml`:

```toml
[protocol]
version = "1.0"

[trailers]
required = []          # Trailers every commit must include, e.g. ["Constraint", "Confidence"]
custom = []            # Additional trailer keys beyond the standard set

[validation]
strict = false         # Treat warnings as errors in lore validate
max_message_lines = 50
intent_max_length = 72

[stale]
older_than = "6m"      # Age threshold for staleness detection
drift_threshold = 20   # File-change threshold for staleness detection

[output]
default_format = "text"

[follow]
max_depth = 3          # Max depth for reference traversal (trace, depends-on chains)
```

## Output Formats

**Text** (default) -- human-readable, colored in terminals:

```sh
lore context src/services/auth.ts
```

**JSON** -- structured output for AI agents and scripts:

```sh
lore context src/services/auth.ts --json
```

All commands support both formats. Use `--json` for programmatic consumption.

## For AI Agents

Lore is designed with AI coding agents as first-class consumers. Before modifying code, an agent should query:

```sh
# What constraints must I respect?
lore constraints src/services/auth.ts --json

# What approaches were already tried and rejected?
lore rejected src/services/auth.ts --json

# What should I be careful about?
lore directives src/services/auth.ts --json
```

When committing, agents produce structured input via JSON on stdin:

```sh
echo '{
  "intent": "fix: handle expired sessions gracefully",
  "body": "Previously threw 500 on expired session. Now returns 401 with clear message.",
  "trailers": {
    "Constraint": ["must not log session tokens"],
    "Rejected": ["silent redirect to login | breaks API clients"],
    "Confidence": "high",
    "Scope-risk": "narrow",
    "Tested": ["expired session returns 401", "valid session still works"],
    "Not-tested": ["concurrent session expiry race condition"]
  }
}' | lore commit
```

## Paper

> Ivan Stetsenko. *Lore: Repurposing Git Commit Messages as a Structured Knowledge Protocol for AI Coding Agents.* arXiv:2603.15566, 2025.

Read the full paper: [https://arxiv.org/abs/2603.15566](https://arxiv.org/abs/2603.15566)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture overview, and guidelines.

## License

[MIT](LICENSE) -- Ivan Stetsenko, 2026
