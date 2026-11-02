import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PACKAGE_NAME,
  parseArgs,
  REQUIRED_FILES,
  safeEnv,
  scratchBase,
  validateArchiveFiles,
  validateManifests,
} from "../scripts/check-package";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const plugin = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
const examplePath = new URL("../examples/model-fallback.v2.json", import.meta.url).pathname;

async function setup(options: Record<string, unknown>) {
  const module = await import("../src/v2");
  const hooks: Record<string, Function> = {};
  const changes: unknown[] = [];
  const child = {
    id: "ses_child",
    parentID: "ses_parent",
    agent: "example-subagent",
    model: { providerID: "example-provider", id: "primary-model", variant: "high" },
  };
  const ctx: any = {
    options,
    agent: { list: async () => ({ data: [{ id: "example-subagent", mode: "subagent" }] }) },
    model: {
      list: async () => ({
        data: [
          { providerID: "example-provider", id: "primary-model", variants: [{ id: "high" }] },
          { providerID: "other-provider", id: "fallback-model", variants: [{ id: "low" }] },
        ],
      }),
    },
    session: {
      get: async () => structuredClone(child),
      switchModel: async (x: unknown) => {
        changes.push(x);
      },
      hook: async (name: string, callback: Function) => {
        hooks[name] = callback;
        return { dispose: async () => {} };
      },
    },
  };
  const dispose = await module.default.setup(ctx);
  const event: any = {
    sessionID: child.id,
    agent: child.agent,
    model: structuredClone(child.model),
    attempt: 2,
    error: { message: "rate limit exceeded", status: 429 },
  };
  await hooks.retry(event);
  await dispose?.();
  return { event, changes };
}

test("without options the safe default configures no chains and never switches", async () => {
  const { event, changes } = await setup({});
  expect(changes).toEqual([]);
  expect(event.decision).toBeUndefined();
});

test("explicit configPath and inline config keep their behavior; config wins", async () => {
  const fromPath = await setup({ configPath: examplePath });
  expect(fromPath.changes).toHaveLength(1);
  expect(fromPath.event.decision).toEqual({ retry: true, delay: 0 });
  const inline = JSON.parse(readFileSync(examplePath, "utf8"));
  expect((await setup({ config: inline })).changes).toHaveLength(1);
  const empty = { version: 2, cooldownMs: 300000, agents: {} };
  expect((await setup({ config: empty, configPath: examplePath })).changes).toEqual([]);
  await expect(
    setup({ configPath: join(tmpdir(), "missing-fallback-config.json") })
  ).rejects.toThrow();
  const dir = mkdtempSync(join(tmpdir(), "fallback-package-"));
  try {
    const invalid = join(dir, "invalid.json");
    writeFileSync(invalid, JSON.stringify({ version: 1 }));
    await expect(setup({ configPath: invalid })).rejects.toThrow("Invalid v2 fallback config");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("package metadata targets the public fork and keeps attribution and exports", () => {
  expect(pkg.name).toBe(PACKAGE_NAME);
  expect(pkg.repository.url).toBe("git+https://github.com/Melivo/opencode-model-fallback.git");
  expect(pkg.publishConfig).toEqual({ access: "public", registry: "https://registry.npmjs.org/" });
  expect(pkg.license).toBe("Apache-2.0");
  expect(pkg.author).toContain("Błażej Pawlak");
  expect(pkg.exports["./server"]).toBe("./dist/server.js");
  expect(pkg.exports["."]).toEqual({ import: "./dist/index.js", types: "./dist/index.d.ts" });
  expect(pkg.peerDependenciesMeta).toEqual({
    "@opencode-ai/plugin": { optional: true },
    zod: { optional: true },
  });
  expect(pkg.peerDependenciesMeta["@opencode/plugin"]).toBeUndefined();
  expect(plugin.version).toBe(pkg.version);
  expect(plugin.id).toBe("opencode-model-fallback");
  expect(plugin.links.map((l: any) => l.url)).toContain(
    "https://github.com/Smart-Coders-HQ/opencode-model-fallback"
  );
  expect(validateManifests(pkg, plugin)).toEqual([]);
  expect(validateManifests(pkg, { ...plugin, version: "9.9.9" })).toContain(
    "package.json and plugin.json versions differ"
  );
  expect(validateManifests(pkg, plugin, "1.2.3")).toHaveLength(1);
});

test("npm files allowlist excludes deployment, evidence and personal artifacts", () => {
  expect(pkg.files).toEqual([
    "server.js",
    "plugin.json",
    "dist/index.js",
    "dist/index.d.ts",
    "dist/server.js",
    "dist/src/**/*.d.ts",
    "examples/model-fallback.v2.json",
  ]);
  for (const entry of pkg.files) expect(entry).not.toMatch(/deployment|evidence|agents?\/|sha256/);
});

test("archive validator accepts the allowlist and rejects personal or stray files", () => {
  const good = [...REQUIRED_FILES.map((f) => `package/${f}`), "package/dist/src/v2.d.ts"];
  expect(validateArchiveFiles(good)).toEqual([]);
  for (const stray of [
    "package/deployment/model-fallback.v2.json",
    "package/deployment/base-agent-sha256.json",
    "package/evidence/v2-server.log",
    "package/dist/scripts/derive-v2-config.d.ts",
    "package/dist/index.js.map",
    "package/examples/model-fallback.json",
  ])
    expect(validateArchiveFiles([...good, stray])).toEqual([
      `file not allowed in package: ${stray.slice(8)}`,
    ]);
  expect(validateArchiveFiles(good.filter((f) => f !== "package/dist/server.js"))).toEqual([
    "missing file: dist/server.js",
  ]);
  expect(validateArchiveFiles([...good, "other/file"])).toEqual([
    "entry outside package/: other/file",
  ]);
});

test("child environment is a strict allowlist without tokens or npm/provider credentials", () => {
  const env = safeEnv(
    {
      PATH: "/usr/bin",
      LANG: "C.UTF-8",
      HOME: "/home/real",
      XDG_CONFIG_HOME: "/home/real/.config",
      GITHUB_TOKEN: "x",
      ACTIONS_ID_TOKEN_REQUEST_URL: "x",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "x",
      NPM_TOKEN: "x",
      NODE_AUTH_TOKEN: "x",
      NPM_CONFIG_USERCONFIG: "/home/real/.npmrc",
      npm_config_registry: "https://private.example",
      ANTHROPIC_API_KEY: "x",
      OPENCODE_CONFIG: "/home/real/opencode.json",
    },
    { HOME: "/tmp/private-home" }
  );
  expect(env).toEqual({ PATH: "/usr/bin", LANG: "C.UTF-8", HOME: "/tmp/private-home" });
});

test("scratch base is /tmp/opencode locally and runner temp in CI; args are strict", () => {
  expect(scratchBase({})).toBe("/tmp/opencode");
  expect(scratchBase({ CI: "true", RUNNER_TEMP: "/runner/tmp", TMPDIR: "/t" })).toBe("/runner/tmp");
  expect(scratchBase({ CI: "true", TMPDIR: "/t" })).toBe("/t");
  expect(parseArgs([])).toEqual({});
  expect(parseArgs(["--tarball", "a.tgz"])).toEqual({ tarball: "a.tgz" });
  expect(parseArgs(["--registry-version", "0.1.0"])).toEqual({ registryVersion: "0.1.0" });
  expect(() => parseArgs(["--registry-version", "latest"])).toThrow("exact semantic version");
  expect(() => parseArgs(["--tarball"])).toThrow("Usage");
  expect(() => parseArgs(["--tarball", "a.tgz", "--registry-version", "0.1.0"])).toThrow(
    "mutually exclusive"
  );
});
