import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test, { after, before } from "node:test";
import {
  MemoryProvider,
  buildManifest,
  serializeReport,
  validateBundle,
  validationExitCode,
  verifyManifest,
  type ValidationReport,
} from "../dist/index.js";

interface Operation {
  op: "write" | "append" | "delete" | "remove";
  path: string;
  content?: string;
}

interface FixtureCase {
  id: string;
  command: "validate" | "verify";
  operations: Operation[];
  contract_overrides?: Record<string, unknown>;
  expect: {
    exit: number;
    status: "pass" | "fail";
    present_rules?: string[];
    absent_rules?: string[];
    modified?: string[];
  };
}

interface CaseManifest {
  base_fixture: string;
  cases: FixtureCase[];
}

const root = process.cwd();
const fixtureRoot = join(root, "tests/fixtures/okf-v0.2");
const contractPath = join(root, "contract/okf-v0.2-core.json");
let temporaryRoot: string;
let cases: CaseManifest;
let contract: Record<string, unknown>;
let baseFiles: Map<string, Uint8Array>;

async function readTree(directory: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.set(relative(directory, path).replaceAll("\\", "/"), await readFile(path));
    }
  };
  await walk(directory);
  return files;
}

function cloneFiles(files: ReadonlyMap<string, Uint8Array>): Map<string, Uint8Array> {
  return new Map([...files].map(([path, bytes]) => [path, Uint8Array.from(bytes)]));
}

function applyOperations(files: Map<string, Uint8Array>, operations: readonly Operation[]): void {
  for (const operation of operations) {
    if (operation.path.startsWith("/") || operation.path.split("/").includes("..")) {
      throw new Error(`unsafe fixture path: ${operation.path}`);
    }
    if (operation.op === "write") {
      files.set(operation.path, Buffer.from(operation.content ?? "", "utf8"));
    } else if (operation.op === "append") {
      const existing = files.get(operation.path);
      if (existing === undefined) throw new Error(`append target is missing: ${operation.path}`);
      files.set(operation.path, Buffer.concat([existing, Buffer.from(operation.content ?? "", "utf8")]));
    } else {
      files.delete(operation.path);
    }
  }
}

function assertValidationSchema(report: unknown): asserts report is ValidationReport {
  assert.ok(report !== null && typeof report === "object" && !Array.isArray(report));
  const value = report as Record<string, unknown>;
  const required = [
    "schema_version", "validator", "status", "bundle", "expected_okf_version", "declared_okf_version",
    "profile", "dimensions", "contract", "metrics", "findings", "recommendations",
  ];
  for (const key of required) assert.ok(key in value, `missing report field ${key}`);
  assert.equal(value.schema_version, "okf-validation-report.v1");
  assert.match(String(value.validator), /^okf-validator\/\d+\.\d+\.\d+$/);
  assert.ok(value.status === "pass" || value.status === "fail");
  assert.ok(typeof value.bundle === "string" && value.bundle.length > 0);
  assert.ok(typeof value.expected_okf_version === "string" && value.expected_okf_version.length > 0);
  assert.ok(value.declared_okf_version === null || typeof value.declared_okf_version === "string");
  assert.equal(typeof value.profile, "string");

  const dimensions = value.dimensions as Record<string, unknown>;
  assert.ok(dimensions.core_conformance === "pass" || dimensions.core_conformance === "fail");
  assert.ok(dimensions.evaluation_boundary === "pass" || dimensions.evaluation_boundary === "fail");
  assert.ok(dimensions.advisory_guidance === "clear" || dimensions.advisory_guidance === "review");
  const contractValue = value.contract as Record<string, unknown>;
  assert.ok(typeof contractValue.path === "string" && contractValue.path.length > 0);
  assert.match(String(contractValue.sha256), /^[0-9a-f]{64}$/);
  assert.ok(contractValue.upstream !== null && typeof contractValue.upstream === "object");
  const metrics = value.metrics as Record<string, unknown>;
  for (const key of ["markdown_documents", "concept_documents", "reserved_documents", "errors", "core_errors", "boundary_errors", "warnings"]) {
    assert.ok(Number.isInteger(metrics[key]) && Number(metrics[key]) >= 0, `invalid metric ${key}`);
  }
  assert.ok(Array.isArray(value.findings));
  for (const finding of value.findings as Record<string, unknown>[]) {
    assert.ok(typeof finding.rule === "string" && finding.rule.length > 0);
    assert.ok(finding.severity === "error" || finding.severity === "warning");
    assert.equal(typeof finding.path, "string");
    assert.ok(typeof finding.message === "string" && finding.message.length > 0);
    if ("line" in finding) {
      assert.ok(Number.isInteger(finding.line) && Number(finding.line) >= 1, "finding line must be a 1-based integer");
    }
  }
  assert.ok(Array.isArray(value.recommendations));
  assert.ok((value.recommendations as unknown[]).every((item) => item !== null && typeof item === "object" && !Array.isArray(item)));
}

function execCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [join(root, "dist/cli.js"), ...args], { cwd: root }, (error, stdout, stderr) => {
      if (error !== null && error.code === undefined) reject(error);
      else resolve({ code: error === null ? 0 : Number(error.code), stdout, stderr });
    });
  });
}

async function materialize(directory: string, files: ReadonlyMap<string, Uint8Array>): Promise<void> {
  for (const [path, bytes] of files) {
    const target = join(directory, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

before(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "okf-validator-tests-"));
  cases = JSON.parse(await readFile(join(fixtureRoot, "cases.json"), "utf8")) as CaseManifest;
  contract = JSON.parse(await readFile(contractPath, "utf8")) as Record<string, unknown>;
  baseFiles = await readTree(join(fixtureRoot, cases.base_fixture));
});

after(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

test("all 26 OKF v0.2 acceptance cases match the oracle through the library API", async (t) => {
  assert.equal(cases.cases.length, 26);
  for (const fixtureCase of cases.cases) {
    await t.test(fixtureCase.id, async () => {
      if (fixtureCase.command === "verify") {
        const baseline = await buildManifest(new MemoryProvider(cloneFiles(baseFiles)), fixtureCase.id);
        const changed = cloneFiles(baseFiles);
        applyOperations(changed, fixtureCase.operations);
        const report = await verifyManifest(new MemoryProvider(changed), baseline, fixtureCase.id);
        assert.equal(report.status, fixtureCase.expect.status);
        assert.equal(report.status === "pass" ? 0 : 1, fixtureCase.expect.exit);
        if (fixtureCase.expect.modified !== undefined) assert.deepEqual(report.modified, fixtureCase.expect.modified);
        return;
      }

      const files = cloneFiles(baseFiles);
      applyOperations(files, fixtureCase.operations);
      let selectedContractPath = contractPath;
      if (fixtureCase.contract_overrides !== undefined) {
        selectedContractPath = join(temporaryRoot, `${fixtureCase.id}.contract.json`);
        await writeFile(selectedContractPath, `${JSON.stringify({ ...contract, ...fixtureCase.contract_overrides }, null, 2)}\n`);
      }
      const before = [...files].map(([path, bytes]) => [path, Buffer.from(bytes).toString("base64")]);
      const options = {
        provider: new MemoryProvider(files),
        bundle: fixtureCase.id,
        contractPath: selectedContractPath,
        expectedVersion: "0.2",
      };
      const report = await validateBundle(options);
      assertValidationSchema(report);
      assert.equal(validationExitCode(report), fixtureCase.expect.exit);
      assert.equal(report.status, fixtureCase.expect.status);
      const rules = report.findings.map(({ rule }) => rule);
      for (const rule of fixtureCase.expect.present_rules ?? []) assert.ok(rules.includes(rule), `expected ${rule}`);
      for (const rule of fixtureCase.expect.absent_rules ?? []) assert.ok(!rules.includes(rule), `did not expect ${rule}`);
      assert.deepEqual([...files].map(([path, bytes]) => [path, Buffer.from(bytes).toString("base64")]), before);
      const repeated = await validateBundle({ ...options, provider: new MemoryProvider(files) });
      assert.equal(serializeReport(repeated), serializeReport(report), "report bytes must be deterministic");
    });
  }
});

test("built CLI returns real pass, fail, and unevaluable exit codes", async () => {
  const passDirectory = join(temporaryRoot, "cli-pass");
  await materialize(passDirectory, baseFiles);
  const pass = await execCli([
    "validate", "--bundle", passDirectory, "--contract", contractPath, "--expected-version", "0.2", "--output", "-",
  ]);
  assert.equal(pass.code, 0);
  assert.equal(pass.stderr, "");
  assertValidationSchema(JSON.parse(pass.stdout));

  const failFiles = cloneFiles(baseFiles);
  applyOperations(failFiles, [{ op: "write", path: "thing.md", content: "---\ntype: \"\"\n---\n# Thing\n" }]);
  const failDirectory = join(temporaryRoot, "cli-fail");
  await materialize(failDirectory, failFiles);
  const fail = await execCli([
    "validate", "--bundle", failDirectory, "--contract", contractPath, "--expected-version", "0.2", "--output", "-",
  ]);
  assert.equal(fail.code, 1);
  const failReport = JSON.parse(fail.stdout) as ValidationReport;
  assertValidationSchema(failReport);
  assert.ok(failReport.findings.some(({ rule }) => rule === "OKF-0.2-C2"));

  const unevaluable = await execCli([
    "validate", "--bundle", passDirectory, "--contract", join(temporaryRoot, "missing-contract.json"),
    "--expected-version", "0.2", "--output", "-",
  ]);
  assert.equal(unevaluable.code, 2);
  assert.equal(unevaluable.stdout, "");
  assert.match(unevaluable.stderr, /UnevaluableError: could not read contract/);
});
