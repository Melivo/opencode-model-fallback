import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { parseV2Agent } from "../src/config/agent-loader";
const dir = process.argv[2] ?? "/home/visimeos/.config/opencode/agents";
const roles = readdirSync(dir).filter(n => n.endsWith("-fallback1.md")).map(n => n.slice(0, -13)).sort();
if (roles.length !== 12) throw new Error(`Expected exactly 12 roles, found ${roles.length}`);
const agents: Record<string, unknown> = {};
const sources: Record<string, string> = {};
for (const role of roles) {
  const chain = ["", "-fallback1", "-fallback2", "-fallback3"].map(suffix => {
    const path = join(dir, role + suffix + ".md");
    const content = readFileSync(path, "utf8");
    sources[path] = createHash("sha256").update(content).digest("hex");
    return parseV2Agent(content);
  });
  agents[role] = {chain};
}
mkdirSync("deployment", {recursive: true});
writeFileSync("deployment/model-fallback.v2.json", JSON.stringify({version: 2, cooldownMs: 300000, maxCycles: 5, agents}, null, 2) + "\n");
writeFileSync("deployment/agent-source-sha256.json", JSON.stringify(sources, null, 2) + "\n");
console.log(JSON.stringify({roles: roles.length, steps: Object.keys(sources).length, agents}, null, 2));
