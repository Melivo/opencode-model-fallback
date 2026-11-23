import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseV2Agent, type V2Step, validateV2Step } from "../src/config/agent-loader";

// Only these native builtins may intentionally have no Markdown source.
const markdownOptionalBuiltins = new Set(["general"]);
export interface CanonicalConfig {
  version: 2;
  cooldownMs: number;
  maxCycles?: number;
  agents: Record<string, { chain: V2Step[] }>;
}

/** Validate arbitrary v2 agent chains without sorting, reconstructing or writing them. */
export function validateCanonicalConfig(raw: unknown): CanonicalConfig {
  const cfg = raw as CanonicalConfig;
  if (
    !cfg ||
    cfg.version !== 2 ||
    !Number.isFinite(cfg.cooldownMs) ||
    cfg.cooldownMs < 10000 ||
    (cfg.maxCycles !== undefined &&
      (!Number.isInteger(cfg.maxCycles) || cfg.maxCycles < 1 || cfg.maxCycles > 5)) ||
    !cfg.agents ||
    typeof cfg.agents !== "object" ||
    Array.isArray(cfg.agents)
  )
    throw new Error("Expected v2 config with valid cooldown/cycle limits and an agents object");
  for (const [role, entry] of Object.entries(cfg.agents)) {
    if (
      !/^[a-zA-Z0-9_-]+$/.test(role) ||
      !Array.isArray(entry?.chain) ||
      entry.chain.length < 2 ||
      entry.chain.length > 10
    ) {
      throw new Error(`Invalid base role or model chain: ${role}`);
    }
    entry.chain.forEach((step) => {
      if (!step || typeof step.model !== "string") throw new Error(`Invalid step: ${role}`);
      validateV2Step(step);
    });
  }
  return cfg;
}

/** Project only chain[0].model onto bases; all other bytes are preserved. */
export function maintainBaseAgents(
  raw: unknown,
  dir: string,
  sync = false
): { roles: number; changed: string[] } {
  const cfg = validateCanonicalConfig(raw);
  // Stage every base before writing, so missing/invalid profiles cannot cause partial sync.
  const updates: { path: string; content: string }[] = [];
  for (const [role, entry] of Object.entries(cfg.agents)) {
    const path = join(dir, role + ".md");
    if (markdownOptionalBuiltins.has(role) && !existsSync(path)) continue;
    const content = readFileSync(path, "utf8");
    const base = parseV2Agent(content);
    if (base.model === entry.chain[0].model) continue;
    if (!sync)
      throw new Error(
        `Base model differs from canonical JSON: ${role}; use --sync-base explicitly`
      );
    const end = content.indexOf("\n---", 3);
    const head = content.slice(0, end);
    const lines = head.match(/^model:[^\r\n]*/gm);
    if (lines?.length !== 1) throw new Error(`Expected one top-level model line: ${role}`);
    const next =
      head.replace(/^model:[^\r\n]*/m, () => `model: ${JSON.stringify(entry.chain[0].model)}`) +
      content.slice(end);
    if (parseV2Agent(next).model !== entry.chain[0].model)
      throw new Error(`Cannot sync model: ${role}`);
    updates.push({ path, content: next });
  }
  for (const update of updates) writeFileSync(update.path, update.content);
  return { roles: Object.keys(cfg.agents).length, changed: updates.map((update) => update.path) };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const validateOnly = args.length === 0 || (args.length === 1 && args[0] === "--check");
  const explicitAgents =
    args.length === 3 && ["--check", "--sync-base"].includes(args[0] ?? "--check");
  if (!validateOnly && !explicitAgents) {
    throw new Error(
      "Usage: bun scripts/derive-v2-config.ts [--check] | bun scripts/derive-v2-config.ts [--check|--sync-base] config.json agents-dir"
    );
  }
  const configPath = args[1] ?? new URL("../deployment/model-fallback.v2.json", import.meta.url);
  const raw = JSON.parse(readFileSync(configPath, "utf8"));
  const result = explicitAgents
    ? maintainBaseAgents(raw, args[2]!, args[0] === "--sync-base")
    : { roles: Object.keys(validateCanonicalConfig(raw).agents).length, changed: [] };
  console.log(JSON.stringify(result, null, 2));
}
