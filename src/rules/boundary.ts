import { isMapping } from "../frontmatter.js";
import { finding, type Rule } from "./types.js";

export const boundaryRules: readonly Rule[] = [
  {
    id: "BOUNDARY-CONTRACT",
    dimension: "boundary",
    scope: "bundle",
    check(ctx) {
      if (ctx.contract.okf_version === ctx.expectedVersion) return [];
      return [
        finding(
          this.id,
          "error",
          ctx.contractPath,
          `contract version does not match expected version ${JSON.stringify(ctx.expectedVersion)}`,
        ),
      ];
    },
  },
  {
    id: "BOUNDARY-VERSION",
    dimension: "boundary",
    scope: "bundle",
    check(ctx) {
      const rootIndex = ctx.bundle.documents.find((document) => document.path === "index.md");
      const parsed = rootIndex?.frontmatter;
      if (parsed?.error !== undefined || !isMapping(parsed?.data)) return [];
      const declared = parsed.data.okf_version;
      if (declared === undefined || String(declared) === ctx.expectedVersion) return [];
      return [
        finding(
          this.id,
          "error",
          "index.md",
          `declared OKF version ${JSON.stringify(declared)} does not match expected ${JSON.stringify(ctx.expectedVersion)}`,
          parsed.keyLines.okf_version,
        ),
      ];
    },
  },
];
