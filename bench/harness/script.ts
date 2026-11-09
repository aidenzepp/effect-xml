/**
 * The plumbing every benchmark command-line script shares: detecting that it is the process entry
 * point, and naming and writing its JSON results file.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import * as DateTime from "effect/DateTime";

import type { Environment } from "../types.ts";

/**
 * The part every results file shares: the environment the run measured on, beside the run's own
 * results.
 */
export interface ResultsFile {
  readonly environment: Environment;
}

/**
 * Decide whether a module is the process entry point: `import.meta.main` on Bun, or the script
 * path Node received.
 *
 * @param meta - The `import.meta` of the module asking.
 * @returns `true` when the runtime started this module.
 */
export const isEntryPoint = (meta: ImportMeta): boolean =>
  meta.main || process.argv[1] === meta.filename;

/**
 * Format a time for a results file name: ISO 8601 with every `:` replaced by `-`, so the name is a
 * valid path on every platform.
 *
 * @param now - The time the run started.
 * @returns The timestamp text a default results file name carries.
 */
export const fileTimestamp = (now: DateTime.DateTime): string =>
  DateTime.formatIso(now).replaceAll(":", "-");

// Native: `effect/FileSystem` lacks an implementation without a platform layer, which is not a dependency.
/**
 * Write a results file as indented JSON with a trailing newline, creating the parent directory
 * first.
 *
 * Each caller wraps the call once in `Effect.try` and maps the thrown `node:fs` error to its own
 * failure type.
 *
 * @param out - The path of the results file.
 * @param file - The results file to serialize.
 */
export const writeJsonFile = (out: string, file: ResultsFile): void => {
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
};
