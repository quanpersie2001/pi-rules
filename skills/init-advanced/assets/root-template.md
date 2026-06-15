# Root AGENTS.md Template

Project-level context file that Pi loads automatically. Must be as short as possible while still being complete and actionable. Target: under 80 lines. No style guides or component lists — those live in path-scoped rules files.

Include this explanation of the context-loading architecture:

```
This root context file contains a map of the codebase. The rest of the information —
coding rules, directory-specific details, and component inventories — lives in
path-scoped context files under `.pi/rules/`.

Use injected `.pi/rules` context as the first source of project-specific guidance. Trust injected rules as current; do not verify the rules system or update rules during normal implementation. If the injected rules do not answer where or how to proceed, inspect `.pi/rules` before doing broad source-code searches. Read source files to verify local style, existing APIs, or implementation details.
```

---

## Format

```markdown
# <Project Name>

<2–4 sentences: what the project does, primary tech stack, and anything
universally true that every agent session needs to know. Nothing else.>

This root context file contains a map of the codebase. The rest of the information —
coding rules, directory-specific details, and component inventories — lives in
path-scoped context files under `.pi/rules/`.

Use injected `.pi/rules` context as the first source of project-specific guidance. Trust injected rules as current; do not verify the rules system or update rules during normal implementation. If the injected rules do not answer where or how to proceed, inspect `.pi/rules` before doing broad source-code searches. Read source files to verify local style, existing APIs, or implementation details.

## Project Structure

├── public/ # Static assets (fonts, icons, images)
│ ├── fonts/
│ └── icons/
├── src/
│ ├── app/ # Next.js App Router pages & layouts
│ │ ├── layout.tsx # Root layout with global styles and providers
│ │ ├── page.tsx # Homepage
│ │ └── [...slug]/ # Catch-all dynamic route
│ ├── components/ # Reusable UI components
│ │ ├── common/ # Shared primitives and compound components
│ │ ├── content-types/ # Components mapped to Contentful content types
│ │ ├── pages/ # Page-level composite components
│ │ ├── providers/ # React context providers
│ │ └── shadcn-ui/ # Radix-based atoms — prefer over raw HTML
│ ├── custom-types/ # TypeScript types mirroring component and lib structure
│ ├── lib/ # Data-fetching clients, hooks, utilities, constants
│ └── styles/ # Global CSS
├── tailwind.config.ts # Tailwind config with custom tokens
├── next.config.ts # Next.js config
└── tsconfig.json # Path aliases

## Commands

\`\`\`bash
npm run dev # Start dev server (http://localhost:3000)
npm run build # Build for production
npm run lint # ESLint
\`\`\`

<Include any project-specific scripts that an agent is likely to need. Omit if there are none beyond standard dev/build/lint.>

## Environment Variables

| Variable               | Side   | Purpose      |
| ---------------------- | ------ | ------------ |
| `SOME_SERVER_VAR`      | Server | What it does |
| `NEXT_PUBLIC_SOME_VAR` | Client | What it does |

<Only include variables that an agent actually needs to know about — not every var in .env. Omit the table entirely if there are no non-obvious env vars.>

## Gotchas

-   <Non-obvious constraint or pattern that affects the whole codebase>
-   <Common mistake that would break things silently>

<Omit this section if there are no project-wide gotchas. Do not document things obvious from the code.>
```

---

## Rules for This File

-   **Commands are mandatory** if the project has a non-standard build, a clean step, or project-specific scripts an agent will need.
-   **Environment is mandatory** if the project has required env vars that aren't obvious from `.env.example` or aren't all public.
-   **Gotchas are mandatory** if there are cross-cutting constraints that would cause an agent to make the wrong decision silently (e.g. "never call the external API from client components").
-   **Project structure must use inline comments** — every line in the tree should explain _why_ a directory exists, not just restate its name.
-   **No code patterns, no naming conventions, no style rules.** Those live in path-scoped child rules files.
-   The "When to enter" column in subdirectory tables must answer _when_, not _what_:
    -   ❌ "Contains all UI components"
    -   ✅ "Building, editing, or reviewing any UI component"
-   Do not include tooling directories (`.github/`, `scripts/`, `config/`) unless agents regularly work inside them.
-   If the project has a non-obvious architecture (monorepo, micro-frontends, etc.), one sentence explaining the structure is acceptable.
