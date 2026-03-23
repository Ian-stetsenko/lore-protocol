# Lore Protocol Integration

This project uses the **Lore protocol** (v1.0) to embed structured decision context into git commits. Before modifying code, query Lore. When committing, write Lore.

## Before Modifying Any File

Run these shell commands for every file you are about to change:

```sh
lore constraints <path> --json
lore rejected <path> --json
lore directives <path> --json
```

**Constraint** = hard requirement, do not violate. **Rejected** = approach tried and abandoned (`alternative | reason`), do not re-explore. **Directive** = standing instruction, follow it.

## When Committing

Aider manages its own commits. When you produce a commit message, format it as a Lore-enriched message. Alternatively, after Aider commits, run a Lore commit separately:

```sh
echo '{
  "intent": "fix: handle null user in auth middleware",
  "body": "Previously threw 500 on null user. Now returns 401.",
  "trailers": {
    "Constraint": ["must not throw -- return 401 instead"],
    "Rejected": ["silent redirect to login | breaks API clients"],
    "Confidence": "high",
    "Scope-risk": "narrow",
    "Tested": ["null user returns 401", "valid user still works"],
    "Not-tested": ["concurrent request race condition"]
  }
}' | lore commit
```

### JSON Schema

- `intent` (string, REQUIRED): why the change was made, max 72 chars
- `body` (string, optional): narrative context
- `trailers` (object, optional):
  - `Constraint`: string[] -- hard requirements
  - `Rejected`: string[] -- format `alternative | reason`
  - `Confidence`: `"low"` | `"medium"` | `"high"`
  - `Scope-risk`: `"narrow"` | `"moderate"` | `"wide"`
  - `Reversibility`: `"clean"` | `"migration-needed"` | `"irreversible"`
  - `Directive`: string[] -- future instructions
  - `Tested`: string[] -- verified scenarios
  - `Not-tested`: string[] -- known gaps
  - `Supersedes`: string[] -- 8-char hex Lore-ids replaced
  - `Depends-on`: string[] -- 8-char hex Lore-ids required
  - `Related`: string[] -- 8-char hex Lore-ids for reference

Only `intent` is required. Include only relevant trailers. `Lore-id` is auto-generated.

## Integration with Aider Configuration

Add this to your `.aider.conf.yml` to load Lore instructions:

```yaml
read:
  - .aider/lore-instructions.md
```

Then place this file at `.aider/lore-instructions.md` in your project.

## Other Commands

```sh
lore context <path> --json     # Full context
lore why <file>:<line> --json  # Line-level blame
lore search --text "q" --json  # Search all lore
lore stale <path> --json       # Outdated decisions
```
