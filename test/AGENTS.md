# Purpose

- Own unit and behavior tests for the plugin runtime.

# Ownership

- Keep test fixtures and mock-client helpers scoped to test behavior; production code remains under `src/`.

# Local Contracts

- Cover fallback, health, replay, notification, configuration, and v2 behavior through focused tests.

# Work Guidance


# Verification

- Run `bun test` after changes in this subtree or in the runtime it covers.

# Child DOX Index

- No child DOX guides.
