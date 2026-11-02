# CI and Release Boundary

## Purpose

- Own the CI and release boundary: GitHub workflows, repository metadata, and the locked npm publishing path.

## Ownership

- `.github/workflows/` owns CI execution and the only publishing job: `ci.yml` and `release.yml`.
- `ISSUE_TEMPLATE/`, `PULL_REQUEST_TEMPLATE.md`, and `dependabot.yml` own repository metadata. They hold no publishing permissions.
- Release versioning and packaging stay in root `package.json`, `.releaserc.json`, and `scripts/`. This guide does not own release logic.

## Local Contracts

- Release engine: the existing semantic-release configuration is the only release engine. Release tags use `melivo-v${version}`; the first release is `0.1.0`. Existing `v*` tags stay unchanged.
- Release gate: the release job runs only on a push to `main` or a manual `workflow_dispatch` in the origin repository, and only when repository variable `RELEASE_ENABLED` equals `'true'`. The variable is absent or `false` at setup. Setting it to `false` stops further publishing.
- Permissions: pull request and CI jobs hold no publishing credentials. Never use `pull_request_target`. Grant `contents: write` and `id-token: write` only to the release job.
- Publishing: npm publishes through OIDC trusted publishing. Never store `NPM_TOKEN` or `NODE_AUTH_TOKEN` in workflow files or repository secrets. `GITHUB_TOKEN` remains allowed.
- Artifact: the release job publishes the exact tarball prepared and tested in the same run, and the GitHub release attaches that same file. Do not repack at publish time.
- Runtime pinning: use GitHub-hosted runners, pinned Bun, Node.js 24.10 or later, pinned npm, and Actions pinned to commit SHAs. Do not add release caches.
- Concurrency: releases are serialized. Never cancel a running publish.
- Output: release notes are GitHub release notes. No bot commits, no changelog file mutations, and no comments on issues or pull requests. The historical `CHANGELOG.md` stays.
- Local work: local configuration, builds, and package tests neither activate the plugin nor publish it. First-release CLI login and recovery boundaries are documented in [`docs/releases.md`](../docs/releases.md).

## Work Guidance

- Treat changes to the release gate, permissions, or publish steps as release-policy changes. Confirm them against the release plan before editing.
- Do not set `RELEASE_ENABLED`, create trusted-publisher configuration, or trigger a release from repository files. These are separate, manually authorized steps.

## Verification

- `bun test test/release-config.test.ts` verifies the analyzer policy, workflow gates, pinned tools, package-check ordering, and fail-before-publish behavior.
- `bun run test:package` checks a locally packed package; `bun run test:package --tarball <tgz>` checks that exact prepared archive.
- CI runs `bun test`, `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run build`, and `bun run test:package`.

## Child DOX Index

- No child DOX guides.
