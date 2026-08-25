import { readFileSync } from "node:fs";

export interface OkfSpecSectionSummary {
  id: string;
  title: string;
  level: number;
}

export interface OkfSpecSection {
  id: string;
  title: string;
  text: string;
}

interface ParsedSpecSection extends OkfSpecSectionSummary {
  start: number;
  end: number;
}

const specText = readFileSync(new URL("../spec/SPEC.md", import.meta.url), "utf8");
const parsedSections = parseSections(specText);

function slugify(title: string): string {
  return title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function comparableTitle(title: string): string {
  return title
    .normalize("NFKC")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function parseSections(markdown: string): ParsedSpecSection[] {
  const headings: Array<Omit<ParsedSpecSection, "end">> = [];
  const slugCounts = new Map<string, number>();
  const lines = markdown.match(/[^\n]*(?:\n|$)/g) ?? [];
  let offset = 0;
  let fence: { marker: "`" | "~"; length: number } | null = null;

  for (const lineWithEnding of lines) {
    if (lineWithEnding.length === 0) continue;
    const line = lineWithEnding.endsWith("\n")
      ? lineWithEnding.slice(0, -1).replace(/\r$/, "")
      : lineWithEnding.replace(/\r$/, "");

    if (fence) {
      const closingFence = /^[ \t]{0,3}(`+|~+)[ \t]*$/.exec(line);
      if (
        closingFence
        && closingFence[1][0] === fence.marker
        && closingFence[1].length >= fence.length
      ) {
        fence = null;
      }
      offset += lineWithEnding.length;
      continue;
    }

    const openingFence = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line);
    if (openingFence) {
      fence = {
        marker: openingFence[1][0] as "`" | "~",
        length: openingFence[1].length,
      };
      offset += lineWithEnding.length;
      continue;
    }

    const heading = /^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
    if (heading) {
      const headingText = heading[2].replace(/[ \t]+#+[ \t]*$/, "");
      const numbered = /^(\d+(?:\.\d+)*)(?:\.)?[ \t]+(.+)$/.exec(headingText);
      const title = numbered ? numbered[2] : headingText;
      let id: string;

      if (numbered) {
        id = numbered[1];
      } else {
        const baseSlug = slugify(title);
        const count = (slugCounts.get(baseSlug) ?? 0) + 1;
        slugCounts.set(baseSlug, count);
        id = count === 1 ? baseSlug : `${baseSlug}-${count}`;
      }

      headings.push({
        id,
        title,
        level: heading[1].length,
        start: offset,
      });
    }

    offset += lineWithEnding.length;
  }

  return headings.map((section, index) => {
    const next = headings.slice(index + 1).find(({ level }) => level <= section.level);
    return { ...section, end: next?.start ?? markdown.length };
  });
}

/** Return all canonical Markdown sections in document order. */
export function listOkfSpecSections(): OkfSpecSectionSummary[] {
  return parsedSections.map(({ id, title, level }) => ({ id, title, level }));
}

/** Resolve a canonical section number, contract citation, or heading title. */
export function readOkfSpecSection(idOrTitle: string): OkfSpecSection | null {
  const input = idOrTitle.trim().replace(/^§\s*/, "");
  const citation = /^(\d+(?:\.\d+)*)(?:\s+item\s+\d+.*)?$/i.exec(input);
  const normalizedTitle = comparableTitle(input);
  // Keep the authoring-oriented title form requested by the public API tied to
  // the frontmatter rules, while section metadata remains faithful to the spec.
  const titleAlias = normalizedTitle === "concept documents" ? "4.1" : null;
  const section = citation || titleAlias
    ? parsedSections.find(({ id }) => id === (citation?.[1] ?? titleAlias))
    : parsedSections.find(({ title }) => comparableTitle(title) === normalizedTitle);

  if (!section) return null;
  return {
    id: section.id,
    title: section.title,
    text: specText.slice(section.start, section.end).trimEnd(),
  };
}

/** Return the specification's terminology and conformance sections. */
export function readOkfSpecOverview(): string {
  const terminology = readOkfSpecSection("2");
  const conformance = readOkfSpecSection("11");
  if (!terminology || !conformance) {
    throw new Error("Vendored OKF specification is missing §2 or §11");
  }
  return `${terminology.text}\n\n${conformance.text}`;
}
