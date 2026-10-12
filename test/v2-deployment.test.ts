import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseV2Agent } from "../src/config/agent-loader";

test("deployment preserves all 12 role chains and all 48 original agent files byte-for-byte", () => {
  const cfg = JSON.parse(readFileSync(new URL("../deployment/model-fallback.v2.json", import.meta.url), "utf8"));
  const hashes = JSON.parse(readFileSync(new URL("../deployment/agent-source-sha256.json", import.meta.url), "utf8"));
  expect(Object.keys(cfg.agents)).toHaveLength(12);
  expect(Object.keys(hashes)).toHaveLength(48);
  expect(cfg.agents["*"]).toBeUndefined();
  expect(cfg.agents.build).toBeUndefined();
  for (const [role, entry] of Object.entries(cfg.agents) as [string, any][]) {
    expect(entry.chain).toHaveLength(4);
    for (const [i, suffix] of ["", "-fallback1", "-fallback2", "-fallback3"].entries()) {
      const path = `/home/visimeos/.config/opencode/agents/${role}${suffix}.md`;
      const content = readFileSync(path, "utf8");
      expect(createHash("sha256").update(content).digest("hex")).toBe(hashes[path]);
      expect(entry.chain[i]).toEqual(parseV2Agent(content));
    }
  }
  expect(cfg.agents["docs-curator"].chain[3]).toEqual({model:"kimi-code-plan-cn/kimi-for-coding#high",request:{body:{thinking:{type:"disabled"}}}});
});
