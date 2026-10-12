# Purpose

- Own the plugin runtime and the native OpenCode v2 server implementation.

# Ownership

- Keep runtime behavior in the domain modules under `config`, `detection`, `resolution`, `state`, `replay`, `display`, `logging`, and `tools`.
- Keep `v2.ts` as the native v2 server entry point; repository-level packaging and release policy stay at the root.

# Local Contracts

- Preserve the separation between global model health and per-session fallback state.
- Preserve the fallback and replay boundaries; changes to public configuration belong with schema and migration handling.

# Work Guidance


# Verification

- Run `bun test`, `bun run typecheck`, and `bun run build` for runtime changes.

# Child DOX Index

- No child DOX guides.
