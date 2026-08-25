import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  listOkfSpecSections,
  readOkfSpecOverview,
  readOkfSpecSection,
} from "../../dist/index.js";

const root = process.cwd();

test("vendored specification matches the contract's pinned sha256", () => {
  const contract = JSON.parse(
    readFileSync(`${root}/contract/okf-v0.2-core.json`, "utf8"),
  ) as { upstream: { sha256: string } };
  const digest = createHash("sha256")
    .update(readFileSync(`${root}/spec/SPEC.md`))
    .digest("hex");

  assert.equal(digest, contract.upstream.sha256);
});

test("section listing includes sections 1 through 13 and the appendix", () => {
  const sections = listOkfSpecSections();
  const ids = new Set(sections.map(({ id }) => id));

  for (let number = 1; number <= 13; number += 1) {
    assert.ok(ids.has(String(number)), `missing section ${number}`);
  }
  assert.ok(ids.has("appendix-a-worked-example-an-income-statement"));
  assert.deepEqual(sections.slice(0, 3), [
    { id: "open-knowledge-format-okf", title: "Open Knowledge Format (OKF)", level: 1 },
    { id: "1", title: "Motivation", level: 2 },
    { id: "goals", title: "Goals", level: 3 },
  ]);
  assert.ok(!sections.some(({ title }) => title === "Schema"), "fenced headings must be ignored");
});

test("numeric, citation, and authoring title forms resolve to section 4.1", () => {
  const expected = readOkfSpecSection("4.1");

  assert.ok(expected);
  assert.deepEqual(readOkfSpecSection("§4.1"), expected);
  assert.deepEqual(readOkfSpecSection("Concept documents"), expected);
  assert.equal(expected.id, "4.1");
});

test("contract item suffixes resolve to their containing section", () => {
  assert.deepEqual(readOkfSpecSection("§11 item 2"), readOkfSpecSection("11"));
});

test("heading title lookup is case-insensitive", () => {
  assert.deepEqual(readOkfSpecSection("terminology"), readOkfSpecSection("Terminology"));
});

test("unknown section identifiers return null", () => {
  assert.equal(readOkfSpecSection("§99.4"), null);
  assert.equal(readOkfSpecSection("not a canonical heading"), null);
});

test("section text stops before the next heading at the same level", () => {
  const section = readOkfSpecSection("4.1");

  assert.ok(section);
  assert.match(section.text, /^### 4\.1 Frontmatter\n/);
  assert.doesNotMatch(section.text, /^### 4\.2 Body$/m);
});

test("overview contains the specification's terminology and conformance sections", () => {
  const overview = readOkfSpecOverview();

  assert.match(overview, /^## 2\. Terminology\n/);
  assert.match(overview, /^## 11\. Conformance$/m);
  assert.doesNotMatch(overview, /^## 12\. Versioning$/m);
});
