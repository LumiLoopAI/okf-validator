import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isMapping } from "./frontmatter.js";
import { loadBundle, type Bundle } from "./bundle.js";
import type { FileProvider } from "./provider.js";
import { advisoryRules } from "./rules/advisory.js";
import { boundaryRules } from "./rules/boundary.js";
import { coreRules } from "./rules/core.js";
import type { Finding, OkfContract, Rule, RuleDimension } from "./rules/types.js";

const SUPPORTED_CONTRACT_VERSION = "2.1.0";

export class UnevaluableError extends Error {
  override readonly name = "UnevaluableError";
}

export interface ContractSelection {
  path: string;
  bytes: Uint8Array;
  sha256: string;
  contract: OkfContract;
}

export interface ClassifiedFinding {
  finding: Finding;
  dimension: RuleDimension;
}

export interface EngineResult {
  bundle: Bundle;
  bundleName: string;
  expectedVersion: string;
  declaredVersion: string | null;
  contract: ContractSelection;
  findings: readonly Finding[];
  classifiedFindings: readonly ClassifiedFinding[];
  evaluatedRules: readonly Rule[];
}

export interface EvaluateBundleOptions {
  provider: FileProvider;
  contractPath: string;
  expectedVersion: string;
  bundle?: string;
  rules?: readonly Rule[];
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function contractFrom(value: unknown): OkfContract {
  if (
    !isMapping(value) ||
    typeof value.contract_version !== "string" ||
    typeof value.okf_version !== "string" ||
    !isMapping(value.upstream) ||
    !Array.isArray(value.core_rules) ||
    !Array.isArray(value.evaluation_requirements)
  ) {
    throw new UnevaluableError("contract does not have the required OKF rule-contract structure");
  }
  if (value.contract_version !== SUPPORTED_CONTRACT_VERSION) {
    throw new UnevaluableError(`unsupported contract version: ${JSON.stringify(value.contract_version)}`);
  }
  const validRule = (rule: unknown): rule is { id: string; [key: string]: unknown } =>
    isMapping(rule) && typeof rule.id === "string" && rule.id.length > 0;
  if (!value.core_rules.every(validRule) || !value.evaluation_requirements.every(validRule)) {
    throw new UnevaluableError("contract contains an invalid rule declaration");
  }
  return value as OkfContract;
}

export async function loadContract(path: string): Promise<ContractSelection> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new UnevaluableError(`could not read contract ${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new UnevaluableError(`could not parse contract ${JSON.stringify(path)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { path, bytes, sha256: sha256(bytes), contract: contractFrom(parsed) };
}

function compareFindings(left: Finding, right: Finding): number {
  if (left.path !== right.path) return left.path < right.path ? -1 : 1;
  if (left.rule !== right.rule) return left.rule < right.rule ? -1 : 1;
  const leftLine = left.line ?? 0;
  const rightLine = right.line ?? 0;
  if (leftLine !== rightLine) return leftLine - rightLine;
  if (left.message !== right.message) return left.message < right.message ? -1 : 1;
  if (left.severity !== right.severity) return left.severity < right.severity ? -1 : 1;
  return 0;
}

function declaredVersion(bundle: Bundle): string | null {
  const root = bundle.documents.find((document) => document.path === "index.md");
  const parsed = root?.frontmatter;
  if (parsed?.error !== undefined || !isMapping(parsed?.data) || parsed.data.okf_version === undefined) return null;
  return String(parsed.data.okf_version);
}

export const defaultRules: readonly Rule[] = [...coreRules, ...boundaryRules, ...advisoryRules];

export async function evaluateBundle(options: EvaluateBundleOptions): Promise<EngineResult> {
  if (options.expectedVersion.trim().length === 0) throw new UnevaluableError("expected OKF version must not be empty");
  const contract = await loadContract(options.contractPath);
  let bundle: Bundle;
  try {
    bundle = await loadBundle(options.provider);
  } catch (error) {
    throw new UnevaluableError(`could not read bundle: ${error instanceof Error ? error.message : String(error)}`);
  }
  const rules = options.rules ?? defaultRules;
  const classified: ClassifiedFinding[] = [];
  const baseContext = {
    bundle,
    contract: contract.contract,
    contractPath: contract.path,
    expectedVersion: options.expectedVersion,
  };

  for (const rule of rules) {
    if (rule.scope === "bundle") {
      for (const item of rule.check(baseContext)) classified.push({ finding: item, dimension: rule.dimension });
    } else {
      for (const document of bundle.documents) {
        for (const item of rule.check({ ...baseContext, document })) {
          classified.push({ finding: item, dimension: rule.dimension });
        }
      }
    }
  }
  classified.sort((left, right) => compareFindings(left.finding, right.finding));
  return {
    bundle,
    bundleName: options.bundle ?? ("root" in options.provider && typeof options.provider.root === "string" ? options.provider.root : "<memory>"),
    expectedVersion: options.expectedVersion,
    declaredVersion: declaredVersion(bundle),
    contract,
    findings: classified.map(({ finding }) => finding),
    classifiedFindings: classified,
    evaluatedRules: [...rules],
  };
}
