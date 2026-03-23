# Lore Protocol -- Agent Instructions

Copy this into your AI agent's system prompt or instruction file.

---

## What Is Lore

Lore embeds structured decision context (constraints, rejected alternatives, directives) into git commit trailers. It is queryable via the `lore` CLI. Protocol version: 1.0.

## Before Modifying Any File

Run these commands for every file or directory you are about to change:

```sh
lore constraints <path> --json
lore rejected <path> --json
lore directives <path> --json
```

- **Constraint** = hard requirement. Do not violate.
- **Rejected** = approach tried and abandoned (`alternative | reason`). Do not re-explore.
- **Directive** = standing instruction. Follow it.

If constraints exist, verify your changes comply. If a rejected alternative matches your plan, choose differently.

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
  "intent": "string (REQUIRED) -- max 72 chars",
  "body": "string (optional)",
  "trailers": {
    "Constraint": ["string array"],
    "Rejected": ["format: 'alternative | reason'"],
    "Confidence": "'low' | 'medium' | 'high'",
    "Scope-risk": "'narrow' | 'moderate' | 'wide'",
    "Reversibility": "'clean' | 'migration-needed' | 'irreversible'",
    "Directive": ["string array"],
    "Tested": ["string array"],
    "Not-tested": ["string array"],
    "Supersedes": ["8-char hex Lore-id"],
    "Depends-on": ["8-char hex Lore-id"],
    "Related": ["8-char hex Lore-id"]
  }
}
```

Only `intent` is required. `Lore-id` is auto-generated.

### When to Add Trailers

| Situation | Trailer |
|-----------|---------|
| Chose A over B | `Rejected: ["B \| reason"]` |
| Rule must hold | `Constraint: ["the rule"]` |
| Future instruction | `Directive: ["the instruction"]` |
| Unsure | `Confidence: "low"` |
| Hard to undo | `Reversibility: "migration-needed"` |
| Known gap | `Not-tested: ["the gap"]` |

## Other Commands

| Command | Purpose |
|---------|---------|
| `lore context <path> --json` | Full context for a file/directory |
| `lore why <file>:<line> --json` | Line-level blame with Lore context |
| `lore search --text "q" --json` | Search across all lore |
| `lore stale <path> --json` | Check for outdated decisions |
| `lore trace <lore-id> --json` | Trace a decision chain |
