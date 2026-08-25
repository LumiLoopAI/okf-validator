import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DirectoryProvider, validateBundle, type ValidationReport } from "../dist/index.js";

interface SnapshotFinding {
  rule: string;
  severity: "error" | "warning";
  path: string;
  line?: number;
  requirement?: string;
  specSections?: readonly string[];
}

interface BundleSnapshot {
  status: ValidationReport["status"];
  dimensions: ValidationReport["dimensions"];
  metrics: ValidationReport["metrics"];
  findings: SnapshotFinding[];
}

type InteropSnapshots = Record<string, BundleSnapshot>;

const root = process.cwd();
const bundlesRoot = join(root, "tests/interop/bundles");
const contractPath = join(root, "contract/okf-v0.2-core.json");
const snapshotsPath = join(root, "tests/interop/snapshots.json");

function compareFindings(left: SnapshotFinding, right: SnapshotFinding): number {
  if (left.rule !== right.rule) return left.rule < right.rule ? -1 : 1;
  if (left.severity !== right.severity) return left.severity < right.severity ? -1 : 1;
  if (left.path !== right.path) return left.path < right.path ? -1 : 1;
  const leftLine = left.line ?? 0;
  const rightLine = right.line ?? 0;
  if (leftLine !== rightLine) return leftLine - rightLine;
  return 0;
}

async function currentSnapshots(): Promise<InteropSnapshots> {
  const entries = await readdir(bundlesRoot, { withFileTypes: true });
  const bundleNames = entries.filter((entry) => entry.isDirectory()).map(({ name }) => name).sort();
  const snapshots: InteropSnapshots = {};

  for (const bundle of bundleNames) {
    const report = await validateBundle({
      provider: new DirectoryProvider(join(bundlesRoot, bundle)),
      bundle,
      contractPath,
      expectedVersion: "0.2",
    });
    snapshots[bundle] = {
      status: report.status,
      dimensions: { ...report.dimensions },
      metrics: { ...report.metrics },
      findings: report.findings
        .map(({ rule, severity, path, line, requirement, specSections }) => ({
          rule,
          severity,
          path,
          ...(line === undefined ? {} : { line }),
          ...(requirement === undefined ? {} : { requirement }),
          ...(specSections === undefined ? {} : { specSections: [...specSections] }),
        }))
        .sort(compareFindings),
    };
  }

  return snapshots;
}

test("official reference bundle verdicts match the committed interop snapshots", async () => {
  const actual = await currentSnapshots();
  if (process.env.OKF_UPDATE_SNAPSHOTS === "1") {
    await writeFile(snapshotsPath, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }

  const expected = JSON.parse(await readFile(snapshotsPath, "utf8")) as InteropSnapshots;
  assert.deepEqual(actual, expected);
});
