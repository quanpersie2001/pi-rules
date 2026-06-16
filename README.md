# @quandev104/pi-rules

[![CI](https://github.com/quanpersie2001/pi-rules/actions/workflows/ci.yml/badge.svg)](https://github.com/quanpersie2001/pi-rules/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@quandev104/pi-rules)](https://www.npmjs.com/package/@quandev104/pi-rules)
[![license](https://img.shields.io/npm/l/@quandev104/pi-rules)](LICENSE)

> Zero-dependency [Pi](https://github.com/mariozechner/pi) extension for **path-scoped project rules** — auto-discovers, injects, and recommends updates for context-aware rules under `.pi/rules/`.

---

## Why?

Every project has conventions that LLMs don't know: naming patterns, architecture decisions, API contracts, team preferences. You could paste them into every prompt — or let `pi-rules` inject the right ones automatically based on which files you're working on.

## How it works

```
User: "Fix the auth handler in src/api/auth/login.ts"

  ┌─────────────────────────────────────────────────┐
  │ pi-rules extension                              │
  │                                                 │
  │ 1. Extract paths from prompt + tool results     │
  │ 2. Match against .pi/rules/**/*.md frontmatter  │
  │ 3. Inject matched rules into context            │
  │ 4. After turn: recommend rule updates           │
  └─────────────────────────────────────────────────┘
```

### Three injection modes

| Mode | When | What |
|------|------|------|
| **Static** | Start of each turn | Rules matching prompt + recently-touched files |
| **Dynamic** | After each tool call | Rules matching files just read/written |
| **Both** | Default | Both static and dynamic |

### Path collection

Rules are matched against paths from multiple sources:

1. **Prompt extraction** — file paths mentioned in user message
2. **Tool results** — files read/written by `read`, `edit`, `write`, `bash`
3. **Session hot paths** — accumulated across turns (FIFO, capped at 100)
4. **Last context fallback** — re-injects previous rules after `session_compact`

### Injection tiers

When multiple rules match:

```
.pi/rules/api/api.md          → summary only (parent)
.pi/rules/api/auth/auth.md    → full body (child, more specific)
.pi/rules/api/auth/inventory  → listed as available (not injected)
```

### Prompt filter

Non-code prompts (e.g. "what is React?") skip path-matched rules. Only `alwaysApply: true` rules are injected regardless.

---

## Install

```bash
pi install npm:@quandev104/pi-rules
```

## Quick start

```
/pi-rules:init
```

This bootstraps your project with:

- `AGENTS.md` — root context file with project map
- `.pi/rules/**/*.md` — path-scoped convention files

Then write rules as markdown with YAML frontmatter:

```markdown
---
paths:
  - "src/api/**/*.ts"
summary: API route handler conventions
triggers:
  - "create endpoint"
  - "add route"
priority: 10
---

# API Rules

- All handlers must validate input with Zod.
- Return `Result<T>` — never throw from handlers.
- Auth via `withAuth()` wrapper.
```

---

## Frontmatter reference

```yaml
---
paths:                         # Glob patterns for path matching
  - "src/auth/**/*.ts"
summary: One-line description  # Used in injection header
triggers:                      # Natural language phrases
  - "fix auth bug"
  - "login flow"
alwaysApply: true              # Inject on every turn
priority: 10                   # Higher = injected first
kind: rules                    # "rules" | "inventory"
---
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `paths` | `string \| string[]` | — | Glob patterns matched against target paths. Supports `*`, `**`, `?`, `{a,b}`. |
| `summary` | `string` | — | One-line routing summary. Used in parent injection headers. |
| `triggers` | `string[]` | — | Natural language phrases. If the prompt contains a trigger, the rule is injected. |
| `alwaysApply` | `boolean` | `false` | Inject on every turn regardless of path match. Use sparingly. |
| `priority` | `number` | `0` | Sort order. Higher priority rules are injected first. |
| `kind` | `"rules"` \| `"inventory"` | `"rules"` | `rules` files are fully injected. `inventory` files are listed but not injected. |
| `description` | `string` | — | Longer description (not used in injection). |

---

## Commands

| Command | Description |
|---------|-------------|
| `/pi-rules:init` | Bootstrap `.pi/rules/` via the `init-advanced` skill |
| `/pi-rules:status` | Show discovered rules, diagnostics, and pending recommendations |
| `/pi-rules:context` | Show last injected rule context |
| `/pi-rules:maintain <file>...` | Manually trigger rule maintenance |
| `/pi-rules:approve <id>` | Approve a pending recommendation by ID |
| `/pi-rules:approve-all` | Approve all pending recommendations |
| `/pi-rules:cancel <id>` | Cancel a pending recommendation by ID |
| `/pi-rules:cancel-all` | Cancel all pending recommendations |
| `/pi-rules:cleanup` | Remove completed/error recommendations older than 24 hours |

---

## Tools

| Tool | Description |
|------|-------------|
| `create_rule` | Create a new `.pi/rules/` file programmatically |

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PI_RULES_DISABLED` | unset | Set `1` to disable extension |
| `PI_RULES_MAX_RULE_CHARS` | `12000` | Per-rule body character cap |
| `PI_RULES_MAX_CONTEXT_CHARS` | `40000` | Total injected chars per turn |
| `PI_RULES_RECOMMENDATIONS_DISABLED` | unset | Set `1` to disable automatic rule recommendations |

---

## Skills

### `init-advanced`

Bootstraps `.pi/rules/` for a project. Runs reconnaissance, interviews the developer, and creates AGENTS.md + rule files with proper frontmatter.

### `rules-maintainer`

Hidden skill (`disable-model-invocation: true`). Invoked per-rule by the recommendation system when a user approves a recommendation. Evaluates significance of changes and applies minimal rule updates. Uses a TH1-TH4 decision framework:

| Threshold | Condition | Action |
|-----------|-----------|--------|
| **TH1** | Rule exists, still correct | Skip |
| **TH2** | Rule exists, convention changed | Update body |
| **TH3** | No rule, pattern in ≥3 files | Create new rule |
| **TH4** | No rule, pattern in 1-2 files | Log and monitor |

---

## How Recommendations Work

The recommendation system lets you review and approve rule updates before they are applied. No rules are changed without your explicit approval.

### Flow

```
Agent turn completes
  → Changed files are matched to rules via frontmatter paths
  → Recommendation created (or merged into existing pending one)
  → User reviews with /pi-rules:status
  → User approves with /pi-rules:approve or /pi-rules:approve-all
  → Rule update agent spawned for approved recommendations
```

### One rule, one recommendation

Each rule file can have at most one pending recommendation at a time. If multiple agent turns change files that match the same rule, the changed files are merged into the existing pending recommendation. This keeps the review queue clean and avoids redundant updates.

### Merge behavior

When a new recommendation would target a rule that already has a pending recommendation:
- The changed files list is merged (deduplicated)
- The merge count is incremented
- The existing recommendation ID is preserved

### Lifecycle

| Status | Description |
|--------|-------------|
| `pending` | Awaiting user review |
| `approved` | User approved, ready to apply |
| `cancelled` | User cancelled |
| `completed` | Rule update agent finished successfully |
| `error` | Rule update agent failed |

---

## Architecture

```
shared → domain → features → app → pi
```

Layer boundaries enforced by **dependency-cruiser**. Only `pi/` may skip layers.

```
extension-src/pi-rules/
├── shared/        Zero-dep utilities (path, fs, hash, glob, frontmatter)
├── domain/        Core logic (parser, scanner, matcher, engine, cache)
├── features/      Workflows (recommender, store, tool-paths)
├── app/           Config and runtime state
└── pi/            Pi API adapters (commands, events, tools, UI)
```

### Zero runtime dependencies

All utilities are implemented from scratch using only `node:*` builtins:

- **Frontmatter parser** — custom YAML subset parser (replaces `gray-matter`)
- **Glob matcher** — custom glob-to-regex (replaces `picomatch`)

---

## Development

```bash
npm install
npm run build       # Build dist/
npm run typecheck   # TypeScript checking
npm run lint        # Biome linting
npm run depcruise   # Dependency boundary check
npm test            # Vitest (209 tests)
npm run check       # All of the above
```

### CI/CD

- **Push/PR to main** → runs full CI (typecheck, lint, depcruise, test, build) on Node 20 + 22
- **Push tag `v*`** → auto-publishes to npm

```bash
git tag v0.1.1
git push origin v0.1.1
# → GitHub Actions publishes @quandev104/pi-rules@0.1.1
```

---

## License

[MIT](LICENSE)
