import { evaluateBundle, type EvaluateBundleOptions } from "./engine.js";
import { createValidationReport, type ValidationReport } from "./report.js";

export { DirectoryProvider, MemoryProvider, type FileProvider } from "./provider.js";
export { extractFrontmatter, isMapping, type FrontmatterError, type FrontmatterResult } from "./frontmatter.js";
export { loadBundle, type Bundle, type BundleDocument, type BundleFile, type DocumentKind } from "./bundle.js";
export {
  UnevaluableError,
  defaultRules,
  evaluateBundle,
  loadContract,
  type ClassifiedFinding,
  type ContractSelection,
  type EngineResult,
  type EvaluateBundleOptions,
} from "./engine.js";
export { createValidationReport, serializeReport, type Recommendation, type ReportFinding, type ValidationReport } from "./report.js";
export { buildManifest, verifyManifest, type BundleManifest, type IntegrityReport, type ManifestEntry } from "./verify.js";
export type { Finding, OkfContract, Rule, RuleContext, RuleDimension, RuleScope } from "./rules/types.js";

export async function validateBundle(options: EvaluateBundleOptions): Promise<ValidationReport> {
  return createValidationReport(await evaluateBundle(options));
}

export function validationExitCode(report: ValidationReport): 0 | 1 {
  return report.status === "pass" ? 0 : 1;
}
