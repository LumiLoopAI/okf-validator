import { JSON_SCHEMA, load } from "js-yaml";

export interface FrontmatterError {
  message: string;
  line?: number;
}

export interface FrontmatterResult {
  present: boolean;
  data?: unknown;
  body: string;
  bodyStartLine: number;
  startLine?: number;
  endLine?: number;
  keyLines: Readonly<Record<string, number>>;
  error?: FrontmatterError;
}

function linesWithEndings(text: string): string[] {
  return text.match(/.*(?:\r\n|\n|\r|$)/g)?.filter((line) => line.length > 0) ?? [];
}

function withoutEnding(line: string): string {
  return line.replace(/(?:\r\n|\n|\r)$/, "");
}

function yamlError(error: unknown): FrontmatterError {
  if (error !== null && typeof error === "object" && "mark" in error) {
    const mark = (error as { mark?: { line?: number } }).mark;
    const reason = "reason" in error ? String((error as { reason?: unknown }).reason) : String(error);
    return {
      message: `YAML parse error: ${reason.split(/\r?\n/, 1)[0]}`,
      ...(typeof mark?.line === "number" ? { line: mark.line + 2 } : {}),
    };
  }
  return { message: `YAML parse error: ${String(error).split(/\r?\n/, 1)[0]}` };
}

export function extractFrontmatter(text: string): FrontmatterResult {
  const lines = linesWithEndings(text);
  if (lines.length === 0 || withoutEnding(lines[0]!) !== "---") {
    return { present: false, body: text, bodyStartLine: 1, keyLines: {} };
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && withoutEnding(line) === "---");
  if (closingIndex === -1) {
    return {
      present: true,
      body: "",
      bodyStartLine: lines.length + 1,
      startLine: 1,
      keyLines: {},
      error: { message: "frontmatter has no closing delimiter", line: 1 },
    };
  }

  const yamlLines = lines.slice(1, closingIndex);
  const yaml = yamlLines.join("");
  const keyLines: Record<string, number> = {};
  yamlLines.forEach((line, index) => {
    const match = withoutEnding(line).match(/^([^\s#][^:]*):(?:\s|$)/);
    if (match?.[1] !== undefined && keyLines[match[1].trim()] === undefined) {
      keyLines[match[1].trim()] = index + 2;
    }
  });

  const base = {
    present: true,
    body: lines.slice(closingIndex + 1).join(""),
    bodyStartLine: closingIndex + 2,
    startLine: 1,
    endLine: closingIndex + 1,
    keyLines,
  } as const;

  try {
    return { ...base, data: load(yaml, { schema: JSON_SCHEMA }) };
  } catch (error) {
    const parsedError = yamlError(error);
    if (parsedError.line !== undefined) parsedError.line = Math.min(parsedError.line, closingIndex);
    return { ...base, error: parsedError };
  }
}

export function isMapping(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
