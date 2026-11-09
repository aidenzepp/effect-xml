/**
 * The CPU-profile driver: run each effect-xml case in a case process under the runtime's
 * `--cpu-prof`, bucket the profile it writes by library layer, and write the buckets of every case
 * to one results file. Bun and Node both accept `--cpu-prof` and `--cpu-prof-dir=`.
 *
 * Each profile spans the whole case process (input preparation, the `check` run, warmup, and every
 * sample), not the timed loop alone, so its buckets carry the setup's cost beside the steady
 * state; compare buckets across cases and runtimes, not with a case's sampled wall time.
 *
 * Run directly as `bun bench/profile/cpu.ts` (or `node`) with `--input <id>` (default `bank-4m`),
 * `--tokenizer <name>` (default `upstream`), `--jit off|on|noeval` (default `off`; the driver
 * preloads the mode into each case process and passes it `--jit`, which the case process checks
 * against the preload), `--case <id>` (repeatable; default
 * {@link profiledCases}), `--top <n>` (default 10), and `--out <file>` (default
 * `work/bench/cpu-<runtime>-<time>.json`). Each raw profile stays under
 * `work/bench/profiles/<runtime>-<time>/<case id with "/" as "-">/`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Record from "effect/Record";
import * as Schema from "effect/Schema";

import { environment } from "../harness/environment.ts";
import { isJitMode, jitModes, preloadArgs } from "../harness/jit.ts";
import type { JitMode } from "../harness/jit.ts";
import { fileTimestamp, isEntryPoint, writeJsonFile } from "../harness/script.ts";
import { tokenizers } from "../tokenizers.ts";
import type { Environment } from "../types.ts";
import { CpuProfileSchema, bucket, bucketByCaller, topSelf } from "./cpu-buckets.ts";
import type { Layer, SelfTime } from "./cpu-buckets.ts";

/**
 * The bucketed CPU profile of one case process; `totalMs` is the sum of its buckets,
 * `callerBuckets` charges frames without a script URL (builtins, JIT-compiled code) to their
 * caller's layer, and `topFunctions` lists the functions with the most self time, largest first.
 */
export interface CaseProfile {
  readonly caseId: string;
  readonly input: string;
  readonly totalMs: number;
  readonly buckets: Readonly<Record<Layer, number>>;
  readonly callerBuckets: Readonly<Record<Layer, number>>;
  readonly topFunctions: readonly SelfTime[];
}

/**
 * One CPU-profile results file.
 */
export interface CpuProfileFile {
  readonly environment: Environment;
  readonly jit: JitMode;
  readonly profiles: readonly CaseProfile[];
}

/**
 * The failure of the command-line entry: a bad argument, an unknown tokenizer, a case process that
 * failed or wrote no single profile, or a results file that could not be written.
 */
export class CpuProfileError extends Data.TaggedError("CpuProfileError")<{
  readonly reason: string;
}> {}

/**
 * The effect-xml cases profiled, one case process each, in this order.
 */
export const profiledCases: readonly string[] = [
  "effect-xml/events",
  "effect-xml/tree",
  "effect-xml/typed-decode",
  "effect-xml/encode-typed",
  "effect-xml/stream",
  "effect-xml/stream/positions",
];

/**
 * The case process script.
 */
const caseProcessScript = fileURLToPath(new URL("../case-process.ts", import.meta.url));

/**
 * The repository's `work/bench/` directory, where profiles and the results file land by default.
 */
const workBench = new URL("../../work/bench/", import.meta.url);

/**
 * Build the arguments of a profiled case process.
 *
 * The runtime reads flags only before the script path, so the profiler flags go there, after the
 * driver's own runtime flags; everything after the script path is the case process's own.
 *
 * @param execArgs - The driver's runtime flags (`process.execArgv`), carried to the child.
 * @param dir - The directory the runtime writes the `.cpuprofile` into.
 * @param caseProcessPath - The case process script.
 * @param id - The case id.
 * @param input - The input id.
 * @param tokenizer - The tokenizer name.
 * @returns The argument list for `process.execPath`.
 */
export const profileArgs = (
  execArgs: readonly string[],
  dir: string,
  caseProcessPath: string,
  id: string,
  input: string,
  tokenizer: string,
): readonly string[] => [
  ...execArgs,
  "--cpu-prof",
  `--cpu-prof-dir=${dir}`,
  caseProcessPath,
  "--case",
  id,
  "--input",
  input,
  "--tokenizer",
  tokenizer,
];

// Native: `effect/process` `ChildProcessSpawner` and `effect/FileSystem` run only through a platform layer, and no platform package is a dependency.
/**
 * Profile one case in a fresh directory and bucket the one profile its case process wrote.
 *
 * @param root - The run's profile directory.
 * @param id - The case id.
 * @param input - The input id.
 * @param tokenizer - The tokenizer name.
 * @param top - How many functions the profile's `topFunctions` lists.
 * @param jit - The JIT mode the case process is preloaded with and told to expect.
 * @returns The case's bucketed profile.
 */
const profileCase = Effect.fnUntraced(function* profileCase(
  root: string,
  id: string,
  input: string,
  tokenizer: string,
  top: number,
  jit: JitMode,
): Effect.fn.Return<CaseProfile, CpuProfileError> {
  const dir = path.join(root, id.replaceAll("/", "-"));

  yield* Effect.try({
    catch: (cause) =>
      new CpuProfileError({
        reason: `case ${id} on ${input} failed under --cpu-prof: ${String(cause)}`,
      }),
    try: () => {
      mkdirSync(dir, { recursive: true });
      execFileSync(
        process.execPath,
        [
          ...profileArgs(
            [...process.execArgv, ...preloadArgs(jit)],
            dir,
            caseProcessScript,
            id,
            input,
            tokenizer,
          ),
          "--jit",
          jit,
        ],
        { maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "ignore", "inherit"] },
      );
    },
  });

  const files = yield* Effect.try({
    catch: (cause) => new CpuProfileError({ reason: `cannot list ${dir}: ${String(cause)}` }),
    try: () => readdirSync(dir).filter((name) => name.endsWith(".cpuprofile")),
  });

  const [file] = files;

  if (files.length !== 1 || file === undefined) {
    return yield* new CpuProfileError({
      reason: `case ${id} wrote ${files.length} .cpuprofile files to ${dir}; expected exactly one, so profile into an empty directory`,
    });
  }

  const profilePath = path.join(dir, file);

  const text = yield* Effect.try({
    catch: (cause) =>
      new CpuProfileError({ reason: `cannot read ${profilePath}: ${String(cause)}` }),
    try: () => readFileSync(profilePath, "utf-8"),
  });

  const profile = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(CpuProfileSchema))(
    text,
  ).pipe(
    Effect.mapError(
      (error) =>
        new CpuProfileError({ reason: `${profilePath} is not a .cpuprofile: ${error.message}` }),
    ),
  );

  const buckets = bucket(profile);
  const totalMs = Object.values(buckets).reduce((sum, ms) => sum + ms, 0);

  return {
    buckets,
    callerBuckets: bucketByCaller(profile),
    caseId: id,
    input,
    topFunctions: topSelf(profile, top),
    totalMs,
  };
});

// Native: `effect/cli` `Command.run` needs FileSystem, Path, Terminal, ChildProcessSpawner, and Stdio from a platform layer, which is not a dependency; `node:util` `parseArgs` runs on Bun and Node.
/**
 * Profile every case from command-line arguments and write the results file.
 *
 * @param args - The arguments after the script path.
 * @returns The path of the results file written.
 */
const main = Effect.fnUntraced(function* main(
  args: readonly string[],
): Effect.fn.Return<string, CpuProfileError> {
  const { values } = yield* Effect.try({
    catch: (cause) => new CpuProfileError({ reason: String(cause) }),
    try: () =>
      parseArgs({
        args: [...args],
        options: {
          case: { multiple: true, type: "string" },
          input: { type: "string" },
          jit: { type: "string" },
          out: { type: "string" },
          tokenizer: { type: "string" },
          top: { type: "string" },
        },
      }),
  });

  const input = values.input ?? "bank-4m";
  const tokenizer = values.tokenizer ?? "upstream";
  const top = Number(values.top ?? "10");
  const jit = values.jit ?? "off";

  if (!isJitMode(jit)) {
    return yield* new CpuProfileError({
      reason: `--jit names no JIT mode ${jit}; pass one of ${jitModes.join(", ")}`,
    });
  }

  if (!Number.isInteger(top) || top < 1) {
    return yield* new CpuProfileError({
      reason: `--top takes a positive integer, not ${values.top}`,
    });
  }

  if (Option.isNone(Record.get(tokenizers, tokenizer))) {
    return yield* new CpuProfileError({
      reason: `unknown tokenizer ${tokenizer}; pass one of ${Object.keys(tokenizers).join(", ")}`,
    });
  }

  const env = yield* environment;
  const now = yield* DateTime.now;
  const time = fileTimestamp(now);
  const root = fileURLToPath(new URL(`profiles/${env.runtime}-${time}/`, workBench));

  const profiles = yield* Effect.all(
    (values.case ?? profiledCases).map((id) => profileCase(root, id, input, tokenizer, top, jit)),
    { concurrency: 1 },
  );

  const file: CpuProfileFile = { environment: env, jit, profiles };
  const out = values.out ?? fileURLToPath(new URL(`cpu-${env.runtime}-${time}.json`, workBench));

  yield* Effect.try({
    catch: (cause) => new CpuProfileError({ reason: `cannot write ${out}: ${String(cause)}` }),
    try: () => {
      writeJsonFile(out, file);
    },
  });

  return out;
});

if (isEntryPoint(import.meta)) {
  Effect.runSync(
    main(process.argv.slice(2)).pipe(
      Effect.match({
        onFailure: (error) => {
          console.error(`cpu: ${error.reason}`);
          process.exitCode = 1;
        },
        onSuccess: (out) => {
          console.log(out);
        },
      }),
    ),
  );
}
