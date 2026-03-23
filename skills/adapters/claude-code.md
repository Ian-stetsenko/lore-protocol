# Lore Protocol Integration

This project uses the **Lore protocol** (v1.0) to embed structured decision context into git commits. Lore trailers record constraints, rejected alternatives, and directives alongside code changes. You MUST query Lore before modifying files and write Lore-enriched commits.

## Before Modifying Any File

Query the Lore context for every file or directory you are about to change:

```sh
lore constraints <path> --json
lore rejected <path> --json
lore directives <path> --json
```

**Rules:**
- **Constraint** = hard requirement. Do not write code that violates it.
- **Rejected** = approach already tried and abandoned (`alternative | reason`). Do not re-explore it.
- **Directive** = standing instruction. Follow it.

If `lore constraints` returns results for a file, verify your planned changes comply before writing code. If `lore rejected` matches your intended approach, choose a different one.

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

```json
{
  "intent": "string (REQUIRED) -- why the change was made, max 72 chars",
  "body": "string (optional) -- narrative context",
  "trailers": {
    "Constraint": ["string array -- hard requirements that must hold"],
    "Rejected": ["string array -- format: 'alternative | reason'"],
    "Confidence": "enum: 'low' | 'medium' | 'high'",
    "Scope-risk": "enum: 'narrow' | 'moderate' | 'wide'",
    "Reversibility": "enum: 'clean' | 'migration-needed' | 'irreversible'",
    "Directive": ["string array -- instructions for future maintainers"],
    "Tested": ["string array -- what was verified"],
    "Not-tested": ["string array -- known untested areas"],
    "Supersedes": ["8-char hex Lore-id array -- decisions this replaces"],
    "Depends-on": ["8-char hex Lore-id array -- decisions this requires"],
    "Related": ["8-char hex Lore-id array -- informational links"]
  }
}
```

Only `intent` is required. Include only relevant trailers -- do not pad with empty values. `Lore-id` is auto-generated.

### When to Add Trailers

- You chose approach A over B: add `Rejected`
- A rule must hold going forward: add `Constraint`
- Future developers need an instruction: add `Directive`
- You are unsure: set `Confidence` to `"low"` or `"medium"`
- Change is hard to undo: set `Reversibility`
- You left something untested: add `Not-tested`

## Other Commands

```sh
lore context <path> --json     # Full context for a file/directory
lore why <file>:<line> --json  # Line-level blame with Lore context
lore search --text "q" --json  # Search across all lore
lore stale <path> --json       # Check for outdated decisions
lore trace <lore-id> --json    # Trace a decision chain
```
