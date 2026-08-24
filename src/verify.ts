import { createHash } from "node:crypto";
import type { FileProvider } from "./provider.js";

export interface ManifestEntry {
  path: string;
  type: "file";
  bytes: number;
  sha256: string;
}

export interface BundleManifest {
  schema_version: "bundle-manifest.v1";
  bundle: string;
  manifest_digest: string;
  entry_count: number;
  file_count: number;
  entries: ManifestEntry[];
}

export interface IntegrityReport {
  schema_version: "bundle-integrity-report.v1";
  status: "pass" | "fail";
  bundle: string;
  baseline_digest: string;
  current_digest: string;
  added: string[];
  removed: string[];
  modified: string[];
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function buildManifest(provider: FileProvider, bundle = "<memory>"): Promise<BundleManifest> {
  const paths = [...await provider.list()].sort();
  if (new Set(paths).size !== paths.length) throw new Error("file provider returned duplicate paths");
  const entries: ManifestEntry[] = [];
  for (const path of paths) {
    const bytes = Uint8Array.from(await provider.read(path));
    entries.push({ path, type: "file", bytes: bytes.byteLength, sha256: sha256(bytes) });
  }
  return {
    schema_version: "bundle-manifest.v1",
    bundle,
    manifest_digest: sha256(JSON.stringify(entries)),
    entry_count: entries.length,
    file_count: entries.length,
    entries,
  };
}

function assertManifest(value: BundleManifest): void {
  if (
    value?.schema_version !== "bundle-manifest.v1" ||
    typeof value.manifest_digest !== "string" ||
    !Array.isArray(value.entries) ||
    !value.entries.every(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        typeof entry.path === "string" &&
        entry.type === "file" &&
        Number.isInteger(entry.bytes) &&
        typeof entry.sha256 === "string",
    )
  ) {
    throw new Error("baseline is not a bundle-manifest.v1 document");
  }
}

export async function verifyManifest(
  provider: FileProvider,
  baseline: BundleManifest,
  bundle = baseline.bundle,
): Promise<IntegrityReport> {
  assertManifest(baseline);
  const current = await buildManifest(provider, bundle);
  const before = new Map(baseline.entries.map((entry) => [entry.path, entry]));
  const after = new Map(current.entries.map((entry) => [entry.path, entry]));
  const added = [...after.keys()].filter((path) => !before.has(path)).sort();
  const removed = [...before.keys()].filter((path) => !after.has(path)).sort();
  const modified = [...before.keys()]
    .filter((path) => after.has(path) && JSON.stringify(before.get(path)) !== JSON.stringify(after.get(path)))
    .sort();
  const unchanged =
    added.length === 0 &&
    removed.length === 0 &&
    modified.length === 0 &&
    baseline.manifest_digest === current.manifest_digest;
  return {
    schema_version: "bundle-integrity-report.v1",
    status: unchanged ? "pass" : "fail",
    bundle,
    baseline_digest: baseline.manifest_digest,
    current_digest: current.manifest_digest,
    added,
    removed,
    modified,
  };
}
