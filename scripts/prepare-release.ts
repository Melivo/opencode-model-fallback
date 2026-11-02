#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REGISTRY = "https://registry.npmjs.org";
const PACKAGE = "@melivo/opencode-model-fallback";
const PROPAGATION_ATTEMPTS = 6;
const PROPAGATION_DELAY_MS = 10_000;

function releaseVersion(version: string): void {
  if (!/^0\.\d+\.\d+$/.test(version)) throw new Error("Release must stay on stable 0.x");
}

/** Only the disposable release checkout is versioned; main retains its baseline. */
export function prepareRelease(root: string, version: string, build: () => void): void {
  releaseVersion(version);
  const manifests = ["package.json", "plugin.json"].map((file) => {
    const path = join(root, file);
    return { path, data: JSON.parse(readFileSync(path, "utf8")) };
  });
  for (const { path, data } of manifests) {
    data.version = version;
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  }
  build();
}

/** Public readback only: bounded propagation retries, never republish or retag. */
export async function verifyRegistry(
  root: string,
  version: string,
  readDist: () => Promise<{ integrity?: string; shasum?: string }> = async () => {
    const response = await fetch(`${REGISTRY}/${encodeURIComponent(PACKAGE)}/${version}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Registry version not available");
    const metadata = (await response.json()) as { dist?: { integrity?: string; shasum?: string } };
    return metadata.dist ?? {};
  },
  wait: () => Promise<void> = () => Bun.sleep(PROPAGATION_DELAY_MS)
): Promise<void> {
  releaseVersion(version);
  const bytes = readFileSync(
    join(root, "release-artifacts", `melivo-opencode-model-fallback-${version}.tgz`)
  );
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  const shasum = createHash("sha1").update(bytes).digest("hex");
  for (let attempt = 1; attempt <= PROPAGATION_ATTEMPTS; attempt++) {
    let dist: { integrity?: string; shasum?: string } | undefined;
    try {
      dist = await readDist();
    } catch {
      // A missing version or a transient public-registry failure may propagate.
    }
    if (dist) {
      if (dist.integrity !== integrity || dist.shasum !== shasum)
        throw new Error("Registry digest mismatch; inspect release state, do not republish");
      writeFileSync(
        join(root, "release-artifacts", "registry-check.json"),
        `${JSON.stringify({ package: PACKAGE, version, integrity, shasum, verified: true })}\n`
      );
      return;
    }
    if (attempt < PROPAGATION_ATTEMPTS) await wait();
  }
  throw new Error("Registry readback exhausted; inspect tag/npm/assets before recovery");
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === "--verify-registry") {
    await verifyRegistry(root, args[1]);
  } else if (args.length === 1) {
    prepareRelease(root, args[0], () => {
      const result = spawnSync("bun", ["run", "build"], { cwd: root, stdio: "inherit" });
      if (result.error || result.status !== 0) throw new Error("Release build failed");
    });
  } else {
    throw new Error("Usage: prepare-release [--verify-registry] <version>");
  }
}
