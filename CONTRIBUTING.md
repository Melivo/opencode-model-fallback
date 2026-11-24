# Contributing to opencode-model-fallback

Thank you for your interest in contributing! This document outlines the process for contributing to this project.

## Getting Started

```bash
# Clone the Melivo fork
git clone https://github.com/Melivo/opencode-model-fallback.git
cd opencode-model-fallback

# Install dependencies
bun install

# Run tests
bun test

# Type check
bun run typecheck

# Build
bun run build
```

## Development Workflow

1. **Fork** the [Melivo repository](https://github.com/Melivo/opencode-model-fallback) and create a feature branch from `main`.
2. **Write code** — follow the [TypeScript/JavaScript conventions](AGENTS.md).
3. **Test** — add tests for new functionality. All tests must pass: `bun test`.
4. **Lint and format** — run `bun run lint` and `bun run format:check` before committing.
5. **Commit** — use [Conventional Commits](https://www.conventionalcommits.org/) format:
   - `feat: add X` — new feature (triggers minor release)
   - `fix: correct Y` — bug fix (triggers patch release)
   - `docs: update Z` — documentation only
   - `test: add coverage for W` — test changes
   - `chore: bump deps` — maintenance
   - `BREAKING CHANGE:` in footer — triggers major release
6. **Pull Request** — open a PR against `main` in the [Melivo repository](https://github.com/Melivo/opencode-model-fallback/pulls). Fill in the PR template.

## Quality Gates

Before a PR can be merged, all of these must pass:

- `bun run lint` — Biome linting
- `bun test` — unit tests
- `bun run typecheck` — TypeScript type check
- `bun run format:check` — Biome formatting check
- `bun run build` — build

## Architecture

The plugin is structured as follows:

```
src/
  plugin.ts           # Entry point — event router + chat.message hook
  preemptive.ts       # Sync preemptive redirect logic
  types.ts            # Shared type definitions
  config/             # Zod schema, file discovery, defaults, auto-migration
  detection/          # Pattern matching + error classification
  state/              # ModelHealthStore, SessionStateStore, FallbackStore
  resolution/         # Chain walker, agent→config resolver
  replay/             # abort→revert→prompt orchestrator
  display/            # Toast notifications, usage enrichment
  tools/              # /fallback-status tool
  logging/            # Structured file + client logger
```

See `AGENTS.md` for full architecture details and key invariants.

## Reporting Issues

Please use [GitHub Issues](https://github.com/Melivo/opencode-model-fallback/issues) and select the appropriate template.

## Security Vulnerabilities

Please do **not** open public issues for security vulnerabilities. See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

By contributing, you agree that your contributions will be licensed under the [Apache 2.0 License](LICENSE).
