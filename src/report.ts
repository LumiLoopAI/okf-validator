import { createRequire } from "node:module";
import type { EngineResult } from "./engine.js";

const require = createRequire(import.meta.url);
const packageMetadata = require("../package.json") as { version: string };

export interface ReportFinding {
  rule: string;
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface Recommendation {
  class: string;
  priority: string;
  target: string;
  finding_rules: string[];
  action: string;
  verification: string;
}

export interface ValidationReport {
  schema_version: "okf-validation-report.v1";
  validator: string;
  status: "pass" | "fail";
  bundle: string;
  expected_okf_version: string;
  declared_okf_version: string | null;
  profile: string;
  dimensions: {
    core_conformance: "pass" | "fail";
    evaluation_boundary: "pass" | "fail";
    advisory_guidance: "clear" | "review";
  };
  contract: {
    path: string;
    sha256: string;
    upstream: Record<string, unknown>;
  };
  metrics: {
    markdown_documents: number;
    concept_documents: number;
    reserved_documents: number;
    errors: number;
    core_errors: number;
    boundary_errors: number;
    warnings: number;
  };
  findings: ReportFinding[];
  recommendations: Recommendation[];
}

function recommendations(findings: readonly ReportFinding[]): Recommendation[] {
  const rules = [...new Set(findings.filter(({ severity }) => severity === "warning").map(({ rule }) => rule))].sort();
  const result: Recommendation[] = [];
  const linkRules = rules.filter((rule) => ["OKF-0.2-A-LINK", "OKF-0.2-A-FRAGMENT", "SECURITY-PATH"].includes(rule));
  if (linkRules.length > 0) {
    result.push({
      class: "interoperability remediation",
      priority: "recommended",
      target: "bundle producer",
      finding_rules: linkRules,
      action: "Review unresolved or escaping references; repair unintended targets and explicitly document intentional incomplete knowledge.",
      verification: "Re-run validation and compare the reference findings.",
    });
  }
  const portableRules = rules.filter((rule) => ["PORTABILITY-METADATA", "PORTABILITY-SYMLINK"].includes(rule));
  if (portableRules.length > 0) {
    result.push({
      class: "optional optimization",
      priority: "optional",
      target: "bundle producer",
      finding_rules: portableRules,
      action: "Exclude platform metadata and replace symlinks with portable declared content when publishing the bundle.",
      verification: "Re-run validation and confirm the portability findings are absent.",
    });
  }
  for (const rule of rules.filter((rule) => !linkRules.includes(rule) && !portableRules.includes(rule))) {
    result.push({
      class: "knowledge-quality improvement",
      priority: "recommended",
      target: "bundle producer",
      finding_rules: [rule],
      action: "Correct the optional OKF v0.2 field shape identified by this rule.",
      verification: "Re-run validation and confirm the rule no longer reports a warning.",
    });
  }
  return result;
}

export function createValidationReport(result: EngineResult): ValidationReport {
  const reportFindings: ReportFinding[] = result.findings.map((item) => ({
    rule: item.rule,
    severity: item.severity === "error" ? "error" : "warning",
    path: item.path,
    message: item.message,
  }));
  const coreErrors = result.classifiedFindings.filter(
    ({ finding, dimension }) => dimension === "core" && finding.severity === "error",
  ).length;
  const boundaryErrors = result.classifiedFindings.filter(
    ({ finding, dimension }) => dimension === "boundary" && finding.severity === "error",
  ).length;
  const errors = reportFindings.filter(({ severity }) => severity === "error").length;
  const warnings = reportFindings.filter(({ severity }) => severity === "warning").length;
  const failed = coreErrors + boundaryErrors > 0;
  const conceptDocuments = result.bundle.documents.filter(({ kind }) => kind === "concept").length;

  return {
    schema_version: "okf-validation-report.v1",
    validator: `okf-validator/${packageMetadata.version}`,
    status: failed ? "fail" : "pass",
    bundle: result.bundleName,
    expected_okf_version: result.expectedVersion,
    declared_okf_version: result.declaredVersion,
    profile: "not_evaluated",
    dimensions: {
      core_conformance: coreErrors === 0 ? "pass" : "fail",
      evaluation_boundary: boundaryErrors === 0 ? "pass" : "fail",
      advisory_guidance: warnings === 0 ? "clear" : "review",
    },
    contract: {
      path: result.contract.path,
      sha256: result.contract.sha256,
      upstream: result.contract.contract.upstream,
    },
    metrics: {
      markdown_documents: result.bundle.documents.length,
      concept_documents: conceptDocuments,
      reserved_documents: result.bundle.documents.length - conceptDocuments,
      errors,
      core_errors: coreErrors,
      boundary_errors: boundaryErrors,
      warnings,
    },
    findings: reportFindings,
    recommendations: recommendations(reportFindings),
  };
}

export function serializeReport(report: ValidationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
