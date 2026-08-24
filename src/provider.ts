import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface FileProvider {
  /** Relative paths of every file in the bundle, with POSIX separators. */
  list(): Promise<string[]>;
  /** Raw file bytes. */
  read(path: string): Promise<Uint8Array>;
}

function assertBundlePath(path: string): void {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`invalid bundle-relative path: ${JSON.stringify(path)}`);
  }
}

function stablePaths(paths: Iterable<string>): string[] {
  const result = [...paths];
  for (const path of result) assertBundlePath(path);
  result.sort();
  for (let index = 1; index < result.length; index += 1) {
    if (result[index] === result[index - 1]) {
      throw new Error(`duplicate bundle path: ${JSON.stringify(result[index])}`);
    }
  }
  return result;
}

export class DirectoryProvider implements FileProvider {
  readonly root: string;

  constructor(root: string) {
    if (root.length === 0) throw new Error("bundle root must not be empty");
    this.root = resolve(root);
  }

  async list(): Promise<string[]> {
    const paths: string[] = [];

    const walk = async (directory: string, prefix: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
      for (const entry of entries) {
        const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        if (entry.isDirectory()) {
          await walk(resolve(directory, entry.name), relative);
        } else if (entry.isFile()) {
          paths.push(relative);
        }
      }
    };

    await walk(this.root, "");
    return stablePaths(paths);
  }

  async read(path: string): Promise<Uint8Array> {
    assertBundlePath(path);
    return readFile(resolve(this.root, ...path.split("/")));
  }
}

export class MemoryProvider implements FileProvider {
  readonly #files: Map<string, Uint8Array>;

  constructor(files: ReadonlyMap<string, Uint8Array | string>) {
    this.#files = new Map();
    for (const [path, value] of files) {
      assertBundlePath(path);
      const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Uint8Array.from(value);
      this.#files.set(path, bytes);
    }
  }

  async list(): Promise<string[]> {
    return stablePaths(this.#files.keys());
  }

  async read(path: string): Promise<Uint8Array> {
    assertBundlePath(path);
    const value = this.#files.get(path);
    if (value === undefined) throw new Error(`bundle file does not exist: ${JSON.stringify(path)}`);
    return Uint8Array.from(value);
  }
}
