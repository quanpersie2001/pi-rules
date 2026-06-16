# Changelog

## [0.1.3] - 2026-06-16

### Bug Fixes

- Add GITHUB_TOKEN to release-please workflow
- Simplify release-please to release-type only
- Match release-please config to reference implementation

### Features

- Add hot reload, commitlint, symlink dedup, doctor command, release-please, and e2e tests

### Miscellaneous Tasks

- Auto-generate CHANGELOG.md on release via git-cliff
- Remove emoji icons from changelog groups

### Revert

- Remove release-please, restore manual workflow_dispatch release flow

## [0.1.2] - 2026-06-15

### Bug Fixes

- Remove unused activeRuns variable and fix formatting

### Refactor

- Simplify UI and improve powerline-footer integration

## [0.1.1] - 2026-06-15

### Bug Fixes

- Regenerate package-lock.json after removing dependencies
- Use Node 22 in CI (peer deps require >=22.19)
- Use npm install instead of npm ci in CI
- Clean working directory before npm version in release
- Separate npm publish from GitHub Release creation

### Documentation

- README, AGENTS.md, CHANGELOG, CONTRIBUTING, scan script
- Rewrite README with updated frontmatter reference

### Features

- *(shared)* Zero-dependency utility layer
- *(domain)* Core rule engine and matching logic
- *(features,app)* Operational workflows and runtime config
- *(pi)* Extension entry point with lifecycle hooks and commands
- *(skills)* Init-advanced and rules-maintainer skills

### Miscellaneous Tasks

- Project scaffolding and build configuration
- GitHub Actions CI/CD pipeline
- Add auto release notes to publish workflow
- Simplify release to single button click
- Add alpha/beta prerelease options to release workflow
- Reset version to 0.1.0

### Testing

- Comprehensive test suite (209 tests, 21 files)

