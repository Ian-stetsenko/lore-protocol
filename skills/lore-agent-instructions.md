# Lore Protocol -- Agent Instructions

Lore embeds structured decision context (constraints, rejected alternatives, directives) into git commit trailers. Before modifying code, query Lore. When committing, write Lore.

**Protocol version:** 1.0

---

## 1. Before Modifying Code

Before changing any file, query Lore for that file or directory. This prevents you from repeating rejected approaches, violating constraints, or undoing intentional decisions.

### Commands to Run

```sh
# What constraints must I respect?
lore constraints <path> --json

# What approaches were already tried and rejected?
lore rejected <path> --json

# What forward-looking instructions exist?
lore directives <path> --json

# Full context (all of the above plus confidence, test notes, references)
lore context <path> --json
```

`<path>` is the file or directory you are about to modify. Use `--json` for structured output.

### How to Interpret Results

| Trailer | What It Means | What You Must Do |
|---------|---------------|------------------|
| **Constraint** | A hard requirement that must hold. Violations are bugs. | **Obey it.** Do not write code that violates a constraint. |
| **Rejected** | An approach that was tried and deliberately abandoned. Format: `alternative \| reason`. | **Do not re-explore it** unless circumstances have explicitly changed. |
| **Directive** | A forward-looking instruction from a past decision-maker. | **Follow it.** Treat as a standing order. |
| **Confidence** | How confident the author was (`low`, `medium`, `high`). | Low confidence = the decision may be worth revisiting. High = leave it alone unless you have strong reason. |
| **Scope-risk** | Blast radius (`narrow`, `moderate`, `wide`). | Wide scope-risk = be extra careful, test thoroughly. |
| **Reversibility** | How hard to undo (`clean`, `migration-needed`, `irreversible`). | Irreversible = do not change without explicit user approval. |
| **Not-tested** | Known gaps in test coverage. | Be aware these areas may break silently. |
| **Supersedes** | This atom replaced a previous decision (by Lore-id). | The superseded decision is obsolete -- ignore it. |

### Query Workflow

1. Identify the files you will modify.
2. Run `lore constraints <path> --json` and `lore rejected <path> --json` for each.
3. If any constraints apply, verify your planned changes respect them.
4. If any rejected alternatives match what you were about to do, stop and choose a different approach.
5. Run `lore directives <path> --json` and follow any instructions found.

---

## 2. When Committing Code

After making changes, create a Lore-enriched commit by piping JSON to `lore commit`.

### JSON Schema

```json
{
  "intent": "string (REQUIRED) -- why the change was made, max 72 chars",
  "body": "string (optional) -- narrative context, multiple lines allowed",
  "trailers": {
    "Constraint": ["string array -- hard requirements that must hold"],
    "Rejected": ["string array -- format: 'alternative | reason'"],
    "Confidence": "enum: 'low' | 'medium' | 'high'",
    "Scope-risk": "enum: 'narrow' | 'moderate' | 'wide'",
    "Reversibility": "enum: 'clean' | 'migration-needed' | 'irreversible'",
    "Directive": ["string array -- instructions for future maintainers"],
    "Tested": ["string array -- what was verified"],
    "Not-tested": ["string array -- known untested areas"],
    "Supersedes": ["string array -- 8-char hex Lore-ids this replaces"],
    "Depends-on": ["string array -- 8-char hex Lore-ids this requires"],
    "Related": ["string array -- 8-char hex Lore-ids for reference"]
  }
}
```

All trailer fields are optional. Only `intent` is required. Include trailers that are relevant -- do not pad with empty values.

### Commit Command

Stage your changes with `git add`, then pipe JSON to `lore commit`:

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

A `Lore-id` is generated automatically -- do not include one.

### What to Include in Trailers

| Situation | Trailers to Add |
|-----------|----------------|
| You chose approach A over B | `Rejected: ["B \| reason"]` |
| There is a rule future code must follow | `Constraint: ["the rule"]` |
| There is something the next developer should know | `Directive: ["the instruction"]` |
| You are not sure this is the right approach | `Confidence: "low"` or `"medium"` |
| The change affects many files/systems | `Scope-risk: "wide"` |
| The change is hard to undo | `Reversibility: "migration-needed"` or `"irreversible"` |
| You tested specific scenarios | `Tested: ["scenario 1", "scenario 2"]` |
| You know something is untested | `Not-tested: ["the gap"]` |
| This replaces a previous decision | `Supersedes: ["<lore-id>"]` |

---

## 3. Other Useful Commands

```sh
# Why does a specific line exist?
lore why <file>:<line> --json

# Search across all lore
lore search --text "keyword" --json

# Check for stale/outdated decisions
lore stale <path> --json

# Trace a decision chain
lore trace <lore-id> --json

# Validate recent commits for protocol compliance
lore validate HEAD~5..HEAD
```

---

## 4. Example Workflow

**Task:** "Add rate limiting to the /api/upload endpoint"

```sh
# Step 1: Query before coding
lore constraints src/routes/upload.ts --json
lore rejected src/routes/upload.ts --json
lore directives src/routes/upload.ts --json

# Step 2: Read the results
# Suppose you find:
#   Constraint: "file size validation must happen before upload starts"
#   Rejected: "client-side rate limiting | easily bypassed"
#   Directive: "all rate limits must be configurable via env vars"

# Step 3: Implement respecting what you found
# - Keep file size validation before upload (constraint)
# - Do NOT implement client-side rate limiting (rejected)
# - Make rate limits configurable via env vars (directive)

# Step 4: Stage and commit with Lore
git add src/routes/upload.ts src/middleware/rate-limit.ts

echo '{
  "intent": "feat: add server-side rate limiting to /api/upload",
  "body": "Adds token-bucket rate limiter as Express middleware. Limits configurable via UPLOAD_RATE_LIMIT and UPLOAD_RATE_WINDOW env vars.",
  "trailers": {
    "Constraint": ["rate limit values must come from env vars, not hardcoded"],
    "Rejected": ["per-IP limiting only | fails behind shared NAT, need auth-based limiting too"],
    "Confidence": "high",
    "Scope-risk": "narrow",
    "Tested": ["rate limit triggers 429 after threshold", "authenticated vs anonymous limits differ"],
    "Not-tested": ["behavior under Redis connection failure"]
  }
}' | lore commit
```

---

## 5. Quick Reference

| Action | Command |
|--------|---------|
| Query constraints | `lore constraints <path> --json` |
| Query rejected approaches | `lore rejected <path> --json` |
| Query directives | `lore directives <path> --json` |
| Full context | `lore context <path> --json` |
| Line-level blame | `lore why <file>:<line> --json` |
| Commit with Lore | `echo '<json>' \| lore commit` |
| Search all lore | `lore search --text "query" --json` |
| Check staleness | `lore stale <path> --json` |
| Validate commits | `lore validate <range>` |
