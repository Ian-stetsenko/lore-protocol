# Lore Protocol Integration

This project uses the **Lore protocol** (v1.0) to embed structured decision context into git commits. Constraints, rejected alternatives, and directives are stored as git trailers and queryable via the `lore` CLI.

## Before Modifying Any File

Run these commands in the terminal for every file or directory you are about to change:

```sh
lore constraints <path> --json
lore rejected <path> --json
lore directives <path> --json
```

**Rules:**
- **Constraint** = hard requirement. Do not write code that violates it.
- **Rejected** = approach already tried and abandoned (`alternative | reason`). Do not re-explore it.
- **Directive** = standing instruction from a past decision. Follow it.

If constraints exist for a file, verify your changes comply before writing code. If a rejected alternative matches your intended approach, choose a different one.

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
  - `Constraint`: string[] -- hard requirements that must hold
  - `Rejected`: string[] -- format `alternative | reason`
  - `Confidence`: `"low"` | `"medium"` | `"high"`
  - `Scope-risk`: `"narrow"` | `"moderate"` | `"wide"`
  - `Reversibility`: `"clean"` | `"migration-needed"` | `"irreversible"`
  - `Directive`: string[] -- instructions for future maintainers
  - `Tested`: string[] -- what was verified
  - `Not-tested`: string[] -- known untested areas
  - `Supersedes`: string[] -- 8-char hex Lore-ids this replaces
  - `Depends-on`: string[] -- 8-char hex Lore-ids this requires
  - `Related`: string[] -- 8-char hex Lore-ids for reference

Only `intent` is required. Include only relevant trailers. `Lore-id` is auto-generated.

### When to Add Trailers

- You chose approach A over B: `Rejected: ["B | reason"]`
- A rule must hold going forward: `Constraint: ["the rule"]`
- Future developers need an instruction: `Directive: ["the instruction"]`
- You are unsure this is right: `Confidence: "low"` or `"medium"`
- Change is hard to undo: `Reversibility: "migration-needed"` or `"irreversible"`
- You left something untested: `Not-tested: ["the gap"]`

## Other Commands

```sh
lore context <path> --json     # Full context for a file/directory
lore why <file>:<line> --json  # Line-level blame with Lore context
lore search --text "q" --json  # Search across all lore
lore stale <path> --json       # Check for outdated decisions
lore trace <lore-id> --json    # Trace a decision chain
```
