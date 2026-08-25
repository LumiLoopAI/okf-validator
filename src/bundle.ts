import { posix } from "node:path";
import { extractFrontmatter, type FrontmatterResult } from "./frontmatter.js";
import type { FileProvider } from "./provider.js";

export type DocumentKind = "concept" | "index" | "log";

export interface BundleFile {
  path: string;
  bytes: Uint8Array;
}

export interface BundleDocument extends BundleFile {
  kind: DocumentKind;
  text?: string;
  utf8Error?: string;
  frontmatter?: FrontmatterResult;
}

export interface Bundle {
  files: readonly BundleFile[];
  documents: readonly BundleDocument[];
  paths: ReadonlySet<string>;
}

function documentKind(path: string): DocumentKind {
  const basename = posix.basename(path);
  if (basename === "index.md") return "index";
  if (basename === "log.md") return "log";
  return "concept";
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
}

export async function loadDocument(provider: FileProvider, path: string): Promise<BundleDocument> {
  if (!path.endsWith(".md")) throw new Error(`document path must name a Markdown file: ${JSON.stringify(path)}`);
  const bytes = Uint8Array.from(await provider.read(path));
  const document: BundleDocument = { path, bytes, kind: documentKind(path) };
  try {
    document.text = decodeUtf8(bytes);
    document.frontmatter = extractFrontmatter(document.text);
  } catch {
    document.utf8Error = "document is not valid UTF-8";
  }
  return document;
}

export async function loadBundle(provider: FileProvider): Promise<Bundle> {
  const listed = await provider.list();
  const paths = [...listed].sort();
  if (new Set(paths).size !== paths.length) throw new Error("file provider returned duplicate paths");

  const files: BundleFile[] = [];
  const documents: BundleDocument[] = [];
  for (const path of paths) {
    if (path.endsWith(".md")) {
      const document = await loadDocument(provider, path);
      files.push(document);
      documents.push(document);
    } else {
      files.push({ path, bytes: Uint8Array.from(await provider.read(path)) });
    }
  }

  return { files, documents, paths: new Set(paths) };
}

export function isRootIndex(document: BundleDocument): boolean {
  return document.kind === "index" && document.path === "index.md";
}
