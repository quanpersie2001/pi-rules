# pi-rules roadmap

This document tracks planned and completed work. The driving goal is a **phase-aware rule injection model**: rules should reach the agent at the right moment (planning, exploration, editing) without flooding context, and critical rules must be guaranteed before a write ever runs.

**Positioning:** pi-rules is the **path-scoped project rules** extension for Pi. It discovers `.pi/rules/**/*.md`, matches rules to the files an agent is working on, injects relevant guidance, guards writes against missing rules, and lets agents recommend rule updates for user approval. It is *not* a linter, formatter, or static-analysis enforcer — rules are guidance injected into the agent context, not checks that reject files on disk.

## Guiding principles

- **Right rule, right time.** Full bodies belong at planning and edit time, not during every exploration read.
- **Never write blind.** A critical rule (`guard: true`) must be in context before `write`/`edit` is allowed to execute.
- **Opt-in by default.** New policy knobs (`writeGuardEnabled`, `dynamicInjection`) ship off or backward-compatible so existing users see no behavior change until they enable it.
- **Config follows the same ladder everywhere.** `defaults < global config < project config < env vars < CLI flags`.

## Now (maintain)

- Keep the two-tool (`create_rule`, `pi_rules_recommend`) and twelve-command surface stable. New policy lives in the narrowest layer: `app/config.ts` for knobs, `pi/index.ts` for event wiring, `pi/commands.ts` for interactive config.
- Run `npm run check` (Biome, `tsc`, depcruise, Vitest, build) before every release.
- When adding a config field, update the README config table, `DEFAULT_CONFIG`, `readConfigFromEnv`, `readConfigFromFiles`, and `normalizeConfigObject` together — the ladder only holds if all readers agree.

## Completed — phase-aware injection & guard (unreleased)

The work below moves pi-rules from "inject everything aggressively" toward a model where exploration is quiet and writes are guarded.

| Priority | Item | Outcome | Status |
| --- | --- | --- | --- |
| P1 | **`guard` frontmatter** | New `guard: true` field marks critical path-scoped rules; parsed in `domain/parser.ts`, typed in `domain/types.ts`. | Done |
| P1 | **Write/edit guard via `tool_call`** | `pi.on("tool_call", ...)` intercepts `write`/`edit` before execution; if a matching `guard` rule hasn't been injected, the call is blocked and the rule is returned in the `reason`. | Done |
| P1 | **Full-injection tracking** | `RulesEngine.wasFullInjected()` records which guarded rules have been shown, so a retried write passes without re-blocking. | Done |
| P2 | **Dynamic injection toggle** | New `dynamicInjection: "off" \| "full"` config; `"off"` stops appending full rule bodies to every `read`/`grep`/`find` result while still tracking hot paths for later static injection. | Done |
| P2 | **Persistent config files** | Global `~/.pi/agent/pi-rules.json` and project `.pi/pi-rules.json`, read by `readConfigFromFiles()`; `writeProjectConfigPatch()` supports non-destructive updates. | Done |
| P2 | **Interactive config commands** | `/pi-rules:mode` and `/pi-rules:write-guard` open a TUI selector when called without args, or set directly from args (`/pi-rules:mode static`, `/pi-rules:write-guard on`). | Done |
| P3 | **Flag / config precedence fix** | `readFlags()` now only returns values that differ from `DEFAULT_CONFIG`, so a registered flag default can't silently override a project config file. | Done |

**What this unlocks for users:** a low-noise, guarded policy is now expressible in a project file instead of a long CLI invocation:

```json
{
  "mode": "static",
  "dynamicInjection": "off",
  "writeGuardEnabled": true
}
```

## Next (high value, in scope)

| Priority | Item | Outcome | Status |
| --- | --- | --- | --- |
| P1 | **Bash mutation guard** | Extend `tool_call` guard to `bash`. Detect mutating commands (`rm`, `rmdir`, `mv`, `cp`, `>`, `>>`, `sed -i`, `perl -pi`, `git restore`, `git checkout --`, `truncate`, `dd of=`) and block when the target path matches an uninjected `guard` rule. Reuses `extractRemovedPaths()` plus a new redirect-write extractor. | Planned |
| P2 | **Phase-aware exposure levels** | Replace binary `dynamicInjection` with `hint \| summary \| full`: exploration returns a one-line pointer, planning injects the body. Requires `formatRuleHints()` / `formatRuleSummaries()` in `domain/formatter.ts` and per-level injection tracking in `domain/engine.ts`. | Planned |
| P2 | **Severity-based guard** | `severity: critical` blocks writes (current behavior); `severity: warning` injects a one-line note but does not block. | Planned |
| P3 | **Staleness detection in guard** | When the guard blocks, surface any pending recommendation for the matched rule so the agent knows the rule may be outdated before retrying the write. | Planned |

## Later (explicit opt-in / separate concerns)

| Item | Notes |
| --- | --- |
| **Planning-phase explicit load** | A `load_rules_for_paths` tool the agent calls once it has chosen target files, so full rules arrive at planning time rather than only at static or guard time. |
| **Inventory auto-read** | When a matched rule references a sibling `inventory.md`, optionally auto-read it on first match instead of only listing it as available. |
| **Guard audit log** | Record guard blocks in `.pi/.pi-rules/guard-log.jsonl` (path, rule, timestamp) for debugging why writes were deferred. |
| **Context prune on compact** | Strip previously injected rule bodies from `session_compact` summaries to keep long sessions lean. |

## Out of scope (by design)

- **Linting and formatting.** Rules describe conventions to the agent; they never run static analysis or reject files.
- **Auto-applying recommendations.** Agents create recommendations; users approve them. This stays true even as guard policy evolves.
- **Rule enforcement on disk.** pi-rules never reverts or rejects a completed write — the guard only guarantees the agent has *seen* the rule before the tool call runs.
- **Generic documentation generator.** Use the `init-advanced` skill to bootstrap; pi-rules maintains rules, it does not author them autonomously.

## Coexistence with native context files

`AGENTS.md` and `CLAUDE.md` are loaded natively by Pi. Rules live under `.pi/rules/**/*.md`. When both exist:

| Source | Handling |
| --- | --- |
| `AGENTS.md` / `CLAUDE.md` | Loaded by Pi as native context files. |
| `.pi/rules/**/*.md` | Matched by pi-rules and injected by path / trigger / guard. |
| Overlap | `matchRulesForPathsStatic` skips any rule whose real path already appears in `systemPromptOptions.contextFiles`, preventing double injection. |

## How to propose changes

Open an issue or PR with: the user-visible behavior, the affected `extension-src/pi-rules/*` file(s), whether README and config-field additions are required, and which roadmap table the item belongs in.
