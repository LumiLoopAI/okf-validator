import { isMapping } from "../frontmatter.js";
import type { BundleDocument } from "../bundle.js";
import { finding, type Finding, type Rule } from "./types.js";

function currentDocument(ctx: Parameters<Rule["check"]>[0]): BundleDocument {
  if (ctx.document === undefined) throw new Error("document-scoped rule requires a document");
  return ctx.document;
}

function markdownLinesWithoutFences(text: string): { line: string; number: number }[] {
  let fenced = false;
  const result: { line: string; number: number }[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
    } else if (!fenced) {
      result.push({ line, number: index + 1 });
    }
  });
  return result;
}

function validDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export const coreRules: readonly Rule[] = [
  {
    id: "OKF-0.2-C1",
    dimension: "core",
    scope: "document",
    check(ctx): Finding[] {
      const document = currentDocument(ctx);
      if (document.kind !== "concept") return [];
      if (document.utf8Error !== undefined) {
        return [finding(this.id, "error", document.path, document.utf8Error, 1)];
      }
      const parsed = document.frontmatter!;
      if (!parsed.present) {
        return [finding(this.id, "error", document.path, "concept is missing YAML frontmatter", 1)];
      }
      if (parsed.error !== undefined) {
        return [finding(this.id, "error", document.path, parsed.error.message, parsed.error.line)];
      }
      if (!isMapping(parsed.data)) {
        return [finding(this.id, "error", document.path, "frontmatter must parse to a mapping", 1)];
      }
      return [];
    },
  },
  {
    id: "OKF-0.2-C2",
    dimension: "core",
    scope: "document",
    check(ctx): Finding[] {
      const document = currentDocument(ctx);
      const parsed = document.frontmatter;
      if (document.kind !== "concept" || parsed?.error !== undefined || !isMapping(parsed?.data)) return [];
      const type = parsed.data.type;
      if (typeof type === "string" && type.trim().length > 0) return [];
      return [
        finding(
          this.id,
          "error",
          document.path,
          "concept requires a non-empty string type",
          parsed.keyLines.type ?? 1,
        ),
      ];
    },
  },
  {
    id: "OKF-0.2-C3-INDEX",
    dimension: "core",
    scope: "document",
    check(ctx): Finding[] {
      const document = currentDocument(ctx);
      if (document.kind !== "index") return [];
      if (document.utf8Error !== undefined) {
        return [finding(this.id, "error", document.path, document.utf8Error, 1)];
      }
      const parsed = document.frontmatter!;
      if (parsed.error !== undefined) {
        return [finding(this.id, "error", document.path, parsed.error.message, parsed.error.line)];
      }
      const findings: Finding[] = [];
      if (parsed.present && document.path !== "index.md") {
        findings.push(
          finding(this.id, "error", document.path, "only the bundle-root index.md may contain frontmatter", 1),
        );
      } else if (parsed.present) {
        if (!isMapping(parsed.data)) {
          findings.push(finding(this.id, "error", document.path, "root index frontmatter must be a mapping", 1));
        } else {
          const extra = Object.keys(parsed.data).filter((key) => key !== "okf_version").sort();
          if (extra.length > 0) {
            findings.push(
              finding(
                this.id,
                "error",
                document.path,
                `root index frontmatter contains unsupported keys: ${extra.join(", ")}`,
                parsed.keyLines[extra[0]!],
              ),
            );
          }
        }
      }
      const heading = markdownLinesWithoutFences(parsed.body).find(({ line }) => /^#{1,6}\s+\S/.test(line));
      if (heading === undefined) {
        findings.push(
          finding(this.id, "error", document.path, "index must contain a Markdown heading", parsed.bodyStartLine),
        );
      }
      return findings;
    },
  },
  {
    id: "OKF-0.2-C3-LOG",
    dimension: "core",
    scope: "document",
    check(ctx): Finding[] {
      const document = currentDocument(ctx);
      if (document.kind !== "log") return [];
      if (document.utf8Error !== undefined) {
        return [finding(this.id, "error", document.path, document.utf8Error, 1)];
      }
      const parsed = document.frontmatter!;
      const findings: Finding[] = [];
      const lines = markdownLinesWithoutFences(parsed.body);
      const firstContent = lines.find(({ line }) => line.trim().length > 0);
      if (firstContent === undefined || !/^#\s+\S/.test(firstContent.line.trimStart())) {
        findings.push(
          finding(this.id, "error", document.path, "log must begin with a level-one heading", parsed.bodyStartLine),
        );
      }
      const headings = lines.flatMap(({ line, number }) => {
        const match = line.match(/^##\s+(\S.*?)\s*$/);
        return match?.[1] === undefined ? [] : [{ value: match[1], number: number + parsed.bodyStartLine - 1 }];
      });
      if (headings.length === 0) {
        findings.push(
          finding(this.id, "error", document.path, "log must contain ISO 8601 date headings", parsed.bodyStartLine),
        );
        return findings;
      }
      for (const heading of headings) {
        if (!validDate(heading.value)) {
          findings.push(
            finding(this.id, "error", document.path, `invalid log date heading ${JSON.stringify(heading.value)}`, heading.number),
          );
        }
      }
      const valid = headings.filter(({ value }) => validDate(value));
      const sorted = [...valid].sort((left, right) => right.value.localeCompare(left.value));
      if (valid.some((heading, index) => heading.value !== sorted[index]?.value)) {
        findings.push(
          finding(this.id, "error", document.path, "log date headings must be newest first", valid[0]?.number),
        );
      }
      return findings;
    },
  },
];
