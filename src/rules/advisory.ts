import { posix } from "node:path";
import type { BundleDocument } from "../bundle.js";
import { isMapping } from "../frontmatter.js";
import { finding, type Finding, type Rule, type RuleContext } from "./types.js";

function currentConcept(ctx: RuleContext): BundleDocument | undefined {
  return ctx.document?.kind === "concept" ? ctx.document : undefined;
}

function conceptData(document: BundleDocument | undefined): Record<string, unknown> | undefined {
  const parsed = document?.frontmatter;
  return parsed?.error === undefined && isMapping(parsed?.data) ? parsed.data : undefined;
}

function explicitOffsetDatetime(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (match === null || !Number.isFinite(Date.parse(value))) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3]) &&
    Number(match[4]) <= 23 &&
    Number(match[5]) <= 59 &&
    Number(match[6]) <= 59
  );
}

function actor(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    (/^(?:human|process):\S+$/.test(value) || /^\S+\/\S+$/.test(value))
  );
}

function lineFor(document: BundleDocument, key: string): number | undefined {
  return document.frontmatter?.keyLines[key];
}

function withoutFences(text: string): { line: string; number: number }[] {
  let fenced = false;
  const result: { line: string; number: number }[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced) result.push({ line, number: index + 1 });
  });
  return result;
}

interface Destination {
  value: string;
  line?: number;
}

function markdownDestinations(text: string): Destination[] {
  const destinations: Destination[] = [];
  const pattern = /!?\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  for (const entry of withoutFences(text)) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(entry.line)) !== null) {
      const raw = match[1]!;
      destinations.push({ value: raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw, line: entry.number });
    }
    pattern.lastIndex = 0;
  }
  return destinations;
}

function pathLike(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return false;
  if (/^[^./][^/]*\s+[^/]*$/.test(value)) return false;
  return value.startsWith(".") || value.startsWith("/") || value.includes("/") || value.endsWith(".md") || value.startsWith("#");
}

function headingSlugs(text: string): string[] {
  const seen = new Map<string, number>();
  const slugs: string[] = [];
  for (const { line } of withoutFences(text)) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (match?.[1] === undefined) continue;
    const slug = match[1]
      .toLowerCase()
      .trim()
      .replace(/<[^>]*>/g, "")
      .replace(/[\u2000-\u206f\u2e00-\u2e7f\\'!"#$%&()*+,./:;<=>?@[\]^`{|}~]/gu, "")
      .replace(/\s/gu, "-");
    const candidates = [slug, slug.replace(/\p{S}/gu, "")].filter((value, index, all) => all.indexOf(value) === index);
    for (const candidate of candidates) {
      const count = seen.get(candidate) ?? 0;
      seen.set(candidate, count + 1);
      slugs.push(count === 0 ? candidate : `${candidate}-${count}`);
    }
  }
  return slugs;
}

function inspectDestination(ctx: RuleContext, source: BundleDocument, destination: Destination): Finding | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(destination.value);
  } catch {
    return finding("OKF-0.2-A-LINK", "warning", source.path, `reference could not be inspected: ${destination.value}`, destination.line);
  }
  const hash = decoded.indexOf("#");
  const rawPath = (hash === -1 ? decoded : decoded.slice(0, hash)).split("?", 1)[0]!;
  const fragment = hash === -1 ? undefined : decoded.slice(hash + 1);
  const joined = rawPath === ""
    ? source.path
    : rawPath.startsWith("/")
      ? posix.normalize(rawPath.replace(/^\/+/, ""))
      : posix.normalize(posix.join(posix.dirname(source.path), rawPath));
  if (joined === ".." || joined.startsWith("../") || posix.isAbsolute(joined)) {
    return finding("SECURITY-PATH", "warning", source.path, `reference escapes the bundle: ${destination.value}`, destination.line);
  }
  const target = joined === "." ? "" : joined.replace(/\/$/, "");
  const exists =
    target === "" || ctx.bundle.paths.has(target) || [...ctx.bundle.paths].some((path) => path.startsWith(`${target}/`));
  if (!exists) {
    return finding("OKF-0.2-A-LINK", "warning", source.path, `reference target is missing: ${destination.value}`, destination.line);
  }
  if (fragment !== undefined && fragment.length > 0 && ctx.bundle.paths.has(target) && target.toLowerCase().endsWith(".md")) {
    const targetDocument = ctx.bundle.documents.find((document) => document.path === target);
    if (targetDocument?.text !== undefined && !headingSlugs(targetDocument.text).includes(fragment.toLowerCase())) {
      return finding("OKF-0.2-A-FRAGMENT", "warning", source.path, `reference fragment is missing: ${destination.value}`, destination.line);
    }
  }
  return undefined;
}

function pathFieldDestinations(data: Record<string, unknown>): Destination[] {
  const values: unknown[] = [data.resource, data.computation];
  if (isMapping(data.executor)) values.push(data.executor.resource);
  if (isMapping(data.attester)) values.push(data.attester.resource);
  if (Array.isArray(data.sources)) {
    for (const source of data.sources) if (isMapping(source)) values.push(source.resource);
  }
  return values.filter(pathLike).map((value) => ({ value }));
}

function validateWindow(value: unknown): boolean {
  return isMapping(value) && explicitOffsetDatetime(value.from) && explicitOffsetDatetime(value.to);
}

export const advisoryRules: readonly Rule[] = [
  {
    id: "OKF-0.2-A-LOG-FRONTMATTER",
    dimension: "advisory",
    scope: "document",
    check(ctx) {
      const document = ctx.document;
      if (document?.kind !== "log" || document.frontmatter?.present !== true) return [];
      return [finding(this.id, "warning", document.path, "log.md carries a frontmatter block; the OKF specification does not define frontmatter for log files", 1)];
    },
  },
  {
    id: "OKF-0.2-A-FIELD",
    dimension: "advisory",
    scope: "document",
    check(ctx) {
      const document = currentConcept(ctx);
      const data = conceptData(document);
      if (document === undefined || data === undefined) return [];
      return ["title", "description", "resource"].flatMap((key) =>
        key in data && typeof data[key] !== "string"
          ? [finding(this.id, "warning", document.path, `${key} should be a string`, lineFor(document, key))]
          : [],
      );
    },
  },
  {
    id: "OKF-0.2-A-TAGS",
    dimension: "advisory",
    scope: "document",
    check(ctx) {
      const document = currentConcept(ctx);
      const data = conceptData(document);
      if (document === undefined || data === undefined || !("tags" in data)) return [];
      if (Array.isArray(data.tags) && data.tags.every((tag) => typeof tag === "string")) return [];
      return [finding(this.id, "warning", document.path, "tags should be a list of strings", lineFor(document, "tags"))];
    },
  },
  {
    id: "OKF-0.2-A-STATUS",
    dimension: "advisory",
    scope: "document",
    check(ctx) {
      const document = currentConcept(ctx);
      const data = conceptData(document);
      if (document === undefined || data === undefined || !("status" in data)) return [];
      if (["draft", "stable", "deprecated"].includes(String(data.status))) return [];
      return [finding(this.id, "warning", document.path, "status should be draft, stable, or deprecated", lineFor(document, "status"))];
    },
  },
  {
    id: "OKF-0.2-A-GENERATED",
    dimension: "advisory",
    scope: "document",
    check(ctx) {
      const document = currentConcept(ctx);
      const data = conceptData(document);
      if (document === undefined || data === undefined || !("generated" in data)) return [];
      const generated = data.generated;
      if (isMapping(generated) && actor(generated.by) && (generated.at === undefined || explicitOffsetDatetime(generated.at))) return [];
      return [
        finding(
          this.id,
          "warning",
          document.path,
          "generated should be a mapping with a valid by actor and an explicit-offset ISO 8601 at datetime",
          lineFor(document, "generated"),
        ),
      ];
    },
  },
  {
    id: "OKF-0.2-A-VERIFIED",
    dimension: "advisory",
    scope: "document",
    check(ctx) {
      const document = currentConcept(ctx);
      const data = conceptData(document);
      if (document === undefined || data === undefined || !("verified" in data)) return [];
      const entries = Array.isArray(data.verified) ? data.verified : [data.verified];
      if (entries.every((entry) => isMapping(entry) && actor(entry.by) && explicitOffsetDatetime(entry.at))) return [];
      return [
        finding(
          this.id,
          "warning",
          document.path,
          "verified should contain mappings with a valid by actor and an explicit-offset ISO 8601 at datetime",
          lineFor(document, "verified"),
        ),
      ];
    },
  },
  {
    id: "OKF-0.2-A-STALE",
    dimension: "advisory",
    scope: "document",
    check(ctx) {
      const document = currentConcept(ctx);
      const data = conceptData(document);
      if (document === undefined || data === undefined || !("stale_after" in data) || explicitOffsetDatetime(data.stale_after)) return [];
      return [
        finding(this.id, "warning", document.path, "stale_after should be an explicit-offset ISO 8601 datetime", lineFor(document, "stale_after")),
      ];
    },
  },
  {
    id: "OKF-0.2-A-USAGE-WINDOW",
    dimension: "advisory",
    scope: "document",
    check(ctx) {
      const document = currentConcept(ctx);
      const data = conceptData(document);
      if (document === undefined || data === undefined || !("usage_window" in data) || validateWindow(data.usage_window)) return [];
      return [
        finding(
          this.id,
          "warning",
          document.path,
          "usage_window should contain explicit-offset ISO 8601 from and to datetimes",
          lineFor(document, "usage_window"),
        ),
      ];
    },
  },
  {
    id: "OKF-0.2-A-SOURCE",
    dimension: "advisory",
    scope: "bundle",
    check(ctx) {
      const findings: Finding[] = [];
      for (const document of ctx.bundle.documents) {
        const data = conceptData(document);
        if (document.kind !== "concept" || data === undefined || !("sources" in data)) continue;
        if (!Array.isArray(data.sources)) {
          findings.push(finding("OKF-0.2-A-SOURCES", "warning", document.path, "sources should be a list", lineFor(document, "sources")));
          continue;
        }
        const ids = new Map<string, number>();
        data.sources.forEach((source, index) => {
          if (!isMapping(source) || typeof source.resource !== "string" || source.resource.trim().length === 0) {
            findings.push(finding(this.id, "warning", document.path, `sources[${index}] should contain a non-empty resource`, lineFor(document, "sources")));
            return;
          }
          if (source.id !== undefined && typeof source.id === "string") ids.set(source.id, (ids.get(source.id) ?? 0) + 1);
          const timestampValid = source.last_modified === undefined || explicitOffsetDatetime(source.last_modified);
          const windowValid = source.usage_window === undefined || validateWindow(source.usage_window);
          const countValid = source.usage_count === undefined || (Number.isInteger(source.usage_count) && Number(source.usage_count) >= 0);
          if (!timestampValid || !windowValid || !countValid) {
            findings.push(finding(this.id, "warning", document.path, `sources[${index}] has an invalid credibility signal`, lineFor(document, "sources")));
          }
        });
        for (const id of [...ids.entries()].filter(([, count]) => count > 1).map(([id]) => id).sort()) {
          findings.push(finding("OKF-0.2-A-SOURCE-ID", "warning", document.path, `source id ${JSON.stringify(id)} is duplicated`, lineFor(document, "sources")));
        }
      }
      return findings;
    },
  },
  {
    id: "OKF-0.2-A-LINK",
    dimension: "advisory",
    scope: "bundle",
    check(ctx) {
      const findings: Finding[] = [];
      for (const document of ctx.bundle.documents) {
        if (document.text === undefined) continue;
        const mirroredReference = document.path.split("/").includes("_references") && posix.basename(document.path) !== "index.md";
        const bodyDestinations = mirroredReference ? [] : markdownDestinations(document.text);
        const data = conceptData(document);
        const destinations = [...bodyDestinations, ...(data === undefined ? [] : pathFieldDestinations(data))];
        const unique = new Map<string, Destination>();
        for (const destination of destinations) if (!unique.has(destination.value)) unique.set(destination.value, destination);
        for (const destination of [...unique.values()].sort((left, right) => left.value < right.value ? -1 : left.value > right.value ? 1 : 0)) {
          if (!pathLike(destination.value)) continue;
          const inspected = inspectDestination(ctx, document, destination);
          if (inspected !== undefined) findings.push(inspected);
        }
      }
      return findings;
    },
  },
  {
    id: "OKF-0.2-A-INDEX",
    dimension: "advisory",
    scope: "document",
    check(ctx) {
      const document = ctx.document;
      if (
        document?.kind !== "index" ||
        document.text === undefined ||
        document.frontmatter?.error !== undefined ||
        markdownDestinations(document.frontmatter?.body ?? document.text).length > 0
      ) return [];
      return [finding(this.id, "warning", document.path, "index contains no Markdown links", document.frontmatter?.bodyStartLine)];
    },
  },
  {
    id: "OKF-0.2-A-PORTABLE",
    dimension: "advisory",
    scope: "bundle",
    check(ctx) {
      return ctx.bundle.files.flatMap((file) =>
        posix.basename(file.path) === ".DS_Store"
          ? [finding("PORTABILITY-METADATA", "warning", file.path, "platform metadata should be excluded from published bundles")]
          : [],
      );
    },
  },
];
