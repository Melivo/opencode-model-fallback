import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maintainBaseAgents, validateCanonicalConfig } from "../scripts/derive-v2-config";

const cfg = JSON.parse(
  readFileSync(new URL("../deployment/model-fallback.v2.json", import.meta.url), "utf8")
);
const manifest = JSON.parse(
  readFileSync(new URL("../deployment/base-agent-sha256.json", import.meta.url), "utf8")
);

test("canonical JSON retains 12 ordered chains, limits and complete docs override", () => {
  expect(validateCanonicalConfig(cfg)).toBe(cfg);
  expect(Object.keys(manifest).sort()).toEqual(
    Object.keys(cfg.agents)
      .map((role) => `${role}.md`)
      .sort()
  );
  for (const hash of Object.values(manifest)) expect(hash).toMatch(/^[a-f0-9]{64}$/);
  expect(cfg.cooldownMs).toBe(300000);
  expect(cfg.maxCycles).toBe(5);
  expect(cfg.agents["docs-curator"].chain[2]).toEqual({
    model: "kimi-code-plan-cn/kimi-for-coding#high",
    request: { body: { thinking: { type: "disabled" } } },
  });
  for (const i of [0, 1, 3]) expect(cfg.agents["docs-curator"].chain[i].request).toBeUndefined();
});

function fixture(run: (dir: string, sources: Record<string, string>) => void) {
  const dir = mkdtempSync(join(tmpdir(), "fallback-maintenance-"));
  try {
    const sources: Record<string, string> = {};
    for (const [role, entry] of Object.entries(cfg.agents) as [string, any][]) {
      const content = `---\nmode: subagent\nmodel: ${entry.chain[0].model}\npermissions:\n  - action: '*'\n    effect: deny\n---\nExact prompt for ${role}.\nmodel: preserve this body line\n`;
      sources[role] = content;
      writeFileSync(join(dir, `${role}.md`), content);
    }
    run(dir, sources);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("check and sync need only 12 base files, never fallback profiles; JSON remains untouched", () =>
  fixture((dir, sources) => {
    const before = JSON.stringify(cfg);
    expect(readdirSync(dir)).toHaveLength(12);
    expect(maintainBaseAgents(cfg, dir)).toEqual({ roles: 12, changed: [] });
    expect(maintainBaseAgents(cfg, dir, true)).toEqual({ roles: 12, changed: [] });
    for (const [role, content] of Object.entries(sources))
      expect(readFileSync(join(dir, `${role}.md`), "utf8")).toBe(content);
    expect(JSON.stringify(cfg)).toBe(before);
  }));

test("explicit sync changes only base model line, preserving prompts and permissions", () =>
  fixture((dir, sources) => {
    const role = Object.keys(cfg.agents)[0];
    const path = join(dir, `${role}.md`);
    const original = sources[role];
    const stale = original.replace(/^model:.*$/m, 'model: "other/stale#low"');
    writeFileSync(path, stale);
    expect(() => maintainBaseAgents(cfg, dir)).toThrow("Base model differs");
    expect(readFileSync(path, "utf8")).toBe(stale);
    expect(maintainBaseAgents(cfg, dir, true).changed).toEqual([path]);
    expect(readFileSync(path, "utf8")).toBe(
      original.replace(/^model:.*$/m, `model: ${JSON.stringify(cfg.agents[role].chain[0].model)}`)
    );
  }));

test("sync stages validation before writing and rejects non-subagents", () =>
  fixture((dir, sources) => {
    const roles = Object.keys(cfg.agents);
    const first = join(dir, `${roles[0]}.md`);
    const stale = sources[roles[0]].replace(/^model:.*$/m, "model: other/stale");
    writeFileSync(first, stale);
    writeFileSync(
      join(dir, `${roles.at(-1)}.md`),
      sources[roles.at(-1)!].replace("mode: subagent", "mode: primary")
    );
    expect(() => maintainBaseAgents(cfg, dir, true)).toThrow("Expected a subagent");
    expect(readFileSync(first, "utf8")).toBe(stale);
  }));

test("canonical validation rejects invalid order, duplicates, unsafe overrides and missing roles without sorting", () => {
  const mutate = (fn: (copy: any) => void) => {
    const copy = structuredClone(cfg);
    fn(copy);
    return copy;
  };
  const role = Object.keys(cfg.agents)[0];
  expect(() => validateCanonicalConfig(mutate((c) => c.agents[role].chain.reverse()))).toThrow(
    "provider order"
  );
  expect(() =>
    validateCanonicalConfig(mutate((c) => (c.agents[role].chain[1] = c.agents[role].chain[0])))
  ).toThrow("provider order");
  expect(() =>
    validateCanonicalConfig(
      mutate((c) => (c.agents[role].chain[2].request = { body: { messages: [] } }))
    )
  ).toThrow("unsafe");
  expect(() => validateCanonicalConfig(mutate((c) => delete c.agents[role]))).toThrow("12 roles");
  expect(() => validateCanonicalConfig(mutate((c) => (c.maxCycles = 6)))).toThrow("cycle");
});
