import assert from "node:assert/strict";
import test from "node:test";
import { MemoryProvider, serializeReport, validateBundle } from "../../dist/index.js";

const contractPath = `${process.cwd()}/contract/okf-v0.2-core.json`;

test("report findings persist addressable lines and omit absent lines", async () => {
  const report = await validateBundle({
    provider: new MemoryProvider(new Map([
      ["thing.md", "---\ntype: []\n---\n# Thing\n"],
    ])),
    bundle: "finding-lines",
    contractPath,
    expectedVersion: "0.1",
  });

  const typeFinding = report.findings.find(({ rule }) => rule === "OKF-0.2-C2");
  assert.equal(typeFinding?.line, 2);

  const contractFinding = report.findings.find(({ rule }) => rule === "BOUNDARY-CONTRACT");
  assert.ok(contractFinding !== undefined);
  assert.equal("line" in contractFinding, false);
  assert.doesNotMatch(serializeReport(report), /"line": null/);
});

test("C1 YAML parse findings use the YAML error line", async () => {
  const report = await validateBundle({
    provider: new MemoryProvider(new Map([
      ["thing.md", "---\ntype: [\n---\n# Thing\n"],
    ])),
    bundle: "yaml-error-line",
    contractPath,
    expectedVersion: "0.2",
  });

  const finding = report.findings.find(({ rule }) => rule === "OKF-0.2-C1");
  assert.equal(finding?.line, 2);
});
