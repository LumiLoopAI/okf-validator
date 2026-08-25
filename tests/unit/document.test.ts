import assert from "node:assert/strict";
import test from "node:test";
import {
  MemoryProvider,
  UnevaluableError,
  validateDocument,
  type Rule,
} from "../../dist/index.js";

const contractPath = `${process.cwd()}/contract/okf-v0.2-core.json`;

test("validateDocument runs document rules and never runs bundle rules", async () => {
  let documentChecks = 0;
  let bundleChecks = 0;
  const rules: Rule[] = [
    {
      id: "TEST-DOCUMENT",
      dimension: "advisory",
      scope: "document",
      requirement: "The requested document is evaluated.",
      check(ctx) {
        documentChecks += 1;
        return [{
          rule: this.id,
          severity: "warning",
          path: ctx.document!.path,
          message: "document rule ran",
        }];
      },
    },
    {
      id: "TEST-BUNDLE",
      dimension: "boundary",
      scope: "bundle",
      check() {
        bundleChecks += 1;
        throw new Error("bundle rule must not run");
      },
    },
  ];
  const result = await validateDocument({
    provider: new MemoryProvider(new Map([
      ["thing.md", "---\ntype: Concept\n---\n# Thing\n"],
      ["other.md", "not read"],
    ])),
    path: "thing.md",
    contractPath,
    expectedVersion: "0.2",
    rules,
  });

  assert.deepEqual(result, {
    path: "thing.md",
    findings: [{
      rule: "TEST-DOCUMENT",
      severity: "warning",
      path: "thing.md",
      message: "document rule ran",
      requirement: "The requested document is evaluated.",
    }],
  });
  assert.equal(documentChecks, 1);
  assert.equal(bundleChecks, 0);
  assert.equal("status" in result, false);
  assert.equal("report" in result, false);
});

test("validateDocument applies the default document-scoped rules", async () => {
  const result = await validateDocument({
    provider: new MemoryProvider(new Map([
      ["thing.md", "---\ntype: \"\"\ntags: nope\n---\n# Thing\n"],
    ])),
    path: "thing.md",
    contractPath,
    expectedVersion: "0.2",
  });

  assert.ok(result.findings.some(({ rule }) => rule === "OKF-0.2-C2"));
  assert.ok(result.findings.some(({ rule }) => rule === "OKF-0.2-A-TAGS"));
  assert.ok(!result.findings.some(({ rule }) => rule.startsWith("BOUNDARY-")));
});

test("validateDocument reports an unknown path clearly", async () => {
  await assert.rejects(
    validateDocument({
      provider: new MemoryProvider(new Map()),
      path: "unknown.md",
      contractPath,
      expectedVersion: "0.2",
    }),
    (error: unknown) => {
      assert.ok(error instanceof UnevaluableError);
      assert.match(error.message, /could not read document "unknown\.md"/);
      assert.match(error.message, /does not exist/);
      return true;
    },
  );
});
