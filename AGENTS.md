# @quandev/pi-rules

A Pi package that provides a native project-rules workflow for the Pi coding agent. It generates, discovers, injects, and maintains path-scoped project rules stored under `.pi/rules/**/*.md`.

## Architecture

The source lives under `extension-src/pi-rules/` with a strict layered architecture:

```
shared  →  domain  →  features  →  app  →  pi
```

- **`shared/`** — Low-level utilities (path normalization, file I/O, hashing)
- **`domain/`** — Core rule logic: parser, scanner, matcher, formatter, engine
- **`features/`** — Operational workflows: maintenance queue, maintainer service, tool path extraction
- **`app/`** — Runtime config and state management
- **`pi/`** — Pi API adapters: commands, lifecycle hooks, tools (extension entry point)

Boundaries are enforced by dependency-cruiser.

## Building

```bash
npm run build       # Build dist/index.* and dist/extensions/pi-rules.js
npm run typecheck   # TypeScript checking (no emit)
npm run lint        # Biome linting
npm run depcruise   # Dependency boundary verification
npm test            # Vitest unit tests
npm run check       # All of the above
```

## Manifest

- `package.json` — npm package with `pi` manifest key for extensions and skills
- `dist/` — Build artifacts
- `skills/init-advanced/` — Bootstrap skill for `.pi/rules/**/*.md`
- `skills/rules-maintainer/` — Hidden maintainer skill (disable-model-invocation: true)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PI_RULES_DISABLED` | unset | If `1`, disable extension |
| `PI_RULES_MAX_RULE_CHARS` | `12000` | Per-rule body cap |
| `PI_RULES_MAX_CONTEXT_CHARS` | `40000` | Per-injection cap |
| `PI_RULES_MAINTAINER_DISABLED` | unset | If `1`, disable background maintenance |
| `PI_RULES_MAINTAINER_LOG_LINES` | `100` | Default log tail line count |
