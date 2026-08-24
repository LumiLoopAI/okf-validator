import assert from "node:assert/strict";
import test from "node:test";
import { MemoryProvider, validateBundle } from "../../dist/index.js";

const contractPath = `${process.cwd()}/contract/okf-v0.2-core.json`;

async function rulesFor(frontmatter: string): Promise<string[]> {
  const report = await validateBundle({
    provider: new MemoryProvider(new Map([["thing.md", `---\n${frontmatter}---\n# Thing\n`]])),
    bundle: "timestamps",
    contractPath,
    expectedVersion: "0.2",
  });
  return report.findings.map(({ rule }) => rule);
}

test("timestamp-valued fields require an ISO 8601 datetime with an explicit UTC offset", async () => {
  const invalid = await rulesFor([
    "type: Concept\n",
    "stale_after: 2026-08-24\n",
    "generated: { by: human:author, at: 2026-08-24 }\n",
    "verified: { by: human:reviewer, at: 2026-08-24 }\n",
    "usage_window: { from: 2026-08-01, to: 2026-08-24 }\n",
    "sources: [{ resource: source.md, last_modified: 2026-08-24 }]\n",
  ].join(""));
  for (const rule of ["OKF-0.2-A-STALE", "OKF-0.2-A-GENERATED", "OKF-0.2-A-VERIFIED", "OKF-0.2-A-USAGE-WINDOW", "OKF-0.2-A-SOURCE"]) {
    assert.ok(invalid.includes(rule), `expected ${rule}`);
  }

  const valid = await rulesFor([
    "type: Concept\n",
    "stale_after: 2026-08-24T12:00:00Z\n",
    "generated: { by: human:author, at: 2026-08-24T12:00:00+00:00 }\n",
    "verified: { by: human:reviewer, at: 2026-08-24T12:00:00-01:00 }\n",
    "usage_window: { from: 2026-08-01T00:00:00Z, to: 2026-08-24T00:00:00Z }\n",
    "sources: [{ resource: source.md, last_modified: 2026-08-24T00:00:00Z }]\n",
  ].join(""));
  for (const rule of ["OKF-0.2-A-STALE", "OKF-0.2-A-GENERATED", "OKF-0.2-A-VERIFIED", "OKF-0.2-A-USAGE-WINDOW", "OKF-0.2-A-SOURCE"]) {
    assert.ok(!valid.includes(rule), `did not expect ${rule}`);
  }
});

test("log frontmatter is advisory while post-frontmatter date headings remain core", async () => {
  const valid = await validateBundle({
    provider: new MemoryProvider(new Map([["log.md", [
      "---",
      "type: Log",
      "---",
      "# Bundle history",
      "",
      "## 2026-08-24",
      "- Updated the bundle.",
      "",
      "## 2026-08-23",
      "- Created the bundle.",
      "",
    ].join("\n")]])),
    bundle: "log-frontmatter-valid",
    contractPath,
    expectedVersion: "0.2",
  });
  assert.equal(valid.status, "pass");
  assert.equal(valid.dimensions.core_conformance, "pass");
  assert.equal(valid.dimensions.advisory_guidance, "review");
  assert.ok(valid.findings.some(({ rule, severity }) => rule === "OKF-0.2-A-LOG-FRONTMATTER" && severity === "warning"));
  assert.ok(!valid.findings.some(({ rule }) => rule === "OKF-0.2-C3-LOG"));

  const invalid = await validateBundle({
    provider: new MemoryProvider(new Map([["log.md", [
      "---",
      "type: Log",
      "---",
      "# Bundle history",
      "",
      "## August 24, 2026",
      "- Updated the bundle.",
      "",
    ].join("\n")]])),
    bundle: "log-frontmatter-invalid-date",
    contractPath,
    expectedVersion: "0.2",
  });
  assert.equal(invalid.status, "fail");
  assert.equal(invalid.dimensions.core_conformance, "fail");
  assert.ok(invalid.findings.some(({ rule, severity }) => rule === "OKF-0.2-C3-LOG" && severity === "error"));
  assert.ok(invalid.findings.some(({ rule, severity }) => rule === "OKF-0.2-A-LOG-FRONTMATTER" && severity === "warning"));
});
