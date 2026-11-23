# Purpose

- Own maintenance, configuration-derivation, and integration-test scripts.

## Ownership

- `derive-v2-config.ts` validates explicit v2 configuration and model identities. Its default `check:v2` validates the neutral template without reading Home agent profiles; explicit `--check config.json agents-dir` and `--sync-base config.json agents-dir` operate only on those supplied paths. `--sync-base` changes only the top-level `model:` line in matching Markdown agent files; it does not populate or replace model chains. `integration-v2.py` verifies the local v2 fallback flow.
- Keep script behavior separate from the runtime implementation in `src/`.

## Local Contracts

- The v2 integration test verifies actual HOME/XDG/project/environment, config sources, local-only provider/model inventory and test plugin before each prompt. It uses the native openai-compatible parser and private observers for original retry envelopes, builtin fields and child identity. General success, exhaustion, cooldown and five-cycle scenarios use separate private servers; cycle fixtures add 12.2s provider latency, separate from the <5s switching bound. Four successful native reads in the same general child reset only the host consecutive-retry counter, never the plugin pass budget. Stale events remain Unit-only; no paid provider or Claude account is called.

## Work Guidance

## Verification

- Run `bun run test:v2:integration` after changing v2 integration behavior.
- Run `bun run test:package` for the isolated npm-tarball and pinned-CLI package contract; use `--tarball <tgz>` to verify an exact prepared archive.

## Child DOX Index

- No child DOX guides.
