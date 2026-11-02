# Purpose

- Own maintenance, configuration-derivation, and integration-test scripts.

## Ownership

- `derive-v2-config.ts` validates v2 configuration and base-model identities; its compatibility alias is read-only, while `--sync-base` explicitly projects base model lines. `integration-v2.py` verifies the local v2 fallback flow.
- Keep script behavior separate from the runtime implementation in `src/`.

## Local Contracts

- The v2 integration test uses a private OpenCode server and local test data; it must not call paid providers.

## Work Guidance

## Verification

- Run `bun run test:v2:integration` after changing v2 integration behavior.
- Run `bun run test:package` for the isolated npm-tarball and pinned-CLI package contract; use `--tarball <tgz>` to verify an exact prepared archive.

## Child DOX Index

- No child DOX guides.
