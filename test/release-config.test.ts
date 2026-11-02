import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { analyzeCommits } from "@semantic-release/commit-analyzer";
import { prepare as packRelease } from "@semantic-release/npm";
import { load } from "js-yaml";
import { safeEnv } from "../scripts/check-package";
import { prepareRelease, verifyRegistry } from "../scripts/prepare-release";

const ROOT = resolve(import.meta.dir, "..");
const config = JSON.parse(readFileSync(join(ROOT, ".releaserc.json"), "utf8"));
const ci = load(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as any;
const release = load(readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8")) as any;
const dirs: string[] = [];
const logger = { log() {}, error() {} };
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "release-test-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("real Angular analyzer: stable 0.x policy", () => {
  const cases: [string[], string | null][] = [
    [["fix: repair"], "patch"],
    [["perf: faster"], "patch"],
    [["feat: feature"], "minor"],
    [["fix: incompatible\n\nBREAKING CHANGE: new contract"], "minor"],
    [["docs: guide", "chore: tools"], null],
    [["fix: repair", "feat: feature", "perf: faster"], "minor"],
    [["perf: faster", "fix: changed\n\nBREAKING CHANGE: contract", "docs: guide"], "minor"],
    [["docs: changed\n\nBREAKING CHANGE: contract"], "minor"],
    [["feat!: unsupported bang header"], null],
    [["feat!: header\n\nBREAKING CHANGE: supported footer"], "minor"],
  ];
  for (const [messages, expected] of cases) {
    test(messages.join(" + "), async () => {
      expect(
        await analyzeCommits(config.plugins[0][1], {
          cwd: ROOT,
          commits: messages.map((message) => ({ message })),
          logger,
        })
      ).toBe(expected);
    });
  }
});

test("prepare synchronizes only temporary manifests, builds after both, and fails closed", () => {
  const root = scratch();
  for (const file of ["package.json", "plugin.json"])
    writeFileSync(join(root, file), JSON.stringify({ version: "0.1.0", keep: file }));
  let built = false;
  prepareRelease(root, "0.2.0", () => {
    for (const file of ["package.json", "plugin.json"])
      expect(JSON.parse(readFileSync(join(root, file), "utf8"))).toEqual({
        version: "0.2.0",
        keep: file,
      });
    built = true;
  });
  expect(built).toBe(true);
  expect(() => prepareRelease(root, "1.0.0", () => {})).toThrow("0.x");
  expect(() =>
    prepareRelease(root, "0.2.1", () => {
      throw new Error("fixture build failed");
    })
  ).toThrow("fixture build failed");
  expect(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version).toBe("0.1.0");
  expect(JSON.parse(readFileSync(join(ROOT, "plugin.json"), "utf8")).version).toBe("0.1.0");
});

test("real npm prepare packs synchronized build output without registry authentication", async () => {
  const root = scratch();
  const npmrc = join(root, "npmrc");
  writeFileSync(npmrc, "registry=https://registry.npmjs.org/\n");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "@melivo/opencode-model-fallback",
      version: "0.1.0",
      description: "release fixture",
      files: ["plugin.json", "built.js"],
    })
  );
  writeFileSync(join(root, "plugin.json"), JSON.stringify({ version: "0.1.0" }));
  prepareRelease(root, "0.2.0", () => writeFileSync(join(root, "built.js"), "// built fixture\n"));
  await packRelease(config.plugins[3][1], {
    cwd: root,
    env: safeEnv(process.env, {
      HOME: root,
      NPM_CONFIG_USERCONFIG: npmrc,
      NPM_CONFIG_CACHE: join(root, "cache"),
    }),
    nextRelease: { version: "0.2.0" },
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    logger,
  });
  const tarball = join(root, "release-artifacts/melivo-opencode-model-fallback-0.2.0.tgz");
  for (const file of ["package.json", "plugin.json"]) {
    const extracted = spawnSync("tar", ["-xOf", tarball, `package/${file}`], { encoding: "utf8" });
    expect(extracted.status).toBe(0);
    expect(JSON.parse(extracted.stdout).version).toBe("0.2.0");
  }
  expect(spawnSync("tar", ["-xOf", tarball, "package/built.js"], { encoding: "utf8" }).stdout).toBe(
    "// built fixture\n"
  );
});

test("release plugin order retains one exact tested archive and no source commits/changelog", () => {
  expect(config.branches).toEqual(["main"]);
  expect(config.tagFormat).toBe(`melivo-v\${version}`);
  expect(config.plugins.map((p: any) => p[0])).toEqual([
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/exec",
    "@semantic-release/npm",
    "@semantic-release/exec",
    "@semantic-release/github",
  ]);
  expect(config.plugins[2][1].prepareCmd).toBe(
    `bun scripts/prepare-release.ts \${nextRelease.version}`
  );
  expect(config.plugins[3][1]).toEqual({ npmPublish: false, tarballDir: "release-artifacts" });
  const tarball = `release-artifacts/melivo-opencode-model-fallback-\${nextRelease.version}.tgz`;
  const exec = config.plugins[4][1];
  expect(exec.prepareCmd).toBe(
    `bun run test:package --tarball ${tarball} && sha512sum ${tarball} > release-artifacts/tested.sha512`
  );
  expect(exec.publishCmd).toContain(
    `"$RELEASE_NPM" publish ${tarball} --access public --tag latest`
  );
  expect(exec.publishCmd).toContain(
    'sha512sum --check release-artifacts/tested.sha512 && "$RELEASE_NPM" publish'
  );
  expect(exec.publishCmd).toContain("git ls-remote origin refs/heads/main");
  expect(exec.publishCmd).toContain(`--verify-registry \${nextRelease.version}`);
  expect(exec.publishCmd).not.toMatch(/npm pack|npm publish \. /);
  expect(config.plugins[5][1]).toEqual({
    assets: [{ path: tarball, label: "Tested npm package" }],
    successComment: false,
    failComment: false,
    failTitle: false,
    labels: false,
    releasedLabels: false,
  });
});

test("YAML gates: PR read-only, locked origin/main releases, pinned tools and no caches/auth placeholder", () => {
  expect(ci.on).toEqual({ pull_request: null, push: { branches: ["main"] } });
  expect(release.on).toEqual({ push: { branches: ["main"] }, workflow_dispatch: null });
  expect(ci.permissions).toEqual({ contents: "read" });
  expect(release.permissions).toEqual({ contents: "read" });
  expect(release.concurrency).toEqual({ group: "release-main", "cancel-in-progress": false });
  const job = release.jobs.release;
  const evaluateGate = (repository: string, ref: string, event: string, enabled?: string) => {
    const expression = job.if
      .replaceAll("github.repository", JSON.stringify(repository))
      .replaceAll("github.ref", JSON.stringify(ref))
      .replaceAll("github.event_name", JSON.stringify(event))
      .replaceAll("vars.RELEASE_ENABLED", JSON.stringify(enabled ?? ""));
    return Function(`return (${expression})`)();
  };
  const origin = "Melivo/opencode-model-fallback";
  expect(evaluateGate(origin, "refs/heads/main", "push", "true")).toBe(true);
  expect(evaluateGate(origin, "refs/heads/main", "workflow_dispatch", "true")).toBe(true);
  for (const enabled of [undefined, "false", "True"])
    expect(evaluateGate(origin, "refs/heads/main", "push", enabled)).toBe(false);
  expect(evaluateGate("other/fork", "refs/heads/main", "push", "true")).toBe(false);
  expect(evaluateGate(origin, "refs/heads/other", "workflow_dispatch", "true")).toBe(false);
  expect(evaluateGate(origin, "refs/heads/main", "pull_request", "true")).toBe(false);
  expect(job.permissions).toEqual({ contents: "write", "id-token": "write" });
  for (const condition of [
    "github.repository == 'Melivo/opencode-model-fallback'",
    "github.ref == 'refs/heads/main'",
    "vars.RELEASE_ENABLED == 'true'",
    "github.event_name == 'push'",
    "github.event_name == 'workflow_dispatch'",
  ])
    expect(job.if).toContain(condition);
  for (const workflow of [ci, release]) {
    for (const entry of Object.values(workflow.jobs) as any[]) {
      expect(entry["runs-on"]).toBe("ubuntu-24.04");
      for (const step of entry.steps) {
        if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
        if (step.uses?.startsWith("actions/checkout@")) {
          expect(step.with.ref).toBe(`\${{ github.sha }}`);
          expect(step.with["fetch-depth"]).toBe(0);
          expect(step.with["fetch-tags"]).toBe(true);
          expect(step.with["persist-credentials"]).toBe(false);
        }
        if (step.uses?.startsWith("actions/setup-node@")) {
          expect(step.with["node-version"]).toBe("24.22.2");
          expect(step.with["package-manager-cache"]).toBe(false);
          expect(step.with["registry-url"]).toBeUndefined();
        }
        if (step.uses?.startsWith("oven-sh/setup-bun@")) {
          expect(step.with["bun-version"]).toBe("1.3.11");
          expect(step.with["no-cache"]).toBe(true);
        }
      }
      for (const command of [
        "npm install --global npm@11.19.1",
        "bun install --frozen-lockfile",
        "bun test",
        "bun run typecheck",
        "bun run lint",
        "bun run format:check",
        "bun run build",
      ])
        expect(entry.steps.some((s: any) => s.run?.trim().startsWith(command))).toBe(true);
    }
    expect(JSON.stringify(workflow)).not.toMatch(
      /NPM_TOKEN|NODE_AUTH_TOKEN|pull_request_target|actions\/cache/
    );
  }
  expect(JSON.stringify(ci)).not.toContain("secrets.");
  expect(ci.jobs.check.steps.some((s: any) => s.run === "bun run test:package")).toBe(true);
  const gate = job.steps.findIndex((s: any) => s.name?.startsWith("Require bootstrap"));
  const publish = job.steps.findIndex((s: any) => s.run === "bun run release");
  expect(gate).toBeGreaterThan(0);
  expect(gate).toBeLessThan(publish);
  expect(job.steps[gate].run).toContain(
    "git merge-base --is-ancestor 'refs/tags/melivo-v0.1.0^{commit}' HEAD"
  );
  const artifact = job.steps.find((s: any) => s.uses?.startsWith("actions/upload-artifact@"));
  expect(artifact.if).toBe(`\${{ always() }}`);
  expect(artifact.with["retention-days"]).toBe(7);
  expect(artifact.with.path).not.toMatch(/logs|\*\*|npmrc|home/);
});

function fakeCommand(root: string, name: string, body: string) {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}
function runShell(root: string, command: string, extra: Record<string, string> = {}) {
  return spawnSync("bash", ["-euo", "pipefail", "-c", command], {
    cwd: root,
    env: {
      PATH: `${root}/bin:${process.env.PATH}`,
      GITHUB_SHA: "event-sha",
      RELEASE_NPM: join(root, "bin", "npm"),
      ...extra,
    },
    encoding: "utf8",
  });
}

test("baseline command stops for missing/non-ancestor tags or stale main/HEAD", () => {
  const root = scratch();
  const command = release.jobs.release.steps.find((s: any) =>
    s.name?.startsWith("Require bootstrap")
  ).run;
  fakeCommand(
    root,
    "git",
    `case "$*" in
  "rev-parse HEAD") echo "\${HEAD_SHA:-event-sha}" ;;
  "ls-remote origin refs/heads/main") printf '%s\trefs/heads/main\n' "\${MAIN_SHA:-event-sha}" ;;
  "rev-parse --verify refs/tags/melivo-v0.1.0^{commit}") exit "\${BASELINE_EXIT:-0}" ;;
  "merge-base --is-ancestor refs/tags/melivo-v0.1.0^{commit} HEAD") exit "\${ANCESTOR_EXIT:-0}" ;;
  *) exit 90 ;;
esac`
  );
  expect(runShell(root, command).status).toBe(0);
  for (const extra of [
    { BASELINE_EXIT: "1" },
    { ANCESTOR_EXIT: "1" },
    { HEAD_SHA: "stale" },
    { MAIN_SHA: "stale" },
  ])
    expect(runShell(root, command, extra).status).not.toBe(0);
});

test("package failure, changed archive and stale main all prevent npm publish", () => {
  const root = scratch();
  mkdirSync(join(root, "release-artifacts"));
  const tarball = join(root, "release-artifacts/melivo-opencode-model-fallback-0.2.0.tgz");
  writeFileSync(tarball, "tested archive");
  fakeCommand(root, "bun", `exit "\${CHECK_EXIT:-0}"`);
  fakeCommand(root, "git", `printf "%s\trefs/heads/main\n" "\${MAIN_SHA:-event-sha}"`);
  fakeCommand(root, "npm", "echo published > published");
  const exec = config.plugins[4][1];
  const prepare = exec.prepareCmd.replaceAll(`\${nextRelease.version}`, "0.2.0");
  const publish = exec.publishCmd.replaceAll(`\${nextRelease.version}`, "0.2.0");
  expect(runShell(root, `${prepare} && ${publish}`, { CHECK_EXIT: "1" }).status).not.toBe(0);
  expect(() => readFileSync(join(root, "published"))).toThrow();
  expect(runShell(root, prepare).status).toBe(0);
  expect(runShell(root, publish, { MAIN_SHA: "new-main" }).status).not.toBe(0);
  writeFileSync(tarball, "changed after package check");
  expect(runShell(root, publish).status).not.toBe(0);
  expect(() => readFileSync(join(root, "published"))).toThrow();
  writeFileSync(tarball, "tested archive");
  expect(runShell(root, publish).status).toBe(0);
  expect(readFileSync(join(root, "published"), "utf8").trim()).toBe("published");
});

test("registry digest readback retries bounded propagation and rejects mismatches without mutation", async () => {
  const root = scratch();
  mkdirSync(join(root, "release-artifacts"));
  const bytes = Buffer.from("fixture archive");
  writeFileSync(join(root, "release-artifacts/melivo-opencode-model-fallback-0.2.0.tgz"), bytes);
  const dist = {
    integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    shasum: createHash("sha1").update(bytes).digest("hex"),
  };
  let reads = 0;
  let waits = 0;
  const wait = async () => {
    waits++;
  };
  await verifyRegistry(
    root,
    "0.2.0",
    async () => {
      if (++reads < 3) throw new Error("not propagated");
      return dist;
    },
    wait
  );
  expect(reads).toBe(3);
  expect(waits).toBe(2);
  expect(
    JSON.parse(readFileSync(join(root, "release-artifacts/registry-check.json"), "utf8")).verified
  ).toBe(true);
  await expect(
    verifyRegistry(root, "0.2.0", async () => ({ ...dist, shasum: "wrong" }), wait)
  ).rejects.toThrow("mismatch");
  reads = 0;
  waits = 0;
  await expect(
    verifyRegistry(
      root,
      "0.2.0",
      async () => {
        reads++;
        throw new Error("unavailable");
      },
      wait
    )
  ).rejects.toThrow("exhausted");
  expect(reads).toBe(6);
  expect(waits).toBe(5);
});
