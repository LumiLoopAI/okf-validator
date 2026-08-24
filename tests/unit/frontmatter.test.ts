import assert from "node:assert/strict";
import test from "node:test";
import { extractFrontmatter } from "../../dist/index.js";

test("frontmatter extraction preserves body and 1-based line positions", () => {
  const parsed = extractFrontmatter("---\r\ntype: Concept\r\ntitle: Example\r\n---\r\n# Heading\r\nBody\r\n");
  assert.equal(parsed.present, true);
  assert.equal(parsed.startLine, 1);
  assert.equal(parsed.endLine, 4);
  assert.equal(parsed.bodyStartLine, 5);
  assert.equal(parsed.keyLines.type, 2);
  assert.equal(parsed.keyLines.title, 3);
  assert.equal(parsed.body, "# Heading\r\nBody\r\n");
  assert.deepEqual(parsed.data, { type: "Concept", title: "Example" });
});

test("frontmatter extraction reports YAML and delimiter line positions", () => {
  const invalid = extractFrontmatter("---\ntype: [broken\n---\n# Body\n");
  assert.equal(invalid.error?.line, 2);
  assert.match(invalid.error?.message ?? "", /^YAML parse error:/);

  const unclosed = extractFrontmatter("---\ntype: Concept\n");
  assert.deepEqual(unclosed.error, { message: "frontmatter has no closing delimiter", line: 1 });
});

test("document without a leading delimiter has no frontmatter", () => {
  const parsed = extractFrontmatter("# Heading\n");
  assert.equal(parsed.present, false);
  assert.equal(parsed.bodyStartLine, 1);
  assert.equal(parsed.body, "# Heading\n");
});
