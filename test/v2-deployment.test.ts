import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maintainBaseAgents, validateCanonicalConfig } from "../scripts/derive-v2-config";

const cfg = JSON.parse(
  readFileSync(new URL("../deployment/model-fallback.v2.json", import.meta.url), "utf8")
);
const fixtureCfg = {
  version: 2 as const,
  cooldownMs: 300000,
  maxCycles: 1,
  agents: {
    general: {
      chain: [{ model: "fixture-one/general-a#low" }, { model: "fixture-two/general-b#low" }],
    },
    worker: {
      chain: [{ model: "fixture-one/worker-a" }, { model: "fixture-two/worker-b" }],
    },
  },
};

test("deployment template is a loadable empty v2 configuration with runtime defaults", () => {
  expect(validateCanonicalConfig(cfg)).toBe(cfg);
  expect(cfg).toEqual({ version: 2, cooldownMs: 300000, maxCycles: 1, agents: {} });
});

test("canonical validation rejects falsy and malformed roots with its validation error", () => {
  for (const raw of [undefined, null, false, 0, "", NaN, [], {}]) {
    expect(() => validateCanonicalConfig(raw)).toThrow(
      "Expected v2 config with valid cooldown/cycle limits and an agents object"
    );
  }
});

test("default check validates without discovering HOME agent profiles", () => {
  const home = mkdtempSync(join(tmpdir(), "fallback-empty-home-"));
  try {
    const configHome = join(home, ".config");
    const agents = join(configHome, "opencode", "agents");
    mkdirSync(agents, { recursive: true });
    const sentinel = join(agents, "worker.md");
    const content = "invalid agent profile: do not discover or modify\n";
    writeFileSync(sentinel, content);
    const result = spawnSync(process.execPath, ["scripts/derive-v2-config.ts", "--check"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, HOME: home, XDG_CONFIG_HOME: configHome },
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ roles: 0, changed: [] });
    expect(readdirSync(agents)).toEqual(["worker.md"]);
    expect(readFileSync(sentinel, "utf8")).toBe(content);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("agent comparison and sync require both explicit paths", () => {
  const result = spawnSync(process.execPath, ["scripts/derive-v2-config.ts", "--sync-base"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("config.json agents-dir");
});

function fixture(run: (dir: string, sources: Record<string, string>) => void) {
  const dir = mkdtempSync(join(tmpdir(), "fallback-maintenance-"));
  try {
    const sources: Record<string, string> = {};
    for (const [role, entry] of Object.entries(fixtureCfg.agents)) {
      if (role === "general") continue;
      const content = `---\nmode: subagent\nmodel: ${entry.chain[0].model}\npermissions:\n  - action: '*'\n    effect: deny\n---\nDummy prompt.\nmodel: preserve this body line\n`;
      sources[role] = content;
      writeFileSync(join(dir, `${role}.md`), content);
    }
    run(dir, sources);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("explicit check and sync use only supplied generic base files; JSON remains untouched", () =>
  fixture((dir, sources) => {
    const before = JSON.stringify(fixtureCfg);
    expect(readdirSync(dir)).toEqual(["worker.md"]);
    expect(maintainBaseAgents(fixtureCfg, dir)).toEqual({ roles: 2, changed: [] });
    expect(maintainBaseAgents(fixtureCfg, dir, true)).toEqual({ roles: 2, changed: [] });
    for (const [role, content] of Object.entries(sources))
      expect(readFileSync(join(dir, `${role}.md`), "utf8")).toBe(content);
    expect(JSON.stringify(fixtureCfg)).toBe(before);
    expect(readdirSync(dir)).toEqual(["worker.md"]);
  }));

test("explicit sync changes only base model line, preserving prompts and permissions", () =>
  fixture((dir, sources) => {
    const role = "worker";
    const path = join(dir, `${role}.md`);
    const original = sources[role];
    const stale = original.replace(/^model:.*$/m, 'model: "other/stale#low"');
    writeFileSync(path, stale);
    expect(() => maintainBaseAgents(fixtureCfg, dir)).toThrow("Base model differs");
    expect(readFileSync(path, "utf8")).toBe(stale);
    expect(maintainBaseAgents(fixtureCfg, dir, true).changed).toEqual([path]);
    expect(readFileSync(path, "utf8")).toBe(
      original.replace(
        /^model:.*$/m,
        `model: ${JSON.stringify(fixtureCfg.agents[role].chain[0].model)}`
      )
    );
  }));

test("sync stages validation before writing and rejects non-subagents", () =>
  fixture((dir, sources) => {
    const first = join(dir, "worker.md");
    const stale = sources.worker.replace(/^model:.*$/m, "model: other/stale");
    writeFileSync(first, stale);
    writeFileSync(
      join(dir, "general.md"),
      sources.worker.replace("mode: subagent", "mode: primary")
    );
    expect(() => maintainBaseAgents(fixtureCfg, dir, true)).toThrow("Expected a subagent");
    expect(readFileSync(first, "utf8")).toBe(stale);
  }));

test("only missing builtin general is optional; custom sources and present general are validated", () =>
  fixture((dir) => {
    const general = join(dir, "general.md");
    const content = "---\nmode: subagent\nmodel: other/stale\n---\nKeep builtin override prompt\n";
    writeFileSync(general, content);
    expect(() => maintainBaseAgents(fixtureCfg, dir)).toThrow("Base model differs");
    expect(maintainBaseAgents(fixtureCfg, dir, true).changed).toEqual([general]);
    expect(readFileSync(general, "utf8")).toBe(
      content.replace("other/stale", JSON.stringify(fixtureCfg.agents.general.chain[0].model))
    );
    writeFileSync(general, content.replace("mode: subagent", "mode: primary"));
    expect(() => maintainBaseAgents(fixtureCfg, dir, true)).toThrow("Expected a subagent");
    writeFileSync(general, "not frontmatter");
    expect(() => maintainBaseAgents(fixtureCfg, dir, true)).toThrow();
    rmSync(general);
    rmSync(join(dir, "worker.md"));
    expect(() => maintainBaseAgents(fixtureCfg, dir, true)).toThrow();
    const custom = structuredClone(fixtureCfg);
    custom.agents.custom = custom.agents.general;
    delete custom.agents.general;
    expect(validateCanonicalConfig(custom)).toBe(custom);
  }));

test("validation matches runtime chain, role-name and optional maxCycles contracts", () => {
  expect(validateCanonicalConfig(fixtureCfg)).toBe(fixtureCfg);
  const mutate = (fn: (copy: any) => void) => {
    const copy = structuredClone(fixtureCfg);
    fn(copy);
    return copy;
  };
  expect(() =>
    validateCanonicalConfig(
      mutate((c) => (c.agents.general.chain = c.agents.general.chain.slice(0, 1)))
    )
  ).toThrow("model chain");
  expect(() =>
    validateCanonicalConfig(
      mutate((c) => (c.agents.general.chain[1].request = { body: { messages: [] } }))
    )
  ).toThrow("unsafe");
  expect(validateCanonicalConfig(mutate((c) => delete c.maxCycles))).toBeDefined();
  expect(() => validateCanonicalConfig(mutate((c) => (c.maxCycles = 6)))).toThrow("cycle");
});

test("validation permits explicit generic role names without personal role policy", () => {
  const generic = structuredClone(fixtureCfg);
  generic.agents = {};
  for (const role of ["build", "plan", "orchestrator", "worker-fallback1"]) {
    generic.agents[role] = {
      chain: [{ model: "fixture-one/a" }, { model: "fixture-two/b" }],
    };
  }
  expect(validateCanonicalConfig(generic)).toBe(generic);
  expect(Object.keys(generic.agents)).toEqual([
    "build",
    "plan",
    "orchestrator",
    "worker-fallback1",
  ]);
});
