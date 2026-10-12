# Purpose

- Own maintenance, configuration-derivation, and integration-test scripts.

# Ownership

- `derive-v2-config.ts` derives v2 configuration; `integration-v2.py` verifies the local v2 fallback flow.
- Keep script behavior separate from the runtime implementation in `src/`.

# Local Contracts

- The v2 integration test uses a private OpenCode server and local test data; it must not call paid providers.

# Work Guidance


# Verification

- Run `bun run test:v2:integration` after changing v2 integration behavior.

# Child DOX Index

- No child DOX guides.
