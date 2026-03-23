# Agent Skill Files

Pre-built instruction files that teach AI coding agents to use the Lore protocol. Copy the right file into your project and your agent will automatically query Lore before modifying code and write Lore-enriched commits.

## Quick Setup

Pick your agent, copy one file:

| Agent | Source File | Destination in Your Project |
|-------|-------------|----------------------------|
| **Claude Code** | `adapters/claude-code.md` | Append to your `CLAUDE.md` |
| **Cursor** | `adapters/cursor.mdc` | `.cursor/rules/lore.mdc` |
| **GitHub Copilot** | `adapters/github-copilot.md` | `.github/copilot-instructions.md` (append if exists) |
| **Windsurf** | `adapters/windsurf.md` | `.windsurfrules` (append if exists) |
| **Aider** | `adapters/aider.md` | `.aider/lore-instructions.md` + add to `.aider.conf.yml` |
| **Any other agent** | `adapters/generic.md` | Paste into system prompt or instruction file |

## What Each File Does

Every adapter tells the agent:

1. **Query before modifying** -- run `lore constraints`, `lore rejected`, and `lore directives` for files being changed
2. **Respect what it finds** -- constraints are inviolable, rejected approaches are off-limits, directives are standing orders
3. **Commit with Lore** -- pipe JSON to `lore commit` with the right trailers
4. **The JSON schema** -- exact format for `lore commit` stdin input

## Universal Reference

`lore-agent-instructions.md` is the comprehensive reference document. It covers everything an agent needs to know about Lore in detail. Use it if:

- You want to understand the full protocol before picking an adapter
- Your agent platform is not listed above
- You want to build your own custom adapter

The platform adapters are streamlined versions of this document, formatted for each platform's conventions.

## Example: Claude Code

```sh
# From your project root (assuming lore-cli is installed globally)
cat /path/to/lore-cli/skills/adapters/claude-code.md >> CLAUDE.md
```

## Example: Cursor

```sh
mkdir -p .cursor/rules
cp /path/to/lore-cli/skills/adapters/cursor.mdc .cursor/rules/lore.mdc
```

## Example: GitHub Copilot

```sh
mkdir -p .github
cat /path/to/lore-cli/skills/adapters/github-copilot.md >> .github/copilot-instructions.md
```
