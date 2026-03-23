# Lore Protocol Integration

This project uses the **Lore protocol** (v1.0) to embed structured decision context into git commits. Constraints, rejected alternatives, and directives are stored as git trailers and queryable via the `lore` CLI.

## Before Modifying Any File

Run these commands for every file or directory you are about to change:

```sh
lore constraints <path> --json
lore rejected <path> --json
lore directives <path> --json
```

**Rules:**
- **Constraint** = hard requirement. Do not write code that violates it.
- **Rejected** = approach already tried and abandoned (`alternative | reason`). Do not re-explore it.
- **Directive** = standing instruction. Follow it.

## When Committing

Stage changes with `git add`, then pipe JSON to `lore commit`:

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

### When to Add Trailers

- Chose approach A over B: `Rejected: ["B | reason"]`
- Rule must hold: `Constraint: ["the rule"]`
- Instruction for future: `Directive: ["the instruction"]`
- Unsure: `Confidence: "low"`
- Hard to undo: `Reversibility: "migration-needed"`
- Left untested: `Not-tested: ["the gap"]`

## Other Commands

```sh
lore context <path> --json     # Full context
lore why <file>:<line> --json  # Line-level blame
lore search --text "q" --json  # Search all lore
lore stale <path> --json       # Outdated decisions
```
