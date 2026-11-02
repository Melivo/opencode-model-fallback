#!/usr/bin/env bun
/**
 * Package contract check: verifies a real npm tarball, installs it into an
 * isolated scratch root and runs the existing private Python fixtures against
 * the pinned OpenCode CLI. No new test framework; no live config or providers.
 *
 *   bun scripts/check-package.ts                      build + pack this checkout
 *   bun scripts/check-package.ts --tarball <tgz>      check exactly this archive
 *   bun scripts/check-package.ts --registry-version v check the public registry package
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

export const PACKAGE_NAME = "@melivo/opencode-model-fallback";
export const RUNTIME_ID = "smart-coders.model-fallback.v2-local";
export const OPENCODE_CLI = { name: "@opencode/cli", version: "2.0.25" } as const;
export const PUBLIC_REGISTRY = "https://registry.npmjs.org/";
const FIXTURE_TIMEOUT_MS = 600_000;
const COMMAND_TIMEOUT_MS = 300_000;
const LOCAL_SCRATCH_BASE = "/tmp/opencode";
const ROOT = resolve(import.meta.dir, "..");

/** Files every archive must contain (relative to the archive's package/ root). */
export const REQUIRED_FILES = [
  "package.json",
  "README.md",
  "LICENSE",
  "server.js",
  "plugin.json",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/server.js",
  "examples/model-fallback.v2.json",
] as const;
const OPTIONAL_FILE = /^dist\/src\/[A-Za-z0-9_/-]+\.d\.ts$/;
/** Personal deployment, evidence or home-path markers that must never ship. */
const FORBIDDEN_CONTENT = ["/home/", ".hermes", "deployment/model-fallback", "base-agent-sha256"];

/** Process environment keys a child may inherit; everything else is dropped. */
export const SAFE_ENV_KEYS = [
  "PATH",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TERM",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
] as const;

export function safeEnv(
  source: Record<string, string | undefined>,
  overrides: Record<string, string> = {}
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, ...overrides };
}

export function scratchBase(env: Record<string, string | undefined>): string {
  if (env.CI) return env.RUNNER_TEMP || env.TMPDIR || tmpdir();
  return LOCAL_SCRATCH_BASE;
}

export interface CheckArgs {
  tarball?: string;
  registryVersion?: string;
}

export function parseArgs(argv: string[]): CheckArgs {
  const args: CheckArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if ((flag !== "--tarball" && flag !== "--registry-version") || !value || value.startsWith("--"))
      throw new Error(`Usage: check-package [--tarball <tgz> | --registry-version <version>]`);
    if (flag === "--tarball") args.tarball = value;
    else args.registryVersion = value;
    i++;
  }
  if (args.tarball && args.registryVersion)
    throw new Error("--tarball and --registry-version are mutually exclusive");
  if (args.registryVersion && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(args.registryVersion))
    throw new Error("--registry-version must be an exact semantic version");
  return args;
}

/** Returns contract violations for an archive listing (entries as printed by tar). */
export function validateArchiveFiles(entries: string[]): string[] {
  const errors: string[] = [];
  const files = new Set<string>();
  for (const entry of entries) {
    if (entry.endsWith("/")) continue;
    if (!entry.startsWith("package/")) {
      errors.push(`entry outside package/: ${entry}`);
      continue;
    }
    const file = entry.slice("package/".length);
    files.add(file);
    if (!(REQUIRED_FILES as readonly string[]).includes(file) && !OPTIONAL_FILE.test(file))
      errors.push(`file not allowed in package: ${file}`);
  }
  for (const file of REQUIRED_FILES) if (!files.has(file)) errors.push(`missing file: ${file}`);
  return errors;
}

/** Returns contract violations for the archive's package.json and plugin.json. */
export function validateManifests(
  pkg: Record<string, any>,
  plugin: Record<string, any>,
  expectedVersion?: string
): string[] {
  const errors: string[] = [];
  if (pkg.name !== PACKAGE_NAME) errors.push(`package name ${pkg.name}`);
  if (plugin.version !== pkg.version) errors.push("package.json and plugin.json versions differ");
  if (expectedVersion && pkg.version !== expectedVersion)
    errors.push(`version ${pkg.version} differs from expected ${expectedVersion}`);
  if (pkg.exports?.["./server"] !== "./dist/server.js")
    errors.push("native ./server export missing");
  if (pkg.exports?.["."]?.import !== "./dist/index.js") errors.push("legacy . export missing");
  if (pkg.license !== "Apache-2.0") errors.push("license changed");
  if (pkg.publishConfig?.registry !== PUBLIC_REGISTRY)
    errors.push("publish registry is not public npm");
  if (pkg.repository?.url !== "git+https://github.com/Melivo/opencode-model-fallback.git")
    errors.push("repository url is not the fork origin");
  return errors;
}

function run(
  command: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; timeout?: number; capture?: boolean }
): string {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: options.timeout ?? COMMAND_TIMEOUT_MS,
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} ${args[0] ?? ""} failed with exit ${result.status ?? result.signal}`
    );
  return result.stdout ?? "";
}

function within(path: string, parent: string): boolean {
  const rel = relative(parent, path);
  return rel !== "" && !rel.startsWith("..") && !rel.startsWith(sep);
}

function privatePackageJson(dir: string, name: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, private: true }));
}

/** Imports the installed package as a consumer would and checks the safe default. */
const RUNTIME_PROBE = `
const name = process.argv[1], id = process.argv[2];
const server = await import(name + "/server");
if (server.default?.id !== id || typeof server.default.setup !== "function") throw new Error("server export invalid");
const legacy = import.meta.resolve(name);
if (!legacy.endsWith("/dist/index.js")) throw new Error("legacy export resolves to " + legacy);
const hooks = {};
const ctx = { options: {}, agent: { list: async () => ({ data: [{ id: "any", mode: "subagent" }] }) },
  model: { list: async () => ({ data: [] }) },
  session: { hook: async (n, cb) => { hooks[n] = cb; return { dispose: async () => {} }; },
    get: async () => ({ parentID: "p", agent: "any", model: { providerID: "a", id: "b" } }),
    switchModel: async () => { throw new Error("default config switched a model"); } } };
const dispose = await server.default.setup(ctx);
const event = { sessionID: "s", agent: "any", model: { providerID: "a", id: "b" }, attempt: 2, error: { message: "rate limit", status: 429 } };
await hooks.retry(event);
if (event.decision !== undefined) throw new Error("default config decided a retry");
await dispose();
console.log(JSON.stringify({ server: import.meta.resolve(name + "/server"), legacy }));
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = scratchBase(process.env);
  mkdirSync(base, { recursive: true });
  const scratch = realpathSync(mkdtempSync(join(base, "model-fallback-package-")));
  for (const dir of ["home", "tmp", "pack", "extract", "evidence", "fixture"])
    mkdirSync(join(scratch, dir));
  // Only our own public-registry config; never project/home .npmrc or inherited npm auth.
  const npmrc = join(scratch, "npmrc");
  writeFileSync(npmrc, `registry=${PUBLIC_REGISTRY}\n`, { mode: 0o600 });
  const env = safeEnv(process.env, { HOME: join(scratch, "home"), TMPDIR: join(scratch, "tmp") });
  const npmEnv = {
    ...env,
    NPM_CONFIG_USERCONFIG: npmrc,
    NPM_CONFIG_CACHE: join(scratch, "npm-cache"),
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_AUDIT: "false",
  };
  console.log(`package check scratch: ${scratch}`);

  let tarball: string;
  let expectedVersion: string | undefined = args.registryVersion;
  if (args.tarball) {
    tarball = resolve(args.tarball);
    if (!existsSync(tarball)) throw new Error("tarball not found");
  } else {
    const pack = join(scratch, "pack");
    const spec = args.registryVersion ? `${PACKAGE_NAME}@${args.registryVersion}` : ".";
    if (!args.registryVersion) {
      if (existsSync(join(ROOT, ".npmrc")))
        throw new Error("refusing to pack with a project .npmrc");
      run("bun", ["run", "build"], { cwd: ROOT, env: process.env as Record<string, string> });
      expectedVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
    }
    const out = run(
      "npm",
      ["pack", spec, "--json", "--ignore-scripts", "--pack-destination", pack],
      {
        cwd: args.registryVersion ? pack : ROOT,
        env: npmEnv,
        capture: true,
      }
    );
    // npm reports scoped names either as "@scope/name-v.tgz" or "scope-name-v.tgz".
    const filename: string = JSON.parse(out)[0].filename;
    tarball = join(pack, filename.replace(/^@/, "").replace("/", "-"));
  }
  const sha256 = createHash("sha256").update(readFileSync(tarball)).digest("hex");

  const entries = run("tar", ["-tzf", tarball], { cwd: scratch, env, capture: true })
    .split("\n")
    .filter(Boolean);
  const extract = join(scratch, "extract");
  run("tar", ["-xzf", tarball, "-C", extract], { cwd: scratch, env });
  const read = (file: string) => readFileSync(join(extract, "package", file), "utf8");
  const pkg = JSON.parse(read("package.json"));
  const errors = [
    ...validateArchiveFiles(entries),
    ...validateManifests(pkg, JSON.parse(read("plugin.json")), expectedVersion),
  ];
  for (const entry of entries.filter((e) => /\.(js|json|ts)$/.test(e))) {
    const text = readFileSync(join(extract, entry), "utf8");
    for (const marker of FORBIDDEN_CONTENT)
      if (text.includes(marker)) errors.push(`${entry} contains forbidden marker ${marker}`);
  }
  if (errors.length) throw new Error(`archive contract violated:\n- ${errors.join("\n- ")}`);

  // Separate install prefixes: plugin consumer and pinned CLI never share node_modules.
  const pluginRoot = join(scratch, "plugin");
  privatePackageJson(pluginRoot, "package-check-plugin");
  run("npm", ["install", tarball, "--ignore-scripts", "--no-package-lock"], {
    cwd: pluginRoot,
    env: npmEnv,
  });
  const installed = join(pluginRoot, "node_modules", ...PACKAGE_NAME.split("/"));
  if (lstatSync(installed).isSymbolicLink() || !within(realpathSync(installed), scratch))
    throw new Error("installed package is not a real directory inside scratch");
  if (within(realpathSync(installed), ROOT))
    throw new Error("installed package resolves into checkout");
  if (!existsSync(join(pluginRoot, "node_modules", "@opencode", "plugin")))
    throw new Error("required peer @opencode/plugin was not installed");
  const legacyPeers = ["@opencode-ai/plugin", "zod"].filter((p) =>
    existsSync(join(pluginRoot, "node_modules", ...p.split("/")))
  );
  if (legacyPeers.length)
    throw new Error(`optional legacy peers installed: ${legacyPeers.join(", ")}`);
  const probe = JSON.parse(
    run("node", ["--input-type=module", "-e", RUNTIME_PROBE, PACKAGE_NAME, RUNTIME_ID], {
      cwd: pluginRoot,
      env,
      capture: true,
    })
  );
  for (const url of Object.values(probe) as string[])
    if (!within(realpathSync(new URL(url).pathname), installed))
      throw new Error(`export resolved outside installed root: ${url}`);

  const cliRoot = join(scratch, "cli");
  privatePackageJson(cliRoot, "package-check-cli");
  run("npm", ["install", `${OPENCODE_CLI.name}@${OPENCODE_CLI.version}`, "--no-package-lock"], {
    cwd: cliRoot,
    env: npmEnv,
  });
  const cliPackage = JSON.parse(
    readFileSync(join(cliRoot, "node_modules", "@opencode", "cli", "package.json"), "utf8")
  );
  if (cliPackage.version !== OPENCODE_CLI.version)
    throw new Error("installed CLI version mismatch");
  const bin = join(cliRoot, "node_modules", ".bin", "opencode");
  const version = run(bin, ["--version"], { cwd: scratch, env, capture: true }).trim();
  if (!new RegExp(`^(?:opencode )?v?${OPENCODE_CLI.version.replaceAll(".", "\\.")}$`).test(version))
    throw new Error(`CLI reports ${version}, expected ${OPENCODE_CLI.version}`);

  const evidence = join(scratch, "evidence");
  run(
    "python3",
    [
      "-I",
      join(ROOT, "scripts", "integration-v2.py"),
      "--plugin-package",
      installed,
      "--opencode-bin",
      bin,
      "--evidence-dir",
      evidence,
      "--scratch-root",
      join(scratch, "fixture"),
    ],
    { cwd: scratch, env, timeout: FIXTURE_TIMEOUT_MS }
  );
  const fixture = JSON.parse(readFileSync(join(evidence, "v2-integration-result.json"), "utf8"));
  if (fixture.opencode !== version || fixture.plugin_package !== installed)
    throw new Error("fixture result does not reference the checked CLI and installed package");
  const summary = {
    package: PACKAGE_NAME,
    version: pkg.version,
    tarball_sha256: sha256,
    mode: args.tarball ? "tarball" : args.registryVersion ? "registry" : "local-pack",
    files: entries.length,
    opencode: version,
    installed,
    exports: probe,
    fixtures: "passed",
  };
  writeFileSync(join(scratch, "package-check.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
