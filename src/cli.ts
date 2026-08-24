#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DirectoryProvider } from "./provider.js";
import { UnevaluableError } from "./engine.js";
import { serializeReport } from "./report.js";
import { buildManifest, verifyManifest, type BundleManifest } from "./verify.js";
import { validateBundle, validationExitCode } from "./index.js";

type Options = Record<string, string>;

function usage(): string {
  return [
    "Usage:",
    "  okf-validator validate --bundle PATH --contract PATH --expected-version VERSION --output PATH",
    "  okf-validator manifest --bundle PATH --output PATH",
    "  okf-validator verify --bundle PATH --baseline PATH --output PATH",
  ].join("\n");
}

function parseOptions(args: string[], allowed: ReadonlySet<string>): Options {
  const options: Options = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === undefined || !flag.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new UnevaluableError("invalid command options");
    }
    const name = flag.slice(2);
    if (!allowed.has(name)) throw new UnevaluableError(`unknown option: ${flag}`);
    if (options[name] !== undefined) throw new UnevaluableError(`duplicate option: ${flag}`);
    options[name] = value;
  }
  return options;
}

function required(options: Options, ...names: string[]): void {
  const missing = names.filter((name) => options[name] === undefined || options[name] === "");
  if (missing.length > 0) throw new UnevaluableError(`missing required option(s): ${missing.map((name) => `--${name}`).join(", ")}`);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const json = `${JSON.stringify(value, null, 2)}\n`;
  if (path === "-") {
    process.stdout.write(json);
    return;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, json, "utf8");
}

async function main(args: string[]): Promise<0 | 1> {
  const command = args[0];
  if (command === "validate") {
    const options = parseOptions(args.slice(1), new Set(["bundle", "contract", "expected-version", "output"]));
    required(options, "bundle", "contract", "expected-version", "output");
    const report = await validateBundle({
      provider: new DirectoryProvider(options.bundle!),
      bundle: options.bundle!,
      contractPath: options.contract!,
      expectedVersion: options["expected-version"]!,
    });
    if (options.output === "-") process.stdout.write(serializeReport(report));
    else await writeJson(options.output!, report);
    return validationExitCode(report);
  }
  if (command === "manifest") {
    const options = parseOptions(args.slice(1), new Set(["bundle", "output"]));
    required(options, "bundle", "output");
    await writeJson(options.output!, await buildManifest(new DirectoryProvider(options.bundle!), options.bundle!));
    return 0;
  }
  if (command === "verify") {
    const options = parseOptions(args.slice(1), new Set(["bundle", "baseline", "output"]));
    required(options, "bundle", "baseline", "output");
    let baseline: BundleManifest;
    try {
      baseline = JSON.parse(await readFile(options.baseline!, "utf8")) as BundleManifest;
    } catch (error) {
      throw new UnevaluableError(`could not read baseline: ${error instanceof Error ? error.message : String(error)}`);
    }
    const report = await verifyManifest(new DirectoryProvider(options.bundle!), baseline, options.bundle!);
    await writeJson(options.output!, report);
    return report.status === "pass" ? 0 : 1;
  }
  throw new UnevaluableError("expected command: validate, manifest, or verify");
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n${usage()}\n`);
  process.exitCode = 2;
}
