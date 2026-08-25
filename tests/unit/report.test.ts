import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("core and advisory findings carry explanatory rule metadata", async () => {
  const report = await validateBundle({
    provider: new MemoryProvider(new Map([
      ["thing.md", "---\ntype: \"\"\ntags: nope\n---\n# Thing\n"],
    ])),
    bundle: "finding-metadata",
    contractPath,
    expectedVersion: "0.2",
  });

  const core = report.findings.find(({ rule }) => rule === "OKF-0.2-C2");
  assert.equal(core?.requirement, "Every concept frontmatter mapping has a non-empty string type field.");
  assert.deepEqual(core?.specSections, ["§4.1", "§11 item 2"]);

  const advisory = report.findings.find(({ rule }) => rule === "OKF-0.2-A-TAGS");
  assert.equal(advisory?.requirement, "The optional tags field should be a YAML list of strings.");
  assert.deepEqual(advisory?.specSections, ["§4.1"]);
});

test("the report schema allows optional requirement and specSections fields", async () => {
  const schema = JSON.parse(
    await readFile(`${process.cwd()}/contract/okf-validation-report.schema.json`, "utf8"),
  ) as Record<string, any>;
  const findingProperties = schema.properties.findings.items.properties;

  assert.deepEqual(findingProperties.requirement, { type: "string" });
  assert.deepEqual(findingProperties.specSections, {
    type: "array",
    items: { type: "string" },
  });
  assert.ok(!schema.properties.findings.items.required.includes("requirement"));
  assert.ok(!schema.properties.findings.items.required.includes("specSections"));
});
