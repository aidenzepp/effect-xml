/**
 * The case process: measure one benchmark case on one input in a process of its own, then print
 * exactly one JSON line, `{ "result": CaseResult }` or `{ "failure": CaseFailure }`, to standard
 * output.
 *
 * Arguments: `--case <id> --input <id> --tokenizer <name> [--jit off|on|noeval] [--smoke]`. The
 * process exits 0 with a result, 1 when the case fails to prepare, run, or check, and 2 when an
 * argument names nothing the registry knows or `--jit` disagrees with the JIT preload the process
 * started with (see `harness/jit.ts`; `bench/run.ts` passes both). The case runs once outside the
 * timed loop so its `check` count can be compared with `expected`; the timed loop then runs under
 * `measureResources`, and every timed call ends with `heapProbe`, a single `process.memoryUsage()`
 * read inside the timed call, so the reported heap is sampled at each run's end at the cost of that
 * one read per sample.
 *
 * A process started with `--cpu-prof` (both runtimes list it in `process.execArgv`) measures with
 * `skipHeapStatistics`, so its CPU profile carries no heap walk and its allocation rate is
 * unavailable; every other process prints the same fields and sources as one without the option.
 */
import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { constVoid } from "effect/Function";
import * as Option from "effect/Option";

import { isJitMode, jitModes, readJitState } from "./harness/jit.ts";
import type { JitMode } from "./harness/jit.ts";
import { heapProbe, measureResources } from "./harness/metrics.ts";
import { defaultPolicy, quantiles, sample, smokePolicy } from "./harness/sample.ts";
import { isEntryPoint } from "./harness/script.ts";
import { cases, loadInput } from "./registry.ts";
import { tokenizers } from "./tokenizers.ts";
import type { CaseFailure, CaseMetrics, CaseResult, Measured, PreparedCase } from "./types.ts";

/**
 * The one line a case process prints: its result, or why the case failed.
 */
export type CaseLine = { readonly result: CaseResult } | { readonly failure: CaseFailure };

/**
 * The parsed arguments of one case process.
 */
interface CaseArgs {
  readonly caseId: string;
  readonly inputId: string;
  readonly tokenizer: string;
  readonly jit: JitMode;
  readonly smoke: boolean;
}

/**
 * A case process that ends without a result: exit code 2 when an argument is malformed or names
 * nothing the registry knows, so the driver can tell a mis-planned run from a failing case, and 1
 * when the case fails to prepare, run, or check.
 */
class CaseProcessFailure extends Data.TaggedError("CaseProcessFailure")<{
  readonly caseId: string;
  readonly input: string;
  readonly reason: string;
  readonly exitCode: 1 | 2;
}> {}

// Native: `effect/cli` `Command.run` requires the FileSystem, Path, Terminal, ChildProcessSpawner, and Stdio services, which only platform layers provide, and no platform package is a dependency.
/**
 * Parse the case process arguments.
 *
 * @param argv - The arguments after the script path.
 * @returns The case, input, and tokenizer names, the JIT mode (`off` when `--jit` is absent), and
 *   the smoke flag, or an exit-2 failure naming the malformed or missing argument.
 */
const parseCaseArgs = Effect.fnUntraced(function* parseCaseArgs(
  argv: readonly string[],
): Effect.fn.Return<CaseArgs, CaseProcessFailure> {
  let caseId = "";
  let inputId = "";
  let tokenizer = "";
  let jit: JitMode = "off";
  let smoke = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? "";

    if (flag === "--smoke") {
      smoke = true;
    } else if (
      flag === "--case" ||
      flag === "--input" ||
      flag === "--tokenizer" ||
      flag === "--jit"
    ) {
      const value = argv[index + 1];

      if (value === undefined) {
        return yield* new CaseProcessFailure({
          caseId,
          exitCode: 2,
          input: inputId,
          reason: `${flag} needs a value; pass ${flag} <name>`,
        });
      }

      if (flag === "--case") {
        caseId = value;
      } else if (flag === "--input") {
        inputId = value;
      } else if (flag === "--jit") {
        if (!isJitMode(value)) {
          return yield* new CaseProcessFailure({
            caseId,
            exitCode: 2,
            input: inputId,
            reason: `no JIT mode is named ${value}; pass one of ${jitModes.join(", ")}`,
          });
        }

        jit = value;
      } else {
        tokenizer = value;
      }

      index += 1;
    } else {
      return yield* new CaseProcessFailure({
        caseId,
        exitCode: 2,
        input: inputId,
        reason: `unknown argument ${flag}; pass --case <id> --input <id> --tokenizer <name> [--jit off|on|noeval] [--smoke]`,
      });
    }
  }

  if (caseId === "" || inputId === "" || tokenizer === "") {
    return yield* new CaseProcessFailure({
      caseId,
      exitCode: 2,
      input: inputId,
      reason:
        "--case, --input, and --tokenizer are required; pass --case <id> --input <id> --tokenizer <name>",
    });
  }

  return { caseId, inputId, jit, smoke, tokenizer };
});

/**
 * Wrap a prepared case so every call of `run` ends with a heap probe inside the timed call.
 *
 * @param prepared - The case to wrap.
 * @returns The same case whose `run` reads `heapUsed` once after each call.
 */
const withHeapProbe = (prepared: PreparedCase): PreparedCase => ({
  ...prepared,
  run: (mark) => {
    const output = prepared.run(mark);

    heapProbe();

    return output;
  },
});

/**
 * Derive throughput from the input size and the median wall time.
 *
 * @param bytes - The input's UTF-8 length.
 * @param medianMs - The median wall time in milliseconds.
 * @returns Megabytes per second, or unavailable when the median is below timer resolution.
 */
const throughput = (bytes: number, medianMs: number): Measured =>
  medianMs > 0
    ? { source: "input UTF-8 bytes / median", unit: "MB/s", value: bytes / (medianMs / 1000) / 1e6 }
    : { unavailable: "the median wall time is 0 ms, below the timer's resolution" };

/**
 * Prepare, check, and measure one case on one input.
 *
 * A library error thrown by `run` or `check` is caught once around the check run and once around
 * the timed batch, never per sample, and becomes an exit-1 failure. The process must have started
 * with the JIT preload `args.jit` names. Under `noeval` the check run is followed by a proof that
 * the JIT ran interpreted: `globalThis.Function` is still the preload's refusing replacement, and
 * the number of calls it refused (1 once the JIT has probed it, 0 when the case compiled no
 * schema) goes to standard error.
 *
 * @param args - The case, input, and tokenizer names and the smoke flag.
 * @returns The case result, or a failure carrying the exit code the process ends with.
 */
const measureCase = Effect.fnUntraced(function* measureCase(
  args: CaseArgs,
): Effect.fn.Return<CaseResult, CaseProcessFailure> {
  const failure = (exitCode: 1 | 2, reason: string) =>
    new CaseProcessFailure({ caseId: args.caseId, exitCode, input: args.inputId, reason });

  const threw = (cause: unknown) => failure(1, `the case threw: ${String(cause)}`);

  const jitState = readJitState();

  const preloaded = Option.match(jitState, {
    onNone: (): JitMode => "off",
    onSome: ({ mode }) => mode,
  });

  if (preloaded !== args.jit) {
    return yield* failure(
      2,
      `--jit ${args.jit} disagrees with the JIT mode the process started in, ${preloaded}; start it through bench/run.ts --jit ${args.jit}, which preloads the mode`,
    );
  }

  const benchCase = cases.find(({ id }) => id === args.caseId);

  if (benchCase === undefined) {
    return yield* failure(
      2,
      `no case is registered as ${args.caseId}; pass an id from bench/registry.ts`,
    );
  }

  const tokenizer = Object.hasOwn(tokenizers, args.tokenizer)
    ? tokenizers[args.tokenizer]
    : undefined;

  if (tokenizer === undefined) {
    return yield* failure(
      2,
      `no tokenizer is named ${args.tokenizer}; pass one of ${Object.keys(tokenizers).join(", ")}`,
    );
  }

  const found = yield* loadInput(args.inputId);

  if (Option.isNone(found)) {
    return yield* failure(
      2,
      `no input is registered as ${args.inputId}; pass an id from bench/registry.ts`,
    );
  }

  const input = found.value;

  const prepared = yield* benchCase
    .prepare(input, tokenizer)
    .pipe(Effect.mapError(({ reason }) => failure(1, reason)));

  const observed = yield* Effect.try({
    catch: threw,
    try: () => prepared.check(prepared.run(constVoid)),
  });

  if (observed !== prepared.expected) {
    return yield* failure(1, `check counted ${observed} but ${prepared.expected} was expected`);
  }

  if (Option.isSome(jitState) && jitState.value.mode === "noeval") {
    const { refusals, refusing } = jitState.value;

    if (globalThis.Function !== refusing) {
      return yield* failure(
        1,
        "globalThis.Function is no longer the --jit noeval replacement, so the Schema JIT may have compiled; keep the case from restoring Function under --jit noeval",
      );
    }

    console.error(
      `bench: ${args.caseId} on ${args.inputId} under --jit noeval: globalThis.Function refused ${refusals} call(s) before measuring, so Schema parsing ran interpreted`,
    );
  }

  const policy = args.smoke ? smokePolicy : defaultPolicy;

  const { resources, value: samples } = yield* Effect.try({
    catch: threw,
    try: () =>
      measureResources(() => sample(withHeapProbe(prepared), policy), {
        skipHeapStatistics: process.execArgv.includes("--cpu-prof"),
      }),
  });

  const wallMs = quantiles(samples.wallMs);

  const metrics: CaseMetrics = {
    ...resources,
    samples: samples.wallMs.length,
    throughputMBps: throughput(input.bytes, wallMs.median),
    timeToFirstRecordMs: Arr.isReadonlyArrayNonEmpty(samples.firstRecordMs)
      ? quantiles(samples.firstRecordMs)
      : undefined,
    wallMs,
  };

  return {
    bytes: input.bytes,
    caseId: benchCase.id,
    class: benchCase.class,
    expected: prepared.expected,
    input: input.id,
    library: benchCase.library,
    metrics,
    observed,
    tokenizer: args.tokenizer,
  };
});

/**
 * Print the process's one line and set its exit code.
 *
 * @param line - The result or failure to print.
 * @param exitCode - 0 for a result, 1 for a failing case, 2 for a malformed or unknown argument.
 */
const emit = (line: CaseLine, exitCode: number): void => {
  process.stdout.write(`${JSON.stringify(line)}\n`);
  process.exitCode = exitCode;
};

if (isEntryPoint(import.meta)) {
  void Effect.runPromise(
    parseCaseArgs(process.argv.slice(2)).pipe(
      Effect.flatMap(measureCase),
      Effect.match({
        onFailure: ({ caseId, exitCode, input, reason }) => {
          emit({ failure: { caseId, input, reason } }, exitCode);
        },
        onSuccess: (result) => {
          emit({ result }, 0);
        },
      }),
    ),
  );
}
