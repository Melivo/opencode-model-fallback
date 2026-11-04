# Purpose

- Own unit and behavior tests for the plugin runtime.

## Ownership

- Keep test fixtures and mock-client helpers scoped to test behavior; production code remains under `src/`.

## Local Contracts

- Cover fallback, health, replay, notification, configuration, and v2 behavior through focused tests. V2 deployment fixtures require twelve custom Markdown profiles; only absent builtin `general.md` is optional. Present builtin profiles receive the same validation and staged model-only sync.

- `v2-runtime.test.ts` exercises the original Claude SSE envelope through the native retry hook, bounded parsing negatives, and child/stale/cooldown/cycle/override boundaries. These are local unit fixtures, not real-provider E2E evidence.

## Work Guidance

## Verification

- Run `bun test` after changes in this subtree or in the runtime it covers.
- Run `bun run test:package` for packaged-consumer behavior; `test/release-config.test.ts` covers release configuration and publication gates.

## Child DOX Index

- No child DOX guides.
