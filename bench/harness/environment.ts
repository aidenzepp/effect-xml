/**
 * The environment record of a benchmark run: the machine, the runtime, the measured package
 * versions, and the commit, so a results file states what its numbers were measured on.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import type { Environment } from "../types.ts";

/**
 * The packages whose installed versions every run records: the Effect runtime, each competitor,
 * and the measured `@computis/effect-xml` release.
 */
export const measuredPackages: readonly string[] = [
  "effect",
  "fast-xml-parser",
  "saxes",
  "sax",
  "txml",
  "@rgrove/parse-xml",
  "libxml2-wasm",
  "@computis/effect-xml",
];

/**
 * The repository root, two directories above this file; git runs here and `node_modules` sits
 * here, whichever directory the process started in.
 */
const root = new URL("../../", import.meta.url);

/**
 * The `version` field of a package manifest; the rest of the manifest is ignored.
 */
const PackageManifest = Schema.fromJsonString(Schema.Struct({ version: Schema.String }));

// Native: `effect/process` runs commands only through a `ChildProcessSpawner` platform layer, and no platform package is a dependency.
/**
 * Run git in the repository root and capture its trimmed standard output.
 *
 * @param args - The git arguments.
 * @returns The output, or an `UnknownError` when git is missing or exits non-zero.
 */
const git = (args: readonly string[]) =>
  Effect.try(() =>
    execFileSync("git", args, {
      cwd: fileURLToPath(root),
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim(),
  );

// Native: `effect/FileSystem` needs a platform layer, and no platform package is a dependency.
/**
 * Read the installed version of one package from its manifest under `node_modules`.
 *
 * @param name - The npm package name.
 * @returns The manifest's `version`, `"absent"` when the package is not installed, or `"unknown"`
 *   when its manifest has no readable version.
 */
const installedVersion = (name: string) =>
  Effect.sync(() => {
    const manifest = new URL(`node_modules/${name}/package.json`, root);

    if (!existsSync(manifest)) {
      return "absent";
    }

    return Schema.decodeUnknownOption(PackageManifest)(readFileSync(manifest, "utf-8")).pipe(
      Option.map(({ version }) => version),
      Option.getOrElse(() => "unknown"),
    );
  });

/**
 * The environment of the current process, read once per run.
 *
 * The runtime is Bun when `process.versions.bun` is present and Node otherwise. A failing git
 * records the commit as `"unknown"` and the tree as dirty, so a run outside a checkout never claims
 * to reproduce from a clean commit.
 */
export const environment: Effect.Effect<Environment> = Effect.gen(function* environment() {
  const bunVersion: unknown = process.versions.bun;

  const commit = yield* git(["rev-parse", "HEAD"]).pipe(Effect.orElseSucceed(() => "unknown"));

  const dirty = yield* git(["status", "--porcelain"]).pipe(
    Effect.map((status) => status.length > 0),
    Effect.orElseSucceed(() => true),
  );

  const packages = yield* Effect.all(
    Object.fromEntries(measuredPackages.map((name) => [name, installedVersion(name)])),
  );

  return {
    arch: os.arch(),
    commit,
    cores: os.availableParallelism(),
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    dirty,
    os: `${os.type()} ${os.release()}`,
    packages,
    runtime: Predicate.isString(bunVersion) ? "bun" : "node",
    runtimeVersion: Predicate.isString(bunVersion) ? bunVersion : process.versions.node,
    totalMemoryBytes: os.totalmem(),
  };
});
