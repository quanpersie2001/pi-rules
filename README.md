# @quandev104/pi-rules

[![CI](https://github.com/quanpersie2001/pi-rules/actions/workflows/ci.yml/badge.svg)](https://github.com/quanpersie2001/pi-rules/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@quandev104/pi-rules)](https://www.npmjs.com/package/@quandev104/pi-rules)
[![license](https://img.shields.io/npm/l/@quandev104/pi-rules)](LICENSE)

> Pi extension for path-scoped project rules. It discovers `.pi/rules/**/*.md`, matches rules to the files an agent is working on, injects relevant guidance, and lets agents recommend rule updates for user approval.

---

## Install

```bash
pi install npm:@quandev104/pi-rules
```

Bootstrap rules for a project:

```text
/pi-rules:init
```

Rules live in:

```text
.pi/rules/**/*.md
```

---

## Quick example

```markdown
---
paths:
  - "src/api/**/*.ts"
summary: API handler conventions
triggers:
  - "create endpoint"
  - "add route"
priority: 10
guard: true
---

# API Rules

- Validate input with Zod.
- Return `Result<T>`; do not throw from handlers.
- Wrap authenticated routes with `withAuth()`.
```

When the agent works on `src/api/login.ts`, this rule can be injected into context. If `guard: true` and write guard is enabled, `write`/`edit` is blocked until the rule has been shown to the agent.

---

## Config

Config files are optional.

| Scope | Path |
|---|---|
| Global | `~/.pi/agent/pi-rules.json` |
| Project | `.pi/pi-rules.json` |

Precedence:

```text
defaults < global config < project config < env vars < CLI flags
```

Recommended low-noise setup:

```json
{
  "mode": "static",
  "dynamicInjection": "off",
  "writeGuardEnabled": true
}
```

### Config fields

| Field | Type | Default |
|---|---:|---:|
| `disabled` | `boolean` | `false` |
| `mode` | `"static" \| "dynamic" \| "both" \| "off"` | `"both"` |
| `dynamicInjection` | `"off" \| "full"` | `"full"` |
| `writeGuardEnabled` | `boolean` | `false` |
| `recommendationEnabled` | `boolean` | `true` |
| `widgetEnabled` | `boolean` | `true` |
| `maxRuleChars` | `number` | `12000` |
| `maxContextChars` | `number` | `40000` |
| `maintainerLogLines` | `number` | `100` |

### Environment variables

| Variable | Description |
|---|---|
| `PI_RULES_DISABLED=1` | Disable extension |
| `PI_RULES_WRITE_GUARD=1` | Enable write/edit guard |
| `PI_RULES_DYNAMIC_INJECTION=off\|full` | Control dynamic rule injection |
| `PI_RULES_MAX_RULE_CHARS=12000` | Per-rule body cap |
| `PI_RULES_MAX_CONTEXT_CHARS=40000` | Total context cap per injection |
| `PI_RULES_MAINTAINER_LOG_LINES=100` | Maintainer log tail length |
| `PI_RULES_RECOMMENDATIONS_DISABLED=1` | Disable rule recommendations |

### CLI flags

```bash
--pi-rules-disabled
--pi-rules-mode static|dynamic|both|off
--pi-rules-dynamic-injection off|full
--pi-rules-write-guard
--pi-rules-recommendations
--pi-rules-widget
```

---

## Injection model

| Mode | Behavior |
|---|---|
| `static` | Inject matching rules at the start of the agent turn. |
| `dynamic` | Inject matching rules after tool results. |
| `both` | Static + dynamic. Default. |
| `off` | Do not inject rules. |

Dynamic injection can be muted independently:

```json
{
  "dynamicInjection": "off"
}
```

This still tracks touched paths, but avoids appending full rules during exploration.

### Write guard

Enable:

```json
{
  "writeGuardEnabled": true
}
```

Then mark critical rules:

```yaml
guard: true
```

Flow:

```text
agent calls edit/write
→ pi-rules matches target path
→ if a guarded rule has not been injected: block tool call + show rule
→ agent retries with the rule in context
```

Currently guarded tools:

```text
write, edit
```

---

## Rule frontmatter

```yaml
---
paths:
  - "src/auth/**/*.ts"
summary: Auth conventions
triggers:
  - "login flow"
alwaysApply: false
priority: 10
kind: rules
guard: true
---
```

| Field | Type | Description |
|---|---|---|
| `paths` | `string \| string[]` | Glob patterns matched against project-relative paths. |
| `summary` | `string` | One-line routing summary. |
| `triggers` | `string \| string[]` | Prompt phrases that should load the rule. |
| `alwaysApply` | `boolean` | Inject on every code-related turn. Use sparingly. |
| `priority` | `number` | Higher priority rules are injected first. |
| `kind` | `"rules" \| "inventory"` | `rules` are injected; `inventory` files are listed as available. |
| `guard` | `boolean` | Require this rule before `write`/`edit` when write guard is enabled. |
| `description` | `string` | Human-readable description; not used for matching. |

### Parent/child behavior

When parent and child rules both match, child rules are injected fully and parent rules are summarized.

```text
.pi/rules/api/api.md          → summary only
.pi/rules/api/auth/auth.md    → full body
```

---

## Commands

| Command | Description |
|---|---|
| `/pi-rules:init [...prompt]` | Bootstrap `.pi/rules/`. |
| `/pi-rules:status` | Show rules, diagnostics, and pending recommendations. |
| `/pi-rules:mode [static\|dynamic\|both\|off]` | Set project injection mode; opens a selector when no arg is passed. |
| `/pi-rules:write-guard [on\|off]` | Configure project write/edit guard; opens a selector when no arg is passed. |
| `/pi-rules:doctor` | Rule discovery diagnostics. |
| `/pi-rules:context` | Show last injected rules. |
| `/pi-rules:cleanup` | Show recommendation storage location. |

---

## Tools

| Tool | Description |
|---|---|
| `create_rule` | Create a `.pi/rules/*.md` rule file. |
| `pi_rules_recommend` | Queue a rule update recommendation for user approval. |

---

## Recommendations

Agents do not rewrite rules directly. They create recommendations, and the user approves them.

```text
agent identifies a convention
→ pi_rules_recommend creates pending recommendation
→ user reviews and approves through the pi-rules TUI
→ maintainer skill updates the rule
```

Recommendation state is stored under:

```text
.pi/.pi-rules/recommendations.json
```

---

## Architecture

```text
shared → domain → features → app → pi
```

```text
extension-src/pi-rules/
├── shared/     path, fs, hash, glob, frontmatter
├── domain/     parser, scanner, matcher, formatter, engine
├── features/   recommendations, watcher, tool path extraction
├── app/        config, runtime state
└── pi/         Pi event handlers, commands, tools
```

Layer boundaries are enforced by dependency-cruiser.

---

## Development

```bash
npm install
npm run typecheck
npm run lint
npm run depcruise
npm test
npm run build
npm run check
```

Current test suite: 223 tests.

---

## License

[MIT](LICENSE)
