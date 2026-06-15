# @quandev/pi-rules

Native [Pi](https://github.com/mariozechner/pi) package for **path-scoped project rules** — discover, inject, and maintain context-aware rules under `.pi/rules/`.

## What it does

`pi-rules` watches your project and injects the right conventions into the LLM context at exactly the right time:

- **Static injection** — at the start of each turn, rules matching the current prompt and recently-touched files are injected into the system prompt.
- **Dynamic injection** — when a tool reads or writes a file, rules matching that file path are appended to the tool result.
- **Background maintenance** — after each turn, changed files are evaluated and `.pi/rules/` is updated automatically.

## Install

```bash
pi install npm:@quandev/pi-rules
```

Or install locally during development:

```bash
pi install -l /absolute/path/to/pi-rules
```

## Quick start

After installing, run the `init-advanced` skill to bootstrap your project:

```
/pi-rules:init
```

This creates:
- `AGENTS.md` — root context file with project map
- `.pi/rules/general.md` — always-apply collaboration rules
- `.pi/rules/<module>/` — path-scoped convention files

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

## How injection works

### Rule matching

Each rule is matched against **target paths** collected from:

1. Paths mentioned in the user prompt (regex extraction)
2. Files read by `read`/`grep`/`find`/`ls` tools this turn
3. Files written by `write`/`edit`/`bash` tools this turn
4. Session-level hot paths (survives across turns and `session_compact`)
5. Last injected context paths (fallback after compact)

Matching uses **picomatch** glob patterns from the `paths:` frontmatter field, plus optional **trigger phrases** (natural language substring match against the prompt).

### Injection tiers

When multiple rules match:

- **Child rules** (more specific path) are injected **fully**
- **Parent rules** (shorter path prefix) are injected as **summary only**
- **Inventory files** (`kind: inventory`) are listed as "Available Inventories" but not injected

### Prompt-type filter

Non-code prompts (e.g. "what is React?") skip injection for path-matched rules. Only `alwaysApply: true` rules are always injected regardless.

## Frontmatter reference

```yaml
---
kind: rules | inventory        # File type (default: rules)
paths:                         # Glob patterns for path matching
  - "src/auth/**/*.ts"
summary: One-line description  # Used in injection header
triggers:                      # Natural language phrases
  - "fix auth bug"
  - "login flow"
alwaysApply: true              # Inject on every turn (use sparingly)
priority: 10                   # Higher = injected first (default: 0)
tags: [security, api]          # Metadata tags
owner: team-auth               # Ownership info
createdBy: pi-rules:init       # Creation source
updatedAt: 2026-01-15          # Last update date
---
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `kind` | `"rules"` \| `"inventory"` | `"rules"` | File type. Only `rules` files are fully injected. |
| `paths` | `string \| string[]` | — | Glob patterns matched against target paths. |
| `summary` | `string` | — | One-line routing summary. |
| `triggers` | `string[]` | — | Natural language phrases for trigger matching. |
| `alwaysApply` | `boolean` | `false` | Inject on every turn regardless of path match. |
| `priority` | `number` | `0` | Sort order — higher priority injected first. |
| `tags` | `string[]` | — | Metadata tags. |
| `owner` | `string` | — | Ownership label. |
| `createdBy` | `string` | — | How this rule was created. |
| `updatedAt` | `string` | — | ISO date of last update. |

## Commands

| Command | Description |
|---------|-------------|
| `/pi-rules:init` | Bootstrap `.pi/rules/` via the `init-advanced` skill |
| `/pi-rules:status` | Show discovered rules and diagnostics |
| `/pi-rules:context` | Show last injected rule context |
| `/pi-rules:maintain <file>...` | Manually trigger rule maintenance for changed files |
| `/pi-rules:maintainer-status` | Show maintainer queue, active runs, and lock state |
| `/pi-rules:maintainer-log` | Show tail of `.pi/.pi-rules/maintainer.log` |
| `/pi-rules:maintainer-kill` | Kill the oldest active maintainer run |

## Tools

| Tool | Description |
|------|-------------|
| `create_rule` | Create a new `.pi/rules/` markdown file with frontmatter. Used by the model when the user wants to persist a project convention. |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PI_RULES_DISABLED` | unset | Set to `1` to disable injection and maintenance |
| `PI_RULES_MAX_RULE_CHARS` | `12000` | Per-rule body character cap |
| `PI_RULES_MAX_CONTEXT_CHARS` | `40000` | Total injected chars per turn |
| `PI_RULES_MAINTAINER_DISABLED` | unset | Set to `1` to disable background maintenance |
| `PI_RULES_MAINTAINER_LOG_LINES` | `100` | Default log tail line count |

## Architecture

```
extension-src/pi-rules/
├── shared/        Low-level utilities (path, fs, hash, id, time)
├── domain/        Core rule logic (parser, scanner, matcher, formatter, engine, cache, ordering, truncator)
├── features/      Operational workflows (maintainer, maintenance-queue, tool-paths)
├── app/           Runtime config and state management
└── pi/            Pi API adapters (commands, events, tools, banner, UI)
```

Layer boundaries are enforced by **dependency-cruiser**:

```
shared → domain → features → app → pi
```

Only `pi/` may skip layers. All others must follow the strict chain.

## Development

```bash
npm install
npm run build       # Build dist/index.* and dist/extensions/pi-rules.js
npm run typecheck   # TypeScript checking (no emit)
npm run lint        # Biome linting
npm run depcruise   # Dependency boundary verification
npm test            # Vitest unit + integration tests
npm run check       # All of the above
```

## Skills

| Skill | Description |
|-------|-------------|
| `init-advanced` | Bootstrap `.pi/rules/` for a project. Runs reconnaissance, creates AGENTS.md and rule files with proper frontmatter. |
| `rules-maintainer` | Hidden skill (`disable-model-invocation: true`). Maintains rules after code changes. Evaluates significance, applies minimal updates, logs actions. |

## Project structure

```
pi-rules/
├── package.json                 npm package with pi manifest
├── tsup.config.ts               Build config (dual CJS/ESM + extension bundle)
├── tsconfig.json                TypeScript config
├── dependency-cruiser.config.cjs  Layer boundary enforcement
├── biome.json                   Linting config
├── vitest.config.ts             Test config
├── extension-src/
│   └── pi-rules/                Source code (layered architecture)
├── dist/                        Build artifacts
├── skills/
│   ├── init-advanced/           Init skill with templates
│   └── rules-maintainer/        Hidden maintainer skill
├── scripts/
│   └── scan_project.sh          Reconnaissance script for init-advanced
├── test/
│   ├── unit/                    Unit tests
│   ├── integration/             Integration tests (fake Pi harness)
│   ├── helpers/                 Test utilities (fake-pi-harness)
│   └── fixtures/                Test fixtures
└── references/                  Reference implementation (not distributed)
```

## License

[MIT](LICENSE)
