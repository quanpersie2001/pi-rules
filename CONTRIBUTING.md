# Contributing to @quandev/pi-rules

Thanks for your interest in contributing! This document explains how to set up the development environment, coding conventions, and the process for submitting changes.

## Prerequisites

- Node.js ≥ 20
- npm (comes with Node.js)
- [Pi coding agent](https://github.com/mariozechner/pi) (for local testing)

## Getting started

```bash
git clone https://github.com/quandev/pi-rules.git
cd pi-rules
npm install
npm run check
```

`npm run check` runs the full verification pipeline: typecheck → lint → dependency boundaries → tests → build.

## Project architecture

The extension source lives under `extension-src/pi-rules/` with a strict layered architecture:

```
shared  →  domain  →  features  →  app  →  pi
```

- **`shared/`** — Low-level utilities (path normalization, file I/O, hashing, IDs, timestamps)
- **`domain/`** — Core rule logic: parser, scanner, matcher, formatter, engine, cache, ordering, truncator, errors, project-root
- **`features/`** — Operational workflows: maintenance queue, maintainer service, tool path extraction
- **`app/`** — Runtime config (`config.ts`, `constants.ts`) and state management (`state.ts`)
- **`pi/`** — Pi API adapters: commands, lifecycle hooks, tools, banner, UI (extension entry point)

Boundaries are enforced by **dependency-cruiser** (`npm run depcruise`). Only `pi/` may import from any layer. All others must follow the strict chain above. Violating a boundary is a build error.

## Development workflow

### 1. Create a branch

```bash
git checkout -b feat/my-feature
```

### 2. Make your changes

Follow the coding conventions below. Write tests for new functionality.

### 3. Run checks

```bash
npm run check
```

This runs:
- `npm run typecheck` — TypeScript type checking (no emit)
- `npm run lint` — Biome linting
- `npm run depcruise` — Dependency boundary verification
- `npm test` — Vitest unit + integration tests
- `npm run build` — Build CJS/ESM outputs + Pi extension bundle

### 4. Submit a pull request

Push your branch and open a PR against `main`.

## Coding conventions

### TypeScript

- **Strict mode** is enabled (`tsconfig.json` has `"strict": true`)
- **`verbatimModuleSyntax: true`** — use `import type` for type-only imports; all runtime imports use `.js` extension
- **Tabs** for indentation (enforced by Biome)
- Prefer `const` over `let`; avoid `var`
- Use explicit return types on exported functions

### Imports

```typescript
// ✅ Correct
import type { RuleFrontmatter } from "./types.js";
import { normalizePath } from "../shared/path.js";

// ❌ Wrong — missing .js extension
import { normalizePath } from "../shared/path";

// ❌ Wrong — type import not marked
import { RuleFrontmatter } from "./types.js";
```

### Error handling

- Use custom error classes from `domain/errors.ts` (`RuleParseError`, `RuleDiagnosticError`, `ProjectRootNotFoundError`)
- Never swallow errors silently — log or convert to diagnostic
- Prefer returning `undefined` over throwing for optional operations (e.g., `readTextFile`)

### Testing

- Tests live in `test/unit/` and `test/integration/`
- Use `vitest` (`describe`, `expect`, `it`, `afterEach`)
- Use `mkdtempSync` for filesystem tests; always clean up in `afterEach`
- Integration tests use `test/helpers/fake-pi-harness.ts` — never call real Pi APIs
- Follow existing test patterns in `test/unit/dedup.test.ts` and `test/integration/session-flow.test.ts`

### Layer boundaries

When adding new code, respect the dependency chain:

| Layer | May import from |
|-------|-----------------|
| `shared/` | `node:*` only |
| `domain/` | `shared/` |
| `features/` | `shared/`, `domain/` |
| `app/` | `shared/`, `domain/`, `features/` |
| `pi/` | everything |

If you need to cross a boundary, introduce a new module at the appropriate layer. Run `npm run depcruise` to verify.

### Frontmatter schema

When adding new frontmatter fields:

1. Add the field to `RuleFrontmatter` in `domain/types.ts`
2. Add parsing logic in `domain/parser.ts` (use existing normalizers)
3. Update `domain/matcher.ts` or `domain/formatter.ts` if the field affects matching/formatting
4. Add unit tests in `test/unit/parser.test.ts`
5. Update this README's frontmatter reference table

### Skills

Skills are markdown files under `skills/`. When modifying:

- Keep `name` and `description` in frontmatter
- `disable-model-invocation: true` means the skill is hidden from normal model discovery
- Reference templates in `assets/` with relative paths
- Keep instructions actionable and concise

## Running tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run a specific test file
npx vitest run test/unit/matcher.test.ts
```

## Building

```bash
# Build everything
npm run build

# Build in watch mode
npm run dev
```

The build produces:
- `dist/index.js` + `dist/index.mjs` — Package entry (CJS + ESM)
- `dist/index.d.ts` + `dist/index.d.cts` — Type declarations
- `dist/extensions/pi-rules.mjs` — Bundled Pi extension entry

## Dependency boundary verification

```bash
npm run depcruise
```

This runs `dependency-cruiser` against `extension-src/pi-rules/` using the rules in `dependency-cruiser.config.cjs`. Violations are build errors.

## Submitting changes

1. **Small, focused PRs** — one concern per PR
2. **Include tests** — new code should have test coverage
3. **Update docs** — if you change frontmatter fields, update `README.md`
4. **Run `npm run check`** — all checks must pass before merging
5. **Describe your changes** — fill in the PR template

## Reporting bugs

Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Pi version and Node.js version
- Relevant `.pi/rules/` files (if applicable)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
