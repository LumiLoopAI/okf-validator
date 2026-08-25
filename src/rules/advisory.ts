import { posix } from "node:path";
import type { BundleDocument } from "../bundle.js";
import { isMapping } from "../frontmatter.js";
import { finding, type Finding, type Rule, type RuleContext } from "./types.js";

interface AdvisoryMetadata {
  requirement: string;
  specSections?: readonly string[];
}

const advisoryMetadata = {
  "OKF-0.2-A-LOG-FRONTMATTER": {
    requirement: "Avoid frontmatter in log.md because OKF defines only its Markdown date-grouped body structure.",
  },
  "OKF-0.2-A-FIELD": {
    requirement: "Recommended title, description, and resource fields should be strings when present.",
    specSections: ["§4.1"],
  },
  "OKF-0.2-A-TAGS": {
    requirement: "The optional tags field should be a YAML list of strings.",
    specSections: ["§4.1"],
  },
  "OKF-0.2-A-STATUS": {
    requirement: "The optional status field should be draft, stable, or deprecated.",
    specSections: ["§5.4"],
  },
  "OKF-0.2-A-GENERATED": {
    requirement: "The optional generated field should identify a valid actor and use an explicit-offset ISO 8601 datetime when at is present.",
    specSections: ["§5", "§5.2", "§7"],
  },
  "OKF-0.2-A-VERIFIED": {
    requirement: "Each optional verification event should identify a valid actor and an explicit-offset ISO 8601 datetime.",
    specSections: ["§5", "§5.2", "§7"],
  },
  "OKF-0.2-A-STALE": {
    requirement: "The optional stale_after field should be an explicit-offset ISO 8601 datetime.",
    specSections: ["§5", "§5.5"],
  },
  "OKF-0.2-A-USAGE-WINDOW": {
    requirement: "The optional usage_window field should contain explicit-offset ISO 8601 from and to datetimes.",
    specSections: ["§5", "§5.1"],
  },
  "OKF-0.2-A-SOURCES": {
    requirement: "The optional sources field should be a list of provenance entries.",
    specSections: ["§5.1"],
  },
  "OKF-0.2-A-SOURCE": {
    requirement: "Each source should name a non-empty resource and use valid optional credibility signals.",
    specSections: ["§5", "§5.1"],
  },
  "OKF-0.2-A-SOURCE-ID": {
    requirement: "Source ids used as stable attribution keys should be unique within a concept.",
    specSections: ["§5.1"],
  },
  "OKF-0.2-A-LINK": {
    requirement: "Internal Markdown links and path-valued fields should use inspectable targets, while unresolved targets remain conformant.",
    specSections: ["§6.1", "§6.2", "§11"],
  },
  "OKF-0.2-A-FRAGMENT": {
    requirement: "Internal Markdown fragments should resolve to a heading in the target document.",
  },
  "SECURITY-PATH": {
    requirement: "Internal references should remain within the evaluated bundle boundary.",
  },
  "OKF-0.2-A-INDEX": {
    requirement: "Index files should enumerate directory contents with Markdown links for progressive disclosure.",
    specSections: ["§8"],
  },
  "OKF-0.2-A-PORTABLE": {
    requirement: "Published bundles should contain portable declared content and exclude platform-specific artifacts.",
  },
  "PORTABILITY-METADATA": {
    requirement: "Published bundles should exclude platform-specific metadata files.",
  },
} as const satisfies Record<string, AdvisoryMetadata>;

type AdvisoryRuleId = keyof typeof advisoryMetadata;

function advisoryFinding(
  rule: AdvisoryRuleId,
  severity: Finding["severity"],
  path: string,
  message: string,
  line?: number,
): Finding {
  return { ...finding(rule, severity, path, message, line), ...advisoryMetadata[rule] };
}

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
    return advisoryFinding("OKF-0.2-A-LINK", "warning", source.path, `reference could not be inspected: ${destination.value}`, destination.line);
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
    return advisoryFinding("SECURITY-PATH", "warning", source.path, `reference escapes the bundle: ${destination.value}`, destination.line);
  }
  const target = joined === "." ? "" : joined.replace(/\/$/, "");
  const exists =
    target === "" || ctx.bundle.paths.has(target) || [...ctx.bundle.paths].some((path) => path.startsWith(`${target}/`));
  if (!exists) {
    return advisoryFinding("OKF-0.2-A-LINK", "warning", source.path, `reference target is missing: ${destination.value}`, destination.line);
  }
  if (fragment !== undefined && fragment.length > 0 && ctx.bundle.paths.has(target) && target.toLowerCase().endsWith(".md")) {
    const targetDocument = ctx.bundle.documents.find((document) => document.path === target);
    if (targetDocument?.text !== undefined && !headingSlugs(targetDocument.text).includes(fragment.toLowerCase())) {
      return advisoryFinding("OKF-0.2-A-FRAGMENT", "warning", source.path, `reference fragment is missing: ${destination.value}`, destination.line);
    }
  }
  return undefined;
}

function pathFieldDestinations(document: BundleDocument, data: Record<string, unknown>): Destination[] {
  const values: { value: unknown; key: string }[] = [
    { value: data.resource, key: "resource" },
    { value: data.computation, key: "computation" },
  ];
  if (isMapping(data.executor)) values.push({ value: data.executor.resource, key: "executor" });
  if (isMapping(data.attester)) values.push({ value: data.attester.resource, key: "attester" });
  if (Array.isArray(data.sources)) {
    for (const source of data.sources) {
      if (isMapping(source)) values.push({ value: source.resource, key: "sources" });
    }
  }
  return values.flatMap(({ value, key }) => pathLike(value) ? [{ value, line: lineFor(document, key) }] : []);
}

function validateWindow(value: unknown): boolean {
  return isMapping(value) && explicitOffsetDatetime(value.from) && explicitOffsetDatetime(value.to);
}

export const advisoryRules: readonly Rule[] = [
  {
    id: "OKF-0.2-A-LOG-FRONTMATTER",
    dimension: "advisory",
    scope: "document",
    ...advisoryMetadata["OKF-0.2-A-LOG-FRONTMATTER"],
    check(ctx) {
      const document = ctx.document;
      if (document?.kind !== "log" || document.frontmatter?.present !== true) return [];
      return [advisoryFinding(this.id as AdvisoryRuleId, "warning", document.path, "log.md carries a frontmatter block; the OKF specification does not define frontmatter for log files", 1)];
    },
  },
  {
    id: "OKF-0.2-A-FIELD",
    dimension: "advisory",
    scope: "document",
    ...advisoryMetadata["OKF-0.2-A-FIELD"],
    check(ctx) {
      const document = currentConcept(ctx);
      const data = conceptData(document);
      if (document === undefined || data === undefined) return [];
      return ["title", "description", "resource"].flatMap((key) =>
        key in data && typeof data[key] !== "string"
          ? [advisoryFinding(this.id as AdvisoryRuleId, "warning", document.path, `${key} should be a string`, lineFor(document, key))]
          : [],
      );
    },
  },
  {
    id: "OKF-0.2-A-TAGS",
    dimension: "advisory",
    scope: "document",
    ...advisoryMetadata["OKF-0.2-A-TAGS"],
    check(ctx) {
      const document = currentConcept(ctx);
      const data = conceptData(document);
      if (document === undefined || data === undefined || !("tags" in data)) return [];
      if (Array.isArray(data.tags) && data.tags.every((tag) => typeof tag === "string")) return [];
      return [advisoryFinding(this.id as AdvisoryRuleId, "warning", document.path, "tags should be a list of strings", lineFor(document, "tags"))];
    },
  },
  {
    id: "OKF-0.2-A-STATUS",
    dimension: "advisory",
    scope: "document",
    ...advisoryMetadata["OKF-0.2-A-STATUS"],
    check(ctx) {
      const document = currentConcept(ctx);
      const data = conceptData(document);
      if (document === undefined || data === undefined || !("status" in data)) return [];
      if (["draft", "stable", "deprecated"].includes(String(data.status))) return [];
      return [advisoryFinding(this.id as AdvisoryRuleId, "warning", document.path, "status should be draft, stable, or deprecated", lineFor(document, "status"))];
    },
  },
  {
    id: "OKF-0.2-A-GENERATED",
    dimension: "advisory",
    scope: "document",
    ...advisoryMetadata["OKF-0.2-A-GENERATED"],
    check(ctx) {
      const document = currentConcept(ctx);
      const data = conceptData(document);
      if (document === undefined || data === undefined || !("generated" in data)) return [];
      const generated = data.generated;
      if (isMapping(generated) && actor(generated.by) && (generated.at === undefined || explicitOffsetDatetime(generated.at))) return [];
      return [
        advisoryFinding(
          this.id as AdvisoryRuleId,
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
    ...advisoryMetadata["OKF-0.2-A-VERIFIED"],
    check(ctx) {
      const document = currentConcept(ctx);
      const data = conceptData(document);
      if (document === undefined || data === undefined || !("verified" in data)) return [];
      const entries = Array.isArray(data.verified) ? data.verified : [data.verified];
      if (entries.every((entry) => isMapping(entry) && actor(entry.by) && explicitOffsetDatetime(entry.at))) return [];
      return [
        advisoryFinding(
          this.id as AdvisoryRuleId,
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
    ...advisoryMetadata["OKF-0.2-A-STALE"],
    check(ctx) {
      const document = currentConcept(ctx);
      const data = conceptData(document);
      if (document === undefined || data === undefined || !("stale_after" in data) || explicitOffsetDatetime(data.stale_after)) return [];
      return [
        advisoryFinding(this.id as AdvisoryRuleId, "warning", document.path, "stale_after should be an explicit-offset ISO 8601 datetime", lineFor(document, "stale_after")),
      ];
    },
  },
  {
    id: "OKF-0.2-A-USAGE-WINDOW",
    dimension: "advisory",
    scope: "document",
    ...advisoryMetadata["OKF-0.2-A-USAGE-WINDOW"],
    check(ctx) {
      const document = currentConcept(ctx);
      const data = conceptData(document);
      if (document === undefined || data === undefined || !("usage_window" in data) || validateWindow(data.usage_window)) return [];
      return [
        advisoryFinding(
          this.id as AdvisoryRuleId,
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
    ...advisoryMetadata["OKF-0.2-A-SOURCE"],
    check(ctx) {
      const findings: Finding[] = [];
      for (const document of ctx.bundle.documents) {
        const data = conceptData(document);
        if (document.kind !== "concept" || data === undefined || !("sources" in data)) continue;
        if (!Array.isArray(data.sources)) {
          findings.push(advisoryFinding("OKF-0.2-A-SOURCES", "warning", document.path, "sources should be a list", lineFor(document, "sources")));
          continue;
        }
        const ids = new Map<string, number>();
        data.sources.forEach((source, index) => {
          if (!isMapping(source) || typeof source.resource !== "string" || source.resource.trim().length === 0) {
            findings.push(advisoryFinding(this.id as AdvisoryRuleId, "warning", document.path, `sources[${index}] should contain a non-empty resource`, lineFor(document, "sources")));
            return;
          }
          if (source.id !== undefined && typeof source.id === "string") ids.set(source.id, (ids.get(source.id) ?? 0) + 1);
          const timestampValid = source.last_modified === undefined || explicitOffsetDatetime(source.last_modified);
          const windowValid = source.usage_window === undefined || validateWindow(source.usage_window);
          const countValid = source.usage_count === undefined || (Number.isInteger(source.usage_count) && Number(source.usage_count) >= 0);
          if (!timestampValid || !windowValid || !countValid) {
            findings.push(advisoryFinding(this.id as AdvisoryRuleId, "warning", document.path, `sources[${index}] has an invalid credibility signal`, lineFor(document, "sources")));
          }
        });
        for (const id of [...ids.entries()].filter(([, count]) => count > 1).map(([id]) => id).sort()) {
          findings.push(advisoryFinding("OKF-0.2-A-SOURCE-ID", "warning", document.path, `source id ${JSON.stringify(id)} is duplicated`, lineFor(document, "sources")));
        }
      }
      return findings;
    },
  },
  {
    id: "OKF-0.2-A-LINK",
    dimension: "advisory",
    scope: "bundle",
    ...advisoryMetadata["OKF-0.2-A-LINK"],
    check(ctx) {
      const findings: Finding[] = [];
      for (const document of ctx.bundle.documents) {
        if (document.text === undefined) continue;
        const mirroredReference = document.path.split("/").includes("_references") && posix.basename(document.path) !== "index.md";
        const bodyDestinations = mirroredReference ? [] : markdownDestinations(document.text);
        const data = conceptData(document);
        const destinations = [...bodyDestinations, ...(data === undefined ? [] : pathFieldDestinations(document, data))];
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
    ...advisoryMetadata["OKF-0.2-A-INDEX"],
    check(ctx) {
      const document = ctx.document;
      if (
        document?.kind !== "index" ||
        document.text === undefined ||
        document.frontmatter?.error !== undefined ||
        markdownDestinations(document.frontmatter?.body ?? document.text).length > 0
      ) return [];
      return [advisoryFinding(this.id as AdvisoryRuleId, "warning", document.path, "index contains no Markdown links", document.frontmatter?.bodyStartLine)];
    },
  },
  {
    id: "OKF-0.2-A-PORTABLE",
    dimension: "advisory",
    scope: "bundle",
    ...advisoryMetadata["OKF-0.2-A-PORTABLE"],
    check(ctx) {
      return ctx.bundle.files.flatMap((file) =>
        posix.basename(file.path) === ".DS_Store"
          ? [advisoryFinding("PORTABILITY-METADATA", "warning", file.path, "platform metadata should be excluded from published bundles")]
          : [],
      );
    },
  },
];
