import type { Bundle, BundleDocument } from "../bundle.js";

export type RuleDimension = "core" | "boundary" | "advisory";
export type RuleScope = "document" | "bundle";

export interface Finding {
  rule: string;
  severity: "error" | "warning" | "advisory";
  path: string;
  message: string;
  line?: number;
}

export interface OkfContract {
  contract_version: string;
  okf_version: string;
  upstream: Record<string, unknown>;
  core_rules: readonly { id: string; [key: string]: unknown }[];
  evaluation_requirements: readonly { id: string; [key: string]: unknown }[];
  [key: string]: unknown;
}

export interface RuleContext {
  bundle: Bundle;
  contract: OkfContract;
  contractPath: string;
  expectedVersion: string;
  document?: BundleDocument;
}

export interface Rule {
  id: string;
  dimension: RuleDimension;
  scope: RuleScope;
  check(ctx: RuleContext): Finding[];
}

export function finding(
  rule: string,
  severity: Finding["severity"],
  path: string,
  message: string,
  line?: number,
): Finding {
  return { rule, severity, path, message, ...(line === undefined ? {} : { line }) };
}
