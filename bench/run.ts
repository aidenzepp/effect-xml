/**
 * The matrix driver: plan every case-by-input pair, measure each one in its own case process on
 * the driver's runtime, and write the results file.
 *
 * Arguments: `[--smoke] [--filter <substring of case id>] [--input <id>]... [--tokenizer <name>]
 * [--jit off|on|noeval] [--out <path>]`. `--jit` sets the Schema JIT mode of every case process and
 * defaults to `off`. The process exits 0 when every pair produced a result, 1 when any pair failed,
 * and 2 when an argument is malformed.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import type { CaseLine } from "./case-process.ts";
import { environment } from "./harness/environment.ts";
import { isJitMode, jitModes, preloadArgs } from "./harness/jit.ts";
import type { JitMode } from "./harness/jit.ts";
import { defaultPolicy, floor, smokePolicy } from "./harness/sample.ts";
import { fileTimestamp, isEntryPoint, writeJsonFile } from "./harness/script.ts";
import { chunkBytes } from "./inputs/chunk.ts";
import { inputIds as corpusInputIds } from "./inputs/corpus.ts";
import { cases, inputIds } from "./registry.ts";
import { tokenizerNames } from "./tokenizers.ts";
import type { BenchCase, CaseFailure, CaseResult, MatrixRunFile, Method } from "./types.ts";

/**
 * The inputs a smoke run measures: the four acceptance items, the whole corpus, and the smallest
 * synthetic bank.
 */
export const smokeInputIds: readonly string[] = ["corpus-items", "corpus-all", "bank-16k"];

/**
 * The parsed driver arguments.
 */
export interface RunArgs {
  readonly smoke: boolean;
  /**
   * A substring every planned case id contains; the empty string keeps every case.
   */
  readonly filter: string;
  /**
   * The requested input ids; empty means every input. A smoke run narrows them to
   * {@link smokeInputIds}.
   */
  readonly inputs: readonly string[];
  readonly tokenizer: string;
  readonly jit: JitMode;
  /**
   * The results file path; `None` writes under `work/bench/`.
   */
  readonly out: Option.Option<string>;
}

/**
 * A malformed driver argument, naming the flag at fault.
 */
export class ArgsError extends Data.TaggedError("ArgsError")<{
  readonly argument: string;
  readonly reason: string;
}> {}

/**
 * The usage line every argument error ends with.
 */
const usage =
  "usage: run.ts [--smoke] [--filter <substring of case id>] [--input <id>]... [--tokenizer <name>] [--jit off|on|noeval] [--out <path>]";

// Native: `effect/cli` `Command.run` requires the FileSystem, Path, Terminal, ChildProcessSpawner, and Stdio services, which only platform layers provide, and no platform package is a dependency.
/**
 * Parse the driver arguments.
 *
 * Every `--input` must be a registered input id, `--tokenizer` a registered tokenizer name, and
 * `--jit` a JIT mode, so a typo fails the run before any case process starts.
 *
 * @param argv - The arguments after the script path.
 * @returns The parsed arguments, or an `ArgsError` naming the malformed flag.
 */
export const parseArgs = Effect.fnUntraced(function* parseArgs(
  argv: readonly string[],
): Effect.fn.Return<RunArgs, ArgsError> {
  let smoke = false;
  let filter = "";
  let tokenizer = "upstream";
  let jit: JitMode = "off";
  let out = Option.none<string>();
  const requested: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? "";

    if (flag === "--smoke") {
      smoke = true;
      continue;
    }

    const value = argv[index + 1];

    if (
      flag !== "--filter" &&
      flag !== "--input" &&
      flag !== "--tokenizer" &&
      flag !== "--jit" &&
      flag !== "--out"
    ) {
      return yield* new ArgsError({ argument: flag, reason: `unknown argument ${flag}; ${usage}` });
    }

    if (value === undefined) {
      return yield* new ArgsError({ argument: flag, reason: `${flag} needs a value; ${usage}` });
    }

    index += 1;

    if (flag === "--filter") {
      filter = value;
    } else if (flag === "--input") {
      if (!inputIds.includes(value)) {
        return yield* new ArgsError({
          argument: flag,
          reason: `no input is registered as ${value}; pass one of ${inputIds.join(", ")}`,
        });
      }

      requested.push(value);
    } else if (flag === "--tokenizer") {
      if (!tokenizerNames.includes(value)) {
        return yield* new ArgsError({
          argument: flag,
          reason: `no tokenizer is named ${value}; pass one of ${tokenizerNames.join(", ")}`,
        });
      }

      tokenizer = value;
    } else if (flag === "--jit") {
      if (!isJitMode(value)) {
        return yield* new ArgsError({
          argument: flag,
          reason: `no JIT mode is named ${value}; pass one of ${jitModes.join(", ")}`,
        });
      }

      jit = value;
    } else {
      out = Option.some(value);
    }
  }

  if (!smoke) {
    return { filter, inputs: requested, jit, out, smoke, tokenizer };
  }

  const inputs =
    requested.length === 0 ? smokeInputIds : requested.filter((id) => smokeInputIds.includes(id));

  return { filter, inputs, jit, out, smoke, tokenizer };
});

/**
 * One planned measurement: a case id and the input id it runs on.
 */
export interface MatrixPair {
  readonly caseId: string;
  readonly input: string;
}

/**
 * Plan the case-by-input matrix without loading any input.
 *
 * @param benchCases - The registered cases.
 * @param knownInputIds - Every registered input id, in registry order.
 * @param filter - A substring every planned case id contains; `""` keeps every case.
 * @param inputs - The requested input ids; empty means every known id.
 * @returns Each case paired with each requested input it accepts, cases in registry order and
 *   inputs in `knownInputIds` order, never an error-path `-bad-last` input.
 */
export const matrix = (
  benchCases: readonly BenchCase[],
  knownInputIds: readonly string[],
  filter: string,
  inputs: readonly string[],
): readonly MatrixPair[] => {
  const planned = knownInputIds.filter(
    (id) => !id.endsWith("-bad-last") && (inputs.length === 0 || inputs.includes(id)),
  );

  return benchCases
    .filter(({ id }) => id.includes(filter))
    .flatMap((benchCase) =>
      planned.flatMap((input) =>
        benchCase.accepts({
          family: corpusInputIds.includes(input) ? "corpus" : "synthetic",
          id: input,
        })
          ? [{ caseId: benchCase.id, input }]
          : [],
      ),
    );
};

/**
 * The case process script, beside this file.
 */
const caseProcessPath = fileURLToPath(new URL("case-process.ts", import.meta.url));

/**
 * The repository's `work/bench/` directory, where a results file lands by default.
 */
const defaultOutDirectory = new URL("../work/bench/", import.meta.url);

/**
 * Check that a parsed case-process line carries a `result` or a `failure` object.
 *
 * @param input - The parsed JSON value.
 * @returns `true` when `input` has an object `result` or an object `failure`.
 */
const isCaseLine = (input: unknown): input is CaseLine =>
  (Predicate.hasProperty(input, "result") && Predicate.isObject(input.result)) ||
  (Predicate.hasProperty(input, "failure") && Predicate.isObject(input.failure));

/**
 * The JSON text of a case-process line. The line is the driver's own child output, so only its
 * top-level shape is checked, not every field.
 */
const CaseLineJson = Schema.fromJsonString(Schema.declare(isCaseLine));

// Native: `effect/process` `ChildProcessSpawner` runs commands only through a platform layer, and no platform package is a dependency.
/**
 * Measure one pair in a case process on the driver's runtime and read its line.
 *
 * `process.execPath` is `bun` under Bun and `node` under Node, so the child runs on the driver's
 * runtime, with the JIT preload of `args.jit` ahead of its script. A case process that exits
 * non-zero still prints its line, so the line is read from the thrown error's captured standard
 * output.
 *
 * @param pair - The case and input to measure.
 * @param args - The driver arguments; `tokenizer`, `jit`, and `smoke` pass through.
 * @returns The child's line, or a failure line when the child printed no parsable line.
 */
const runPair = (pair: MatrixPair, args: RunArgs): Effect.Effect<CaseLine> => {
  const failed = (reason: string): CaseLine => ({
    failure: { caseId: pair.caseId, input: pair.input, reason },
  });

  const childArgs = [
    ...preloadArgs(args.jit),
    caseProcessPath,
    "--case",
    pair.caseId,
    "--input",
    pair.input,
    "--tokenizer",
    args.tokenizer,
    "--jit",
    args.jit,
    ...(args.smoke ? ["--smoke"] : []),
  ];

  const readLine = (stdout: string): Effect.Effect<CaseLine> => {
    const last = stdout.trim().split("\n").at(-1) ?? "";

    return Schema.decodeUnknownEffect(CaseLineJson)(last).pipe(
      Effect.orElseSucceed(() =>
        failed(`the case process printed no result line; its last line was: ${last}`),
      ),
    );
  };

  return Effect.try({
    catch: (cause) => cause,
    try: () =>
      execFileSync(process.execPath, childArgs, {
        encoding: "utf-8",
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "inherit"],
      }),
  }).pipe(
    Effect.matchEffect({
      onFailure: (cause) =>
        Predicate.hasProperty(cause, "stdout") && Predicate.isString(cause.stdout)
          ? readLine(cause.stdout)
          : Effect.succeed(failed(`the case process did not start: ${String(cause)}`)),
      onSuccess: readLine,
    }),
  );
};

/**
 * Plan, measure, and write one run.
 *
 * @param args - The parsed driver arguments.
 * @returns The results file path and its result and failure counts.
 */
const runMatrix = Effect.fnUntraced(function* runMatrix(args: RunArgs) {
  const policy = args.smoke ? smokePolicy : defaultPolicy;
  const pairs = matrix(cases, inputIds, args.filter, args.inputs);

  const lines = yield* Effect.all(
    pairs.map((pair) => runPair(pair, args)),
    { concurrency: 1 },
  );

  const results: CaseResult[] = [];
  const failures: CaseFailure[] = [];

  for (const line of lines) {
    if ("result" in line) {
      results.push(line.result);
    } else {
      failures.push(line.failure);
    }
  }

  const method: Method = {
    ...policy,
    chunkBytes,
    floorMs: floor(policy),
    isolation: "process-per-case",
    quantile: "nearest-rank",
  };

  const env = { ...(yield* environment), jit: args.jit };
  const now = yield* DateTime.now;

  const outPath = Option.getOrElse(args.out, () =>
    fileURLToPath(new URL(`${env.runtime}-${fileTimestamp(now)}.json`, defaultOutDirectory)),
  );

  const runFile: MatrixRunFile = { environment: env, failures, method, results };

  yield* Effect.try({
    catch: (cause) =>
      new ArgsError({
        argument: "--out",
        reason: `cannot write the results file ${outPath}: ${String(cause)}`,
      }),
    try: () => {
      writeJsonFile(outPath, runFile);
    },
  });

  return { failures, outPath, results };
});

if (isEntryPoint(import.meta)) {
  void Effect.runPromise(
    parseArgs(process.argv.slice(2)).pipe(
      Effect.flatMap(runMatrix),
      Effect.match({
        onFailure: ({ reason }) => {
          console.error(`bench: ${reason}`);
          process.exitCode = 2;
        },
        onSuccess: ({ failures, outPath, results }) => {
          for (const { caseId, input, reason } of failures) {
            console.error(`bench: ${caseId} on ${input} failed: ${reason}`);
          }

          console.log(
            `bench: ${results.length} results, ${failures.length} failures, wrote ${outPath}`,
          );
          process.exitCode = failures.length === 0 ? 0 : 1;
        },
      }),
    ),
  );
}
