import assert from "node:assert/strict";
import test from "node:test";
import { MemoryProvider, buildManifest, verifyManifest } from "../../dist/index.js";

test("manifests are byte-deterministic and independent of map insertion order", async () => {
  const first = await buildManifest(new MemoryProvider(new Map([["b.txt", "b"], ["a.txt", "a"]])), "bundle");
  const second = await buildManifest(new MemoryProvider(new Map([["a.txt", "a"], ["b.txt", "b"]])), "bundle");
  assert.deepEqual(second, first);
  assert.match(first.manifest_digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(first.entries.map(({ path }) => path), ["a.txt", "b.txt"]);
});

test("manifest verification classifies added, removed, and modified paths", async () => {
  const baseline = await buildManifest(
    new MemoryProvider(new Map([["keep.md", "same"], ["modify.md", "before"], ["remove.md", "gone"]])),
    "bundle",
  );
  const report = await verifyManifest(
    new MemoryProvider(new Map([["add.md", "new"], ["keep.md", "same"], ["modify.md", "after"]])),
    baseline,
    "bundle",
  );
  assert.equal(report.status, "fail");
  assert.deepEqual(report.added, ["add.md"]);
  assert.deepEqual(report.removed, ["remove.md"]);
  assert.deepEqual(report.modified, ["modify.md"]);
});

test("unchanged manifest verification passes", async () => {
  const files = new Map([["thing.md", "---\ntype: Concept\n---\n"]]);
  const baseline = await buildManifest(new MemoryProvider(files), "bundle");
  const report = await verifyManifest(new MemoryProvider(files), baseline, "bundle");
  assert.equal(report.status, "pass");
  assert.deepEqual(report.added, []);
  assert.deepEqual(report.removed, []);
  assert.deepEqual(report.modified, []);
});
