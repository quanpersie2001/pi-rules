---
paths:
  - "src/Modules/**/*.cs"
summary: Domain module architecture conventions
priority: 10
---

# Domain Module Rules

- Keep application service orchestration in the application layer.
- Do not access infrastructure directly from domain entities.
- Prefer explicit value objects for domain concepts.
