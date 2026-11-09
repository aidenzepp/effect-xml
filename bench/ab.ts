/**
 * The interleaved A/B driver: measure an old and a new checkout of this repository, and the
 * competitor cases, round by round in one session, and decide on per-round CPU-time ratios rather
 * than on absolute times taken on a loaded machine.
 *
 * Driver arguments: `--old <tree> --new <tree> --input <id> --rounds <n> [--jit off|on|noeval]
 * [--old-jit off|on|noeval] [--policy default|ab|large] [--case <id>]... [--rung <id>]...
 * [--failure <id>]... [--new-only true] [--paired-rungs true] [--out <path>]`. Every `effect-xml/`
 * case and every failure-path unit runs once per round on each tree, or on the new tree alone under
 * `--new-only`; every other case (the competitors) runs once per round on the new tree. Every
 * layer-ladder rung (`bench/profile/layers.ts`) runs once per round on the new tree, or on each
 * tree under `--paired-rungs`, which adds its NEW/OLD ratio to the summary. Each measurement is a
 * child process of its own on the driver's runtime, and the order of the round's measurements
 * reverses every round (ABC, CBA, ...). A round whose load or CPU time is an outlier is repeated
 * once at the end of the block; the repeat replaces it in the summary, and the original stays in
 * the file, marked superseded.
 *
 * `--jit` sets the JIT mode of every unit and `--old-jit` overrides it for the old side, so passing
 * one tree as both `--old` and `--new` measures one build in two JIT modes in the same rounds.
 *
 * Child arguments: `--child --tree <dir> --kind case|rung|failure --id <id> --input <id> --jit
 * <mode> --policy <name>`. The child loads the case registry, the tokenizers, the synthetic
 * inputs, the ladder rungs, and the library from `<tree>`, so each side measures its own `src/`,
 * and it reuses this tree's sampler and resource meter, which is byte-identical to the other
 * tree's when `bench/` is.
 */
import { execFileSync } from "node:child_process";
import * as os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import * as Arr from "effect/Array";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { constVoid } from "effect/Function";
import * as Option from "effect/Option";
import * as Order from "effect/Order";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { environment } from "./harness/environment.ts";
import { isJitMode, jitModes, preloadArgs, readJitState } from "./harness/jit.ts";
import type { JitMode } from "./harness/jit.ts";
import { heapProbe, measureResources } from "./harness/metrics.ts";
import { defaultPolicy, quantiles, sample } from "./harness/sample.ts";
import type { SamplePolicy } from "./harness/sample.ts";
import { isEntryPoint, writeJsonFile } from "./harness/script.ts";
import type * as LibraryModule from "../src/index.ts";
import type { Tokenizer } from "../src/tokenizer.ts";
import type * as StreamingVocabularyModule from "../test/streaming/vocabulary.ts";
import type * as LayersModule from "./profile/layers.ts";
import type * as SyntheticModule from "./inputs/synthetic.ts";
import type * as RegistryModule from "./registry.ts";
import type * as TokenizersModule from "./tokenizers.ts";
import type { BenchInput, Environment, Measured, PreparedCase, Quantiles } from "./types.ts";
import type * as VocabularyModule from "./vocabulary.ts";

/**
 * A failure of the driver or of one child: a malformed argument, a module that cannot load, or a
 * case that cannot prepare, run, or check.
 */
class AbError extends Data.TaggedError("AbError")<{
  readonly reason: string;
}> {}

/**
 * The sampling policies a block can run under, by name.
 *
 * `default` is the matrix policy of `bench/run.ts`. `ab` keeps its warmup but samples at least 10
 * runs over at least 2 s with no sample cap, so a `bank-16k` process meters thousands of runs
 * instead of the 200 (about 60 ms) `default` stops at. `large` fits `bank-64m`, where one
 * operation takes seconds under load: one warmup run, then 2 samples.
 */
const policies = {
  ab: {
    maxMs: 30_000,
    maxSamples: 1_000_000,
    minMs: 2000,
    minSamples: 10,
    warmupIterations: 5,
    warmupMs: 1000,
  },
  default: defaultPolicy,
  large: {
    maxMs: 60_000,
    maxSamples: 200,
    minMs: 0,
    minSamples: 2,
    warmupIterations: 1,
    warmupMs: 0,
  },
} satisfies Readonly<Record<string, SamplePolicy>>;

/**
 * The name of a sampling policy in {@link policies}.
 */
type PolicyName = keyof typeof policies;

/**
 * Check that a command-line value names a sampling policy.
 *
 * @param value - The value after `--policy`.
 * @returns `true` when `value` is a key of {@link policies}.
 */
const isPolicyName = (value: string): value is PolicyName => Object.hasOwn(policies, value);

/**
 * What one child measures: a registered case, a layer-ladder rung, or a failure-path decode.
 */
type UnitKind = "case" | "rung" | "failure";

/**
 * The failure-path units, by id. Each decodes the block's input, a bank whose last record lacks
 * its required `href` (`bank-<size>-bad-last`), so the decode reads every record and fails at the
 * last one with a `SchemaFailure`; the unit's count is 1 when it fails that way.
 *
 * `failure/typed-decode` decodes the whole document through `XmlSchema.fromString(ItemBank)`, as
 * `effect-xml/typed-decode` does. `failure/stream` streams its 64 KiB chunks through
 * `XmlSchema.decodeSchemaString(ItemRef)`, as `effect-xml/stream` does.
 */
const failureIds = ["failure/typed-decode", "failure/stream"] as const;

/**
 * The id of a failure-path unit.
 */
type FailureId = (typeof failureIds)[number];

/**
 * Check that a command-line value names a failure-path unit.
 *
 * @param value - The value after `--failure` or a child's `--id`.
 * @returns `true` when `value` is one of {@link failureIds}.
 */
const isFailureId = (value: string): value is FailureId => failureIds.some((id) => id === value);

/**
 * One measurement a round schedules: a case or rung on one tree.
 */
interface Unit {
  readonly kind: UnitKind;
  readonly id: string;
  readonly side: "new" | "old";
}

/**
 * The value of one child measurement: CPU per operation over the sampling phase alone, the wall
 * quantiles, and the rest of the owner's metric set.
 */
interface ChildResult {
  readonly expected: number;
  readonly observed: number;
  readonly samples: number;
  /**
   * User plus system CPU time of the whole process over the sampling phase, divided by the
   * sample count. Warmup runs fall outside the meter, so the count is exact.
   */
  readonly cpuPerOpMs: number;
  readonly cpuUserMs: number;
  readonly cpuSystemMs: number;
  /**
   * The sampling phase's elapsed wall time divided by the sample count.
   */
  readonly wallMeanMs: number;
  readonly wallMs: Quantiles;
  readonly timeToFirstRecordMs: Quantiles | undefined;
  readonly peakRssBytes: Measured;
  readonly heapUsedBytes: Measured;
  readonly allocationBytesPerSecond: Measured;
  readonly gcCount: Measured;
  readonly gcPauseMs: Measured;
}

/**
 * The one line a child prints.
 */
type ChildLine = { readonly result: ChildResult } | { readonly failure: string };

/**
 * One measurement as the driver records it: the unit, the load when it started, and the child's
 * line.
 */
interface Measurement extends Unit {
  readonly load: number;
  readonly line: ChildLine;
}

/**
 * One round: its measurements in the order they ran and the 1-minute load average around them.
 */
interface Round {
  readonly index: number;
  readonly order: "forward" | "reverse";
  readonly startedAt: string;
  readonly loadStart: number;
  readonly loadEnd: number;
  readonly measurements: readonly Measurement[];
  /**
   * The round this one repeats, when it is a repeat.
   */
  readonly repeatOf: number | undefined;
  /**
   * Why the summary leaves the round out: the outlier test it failed, after which a repeat ran.
   */
  readonly superseded: string | undefined;
}

/**
 * A median with a distribution-free interval: the order statistics around the median whose
 * coverage the binomial distribution gives, 95% or the most a small round count allows.
 */
export interface Interval {
  readonly n: number;
  readonly median: number;
  readonly low: number;
  readonly high: number;
  readonly coverage: number;
}

/**
 * The parsed driver arguments.
 */
interface DriverArgs {
  readonly oldTree: string;
  readonly newTree: string;
  readonly input: string;
  readonly rounds: number;
  readonly jit: JitMode;
  /**
   * The JIT mode of the old side's units; `jit` when `--old-jit` is absent.
   */
  readonly oldJit: JitMode;
  readonly policy: PolicyName;
  readonly cases: readonly string[];
  readonly rungs: readonly string[];
  readonly failures: readonly FailureId[];
  /**
   * Whether the paired units skip the old tree, as a layer profile of one build does; `--old`
   * still names a tree, and `newOverOld` and the `old/` competitor ratios stay empty.
   */
  readonly newOnly: boolean;
  /**
   * Whether each rung runs on both trees, as the paired cases do, so a rung that both trees carry
   * gets a NEW/OLD ratio; `ladderDeltas` and `step2` still read the new tree's rungs alone.
   */
  readonly pairedRungs: boolean;
  readonly out: string;
}

/**
 * The parsed child arguments.
 */
interface ChildArgs {
  readonly tree: string;
  readonly kind: UnitKind;
  readonly id: string;
  readonly input: string;
  readonly jit: JitMode;
  readonly policy: SamplePolicy;
}

/**
 * The usage line every argument error ends with.
 */
const usage =
  "usage: ab.ts --old <tree> --new <tree> --input <id> --rounds <n> [--jit off|on|noeval] [--old-jit off|on|noeval] [--policy default|ab|large] [--case <id>]... [--rung <id>]... [--failure failure/typed-decode|failure/stream]... [--new-only true] [--paired-rungs true] [--out <path>]";

/**
 * This script, which the driver starts again as each child.
 */
const scriptPath = import.meta.filename;

/**
 * Read a flag's values from an argument list of `--flag value` pairs and bare `--child`.
 *
 * @param argv - The arguments after the script path.
 * @returns Each flag mapped to its values in order, or an `AbError` naming a flag without a value.
 */
const readFlags = Effect.fnUntraced(function* readFlags(
  argv: readonly string[],
): Effect.fn.Return<ReadonlyMap<string, readonly string[]>, AbError> {
  const flags = new Map<string, string[]>();

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] ?? "";

    if (flag === "--child") {
      flags.set(flag, []);
      continue;
    }

    const value = argv[index + 1];

    if (!flag.startsWith("--") || value === undefined) {
      return yield* new AbError({ reason: `${flag} needs a value; ${usage}` });
    }

    flags.set(flag, [...(flags.get(flag) ?? []), value]);
    index += 1;
  }

  return flags;
});

/**
 * Read the single value of a required flag.
 *
 * @param flags - The parsed flags.
 * @param flag - The flag to read.
 * @returns Its last value, or an `AbError` when the flag is absent.
 */
const required = (
  flags: ReadonlyMap<string, readonly string[]>,
  flag: string,
): Effect.Effect<string, AbError> => {
  const value = flags.get(flag)?.at(-1);

  return value === undefined
    ? Effect.fail(new AbError({ reason: `${flag} is required; ${usage}` }))
    : Effect.succeed(value);
};

/**
 * Read a JIT mode flag.
 *
 * @param flags - The parsed flags.
 * @param flag - The flag to read, `--jit` or `--old-jit`.
 * @param fallback - The mode when the flag is absent.
 * @returns The mode the flag names, `fallback` when absent, or an `AbError` for an unknown mode.
 */
const jitOf = (
  flags: ReadonlyMap<string, readonly string[]>,
  flag: string,
  fallback: JitMode,
): Effect.Effect<JitMode, AbError> => {
  const value = flags.get(flag)?.at(-1) ?? fallback;

  return isJitMode(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new AbError({
          reason: `${flag} names no JIT mode ${value}; pass one of ${jitModes.join(", ")}`,
        }),
      );
};

/**
 * Read the policy flag.
 *
 * @param flags - The parsed flags.
 * @returns The policy name `--policy` gives, `ab` when absent, or an `AbError` for an unknown name.
 */
const policyOf = (
  flags: ReadonlyMap<string, readonly string[]>,
): Effect.Effect<PolicyName, AbError> => {
  const value = flags.get("--policy")?.at(-1) ?? "ab";

  return isPolicyName(value)
    ? Effect.succeed(value)
    : Effect.fail(
        new AbError({
          reason: `no policy is named ${value}; pass one of ${Object.keys(policies).join(", ")}`,
        }),
      );
};

/**
 * Import a module from a tree, typed as this tree's copy of the same module.
 *
 * @param tree - The checkout to import from.
 * @param file - The module path relative to the checkout root.
 * @returns The module namespace, or an `AbError` when it cannot load.
 */
const importFrom = <A>(tree: string, file: string): Effect.Effect<A, AbError> =>
  Effect.tryPromise({
    catch: (cause) => new AbError({ reason: `cannot load ${file} from ${tree}: ${String(cause)}` }),
    try: (): Promise<A> => import(pathToFileURL(path.join(tree, file)).href),
  });

/**
 * Read the number a `Measured` field carries.
 *
 * @param measured - The field.
 * @returns Its value, or `None` when the runtime reports it unavailable.
 */
const valueOf = (measured: Measured): Option.Option<number> =>
  "value" in measured ? Option.some(measured.value) : Option.none();

/**
 * Wrap a prepared case so every timed call ends with a heap probe, as `bench/case-process.ts`
 * does, so the reported heap is sampled at each run's end.
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
 * The parser limits a whole-document decode of a large bank needs, as `effect-xml/typed-decode`
 * sets them: the root spans the whole document, past the default 16 MiB `maxElementSize`.
 */
const unlimited = { maxElementNodes: Infinity, maxElementSize: Infinity };

/**
 * Count a failure-path outcome.
 *
 * @param failed - Whether the decode failed with a `SchemaFailure`.
 * @returns `1` for the expected failure, `0` otherwise.
 */
const count = (failed: boolean): number => (failed ? 1 : 0);

/**
 * Prepare a failure-path unit from its tree: the library, the bank vocabulary, and the streaming
 * record vocabulary all load from `tree`, so each side fails through its own `src/`.
 *
 * `run` classifies the outcome inside the timed call, which costs one tag comparison per
 * operation: 1 when the decode fails with a `SchemaFailure`, 0 otherwise.
 *
 * @param tree - The checkout to load from.
 * @param id - The failure-path unit.
 * @param input - The block's input; it must hold exactly one document.
 * @param tokenizer - The tokenizer every decode reads.
 * @returns The prepared unit, or an `AbError` when a module cannot load or the input is not one
 *   document.
 */
const prepareFailure = Effect.fnUntraced(function* prepareFailure(
  tree: string,
  id: FailureId,
  input: BenchInput,
  tokenizer: Tokenizer,
): Effect.fn.Return<PreparedCase, AbError> {
  const { XmlSchema } = yield* importFrom<typeof LibraryModule>(tree, "src/index.ts");

  const { ItemBank, bankPath } = yield* importFrom<typeof VocabularyModule>(
    tree,
    "bench/vocabulary.ts",
  );

  const { ItemRef } = yield* importFrom<typeof StreamingVocabularyModule>(
    tree,
    "test/streaming/vocabulary.ts",
  );

  const [document] = input.documents;

  if (input.documents.length !== 1 || document === undefined) {
    return yield* new AbError({
      reason: `${id} reads exactly one bank document, but ${input.id} has ${input.documents.length}; pass a bank-<size>-bad-last input`,
    });
  }

  if (id === "failure/typed-decode") {
    const decode = Schema.decodeUnknownEffect(XmlSchema.fromString(ItemBank, unlimited));

    return {
      check: (output) => (Predicate.isNumber(output) ? output : -1),
      expected: 1,
      run: () =>
        decode(document.text).pipe(
          Effect.match({
            onFailure: (error) =>
              count(
                Option.exists(
                  XmlSchema.decodeErrorOf(error.issue),
                  (found) => found.reason._tag === "SchemaFailure",
                ),
              ),
            onSuccess: () => 0,
          }),
          Effect.provideService(XmlSchema.Tokenizer, tokenizer),
          Effect.runSync,
        ),
    };
  }

  const channel = XmlSchema.decodeSchemaString(ItemRef, bankPath);

  return {
    check: (output) => (Predicate.isNumber(output) ? output : -1),
    expected: 1,
    run: () =>
      Stream.fromIterable(document.chunks).pipe(
        Stream.pipeThroughChannel(channel({ positions: false })),
        Stream.runCount,
        Effect.match({
          onFailure: (error) => count(error.reason._tag === "SchemaFailure"),
          onSuccess: () => 0,
        }),
        Effect.provideService(XmlSchema.Tokenizer, tokenizer),
        Effect.runSync,
      ),
  };
});

/**
 * Prepare the unit a child measures from its tree.
 *
 * @param args - The child arguments.
 * @returns The prepared case or rung, or an `AbError` when it is unknown or fails to prepare.
 */
const prepareUnit = Effect.fnUntraced(function* prepareUnit(
  args: ChildArgs,
): Effect.fn.Return<PreparedCase, AbError> {
  const tokenizers = yield* importFrom<typeof TokenizersModule>(args.tree, "bench/tokenizers.ts");

  const tokenizer = tokenizers.tokenizers.upstream;

  if (tokenizer === undefined) {
    return yield* new AbError({ reason: `${args.tree} registers no upstream tokenizer` });
  }

  const prepareFailed = ({ reason }: { readonly reason: string }) => new AbError({ reason });

  if (args.kind === "rung") {
    const layers = yield* importFrom<typeof LayersModule>(args.tree, "bench/profile/layers.ts");

    const synthetic = yield* importFrom<typeof SyntheticModule>(
      args.tree,
      "bench/inputs/synthetic.ts",
    );

    const rung = layers.rungs.find(({ id }) => id === args.id);
    const input = yield* synthetic.loadInput(args.input);

    if (rung === undefined || Option.isNone(input)) {
      return yield* new AbError({
        reason: `no rung ${args.id} or synthetic input ${args.input}; pass ids from bench/profile/layers.ts and bench/inputs/synthetic.ts`,
      });
    }

    return yield* rung.prepare(input.value, tokenizer).pipe(Effect.mapError(prepareFailed));
  }

  const registry = yield* importFrom<typeof RegistryModule>(args.tree, "bench/registry.ts");

  if (args.kind === "failure") {
    const { id } = args;
    const input = yield* registry.loadInput(args.input);

    if (!isFailureId(id) || Option.isNone(input)) {
      return yield* new AbError({
        reason: `no failure-path unit ${id} or input ${args.input}; pass one of ${failureIds.join(", ")} and an id from bench/registry.ts`,
      });
    }

    return yield* prepareFailure(args.tree, id, input.value, tokenizer);
  }

  const benchCase = registry.cases.find(({ id }) => id === args.id);
  const input = yield* registry.loadInput(args.input);

  if (benchCase === undefined || Option.isNone(input)) {
    return yield* new AbError({
      reason: `no case ${args.id} or input ${args.input}; pass ids from bench/registry.ts`,
    });
  }

  return yield* benchCase.prepare(input.value, tokenizer).pipe(Effect.mapError(prepareFailed));
});

/**
 * Prepare, check, warm up, and measure one unit in this process.
 *
 * The check run and the warmup run before the meter starts; the meter then covers the sampling
 * phase alone, so CPU time per operation is the process's user plus system time over that phase
 * divided by the exact sample count. `bench/case-process.ts` meters warmup and sampling together
 * and does not report the warmup count, so its CPU fields cannot be divided per operation.
 *
 * @param args - The child arguments.
 * @returns The measurement, or an `AbError` when the unit fails or the JIT preload disagrees.
 */
const measureChild = Effect.fnUntraced(function* measureChild(
  args: ChildArgs,
): Effect.fn.Return<ChildResult, AbError> {
  const threw = (cause: unknown) => new AbError({ reason: `the unit threw: ${String(cause)}` });
  const jitState = readJitState();
  const preloaded = Option.match(jitState, { onNone: (): JitMode => "off", onSome: (s) => s.mode });

  if (preloaded !== args.jit) {
    return yield* new AbError({
      reason: `--jit ${args.jit} disagrees with the preloaded mode ${preloaded}`,
    });
  }

  const prepared = yield* prepareUnit(args);

  const observed = yield* Effect.try({
    catch: threw,
    try: () => prepared.check(prepared.run(constVoid)),
  });

  if (observed !== prepared.expected) {
    return yield* new AbError({
      reason: `check counted ${observed} but ${prepared.expected} was expected`,
    });
  }

  if (
    Option.isSome(jitState) &&
    jitState.value.mode === "noeval" &&
    globalThis.Function !== jitState.value.refusing
  ) {
    return yield* new AbError({
      reason: "globalThis.Function is no longer the --jit noeval replacement",
    });
  }

  const { policy } = args;

  yield* Effect.try({
    catch: threw,
    try: () => sample(prepared, { ...policy, maxSamples: 1, minMs: 0, minSamples: 1 }),
  });

  const { elapsedMs, resources, value } = yield* Effect.try({
    catch: threw,
    try: () =>
      measureResources(() =>
        sample(withHeapProbe(prepared), { ...policy, warmupIterations: 0, warmupMs: 0 }),
      ),
  });

  const cpuUserMs = Option.getOrElse(valueOf(resources.cpuUserMs), () => Number.NaN);
  const cpuSystemMs = Option.getOrElse(valueOf(resources.cpuSystemMs), () => Number.NaN);
  const samples = value.wallMs.length;

  return {
    allocationBytesPerSecond: resources.allocationBytesPerSecond,
    cpuPerOpMs: (cpuUserMs + cpuSystemMs) / samples,
    cpuSystemMs,
    cpuUserMs,
    expected: prepared.expected,
    gcCount: resources.gcCount,
    gcPauseMs: resources.gcPauseMs,
    heapUsedBytes: resources.heapUsedBytes,
    observed,
    peakRssBytes: resources.peakRssBytes,
    samples,
    timeToFirstRecordMs: Arr.isReadonlyArrayNonEmpty(value.firstRecordMs)
      ? quantiles(value.firstRecordMs)
      : undefined,
    wallMeanMs: elapsedMs / samples,
    wallMs: quantiles(value.wallMs),
  };
});

/**
 * Parse the child arguments.
 *
 * @param flags - The parsed flags.
 * @returns The child arguments, or an `AbError` naming the missing or malformed flag.
 */
const parseChild = Effect.fnUntraced(function* parseChild(
  flags: ReadonlyMap<string, readonly string[]>,
): Effect.fn.Return<ChildArgs, AbError> {
  const kind = yield* required(flags, "--kind");

  if (kind !== "case" && kind !== "rung" && kind !== "failure") {
    return yield* new AbError({ reason: `--kind is case, rung, or failure, not ${kind}` });
  }

  const policy = policies[yield* policyOf(flags)];

  return {
    id: yield* required(flags, "--id"),
    input: yield* required(flags, "--input"),
    jit: yield* jitOf(flags, "--jit", "off"),
    kind,
    policy,
    tree: yield* required(flags, "--tree"),
  };
});

/**
 * Name the runtime this process runs on.
 *
 * @returns `bun` under Bun, `node` otherwise.
 */
const runtimeName = (): "bun" | "node" =>
  Predicate.isString(process.versions.bun) ? "bun" : "node";

/**
 * Parse the driver arguments.
 *
 * @param flags - The parsed flags.
 * @returns The driver arguments, or an `AbError` naming the missing or malformed flag.
 */
const parseDriver = Effect.fnUntraced(function* parseDriver(
  flags: ReadonlyMap<string, readonly string[]>,
): Effect.fn.Return<DriverArgs, AbError> {
  const rounds = Number(yield* required(flags, "--rounds"));

  if (!Number.isInteger(rounds) || rounds < 1) {
    return yield* new AbError({ reason: `--rounds takes a positive integer; ${usage}` });
  }

  const cases = flags.get("--case") ?? [];
  const rungs = flags.get("--rung") ?? [];
  const failureFlags = flags.get("--failure") ?? [];
  const failures = failureFlags.filter(isFailureId);
  const unknownFailure = failureFlags.find((id) => !isFailureId(id));

  if (unknownFailure !== undefined) {
    return yield* new AbError({
      reason: `no failure-path unit is named ${unknownFailure}; pass one of ${failureIds.join(", ")}`,
    });
  }

  if (cases.length + rungs.length + failures.length === 0) {
    return yield* new AbError({
      reason: `pass at least one --case, --rung, or --failure; ${usage}`,
    });
  }

  const input = yield* required(flags, "--input");
  const jit = yield* jitOf(flags, "--jit", "off");
  const newOnly = flags.get("--new-only")?.at(-1) ?? "false";

  if (newOnly !== "true" && newOnly !== "false") {
    return yield* new AbError({
      reason: `--new-only takes true or false, not ${newOnly}; ${usage}`,
    });
  }

  const pairedRungs = flags.get("--paired-rungs")?.at(-1) ?? "false";

  if (pairedRungs !== "true" && pairedRungs !== "false") {
    return yield* new AbError({
      reason: `--paired-rungs takes true or false, not ${pairedRungs}; ${usage}`,
    });
  }

  return {
    cases,
    failures,
    input,
    jit,
    newOnly: newOnly === "true",
    newTree: path.resolve(yield* required(flags, "--new")),
    oldJit: yield* jitOf(flags, "--old-jit", jit),
    oldTree: path.resolve(yield* required(flags, "--old")),
    out:
      flags.get("--out")?.at(-1) ??
      path.join("work", "bench", `ab-${runtimeName()}-jit-${jit}-${input}.json`),
    pairedRungs: pairedRungs === "true",
    policy: yield* policyOf(flags),
    rounds,
    rungs,
  };
});

/**
 * Check that a parsed child line carries a `result` object or a `failure` string.
 *
 * @param input - The parsed JSON value.
 * @returns `true` when `input` is a child line.
 */
const isChildLine = (input: unknown): input is ChildLine =>
  (Predicate.hasProperty(input, "result") && Predicate.isObject(input.result)) ||
  (Predicate.hasProperty(input, "failure") && Predicate.isString(input.failure));

/**
 * The JSON text of a child line. The line is the driver's own child output, so only its top-level
 * shape is checked.
 */
const ChildLineJson = Schema.fromJsonString(Schema.declare(isChildLine));

/**
 * Read the 1-minute load average.
 *
 * @returns The load average `os.loadavg` reports.
 */
const load1 = (): number => os.loadavg()[0] ?? Number.NaN;

// Native: `effect/process` `ChildProcessSpawner` runs commands only through a platform layer, and no platform package is a dependency.
/**
 * Measure one unit in a child process on the driver's runtime.
 *
 * @param unit - The case or rung and the tree it runs on.
 * @param args - The driver arguments.
 * @returns The measurement; a child that prints no parsable line becomes a failure line.
 */
const runUnit = (unit: Unit, args: DriverArgs): Effect.Effect<Measurement> => {
  const load = load1();
  const failed = (failure: string): Measurement => ({ ...unit, line: { failure }, load });
  const tree = unit.side === "new" ? args.newTree : args.oldTree;
  const jit = unit.side === "new" ? args.jit : args.oldJit;

  const childArgs = [
    ...preloadArgs(jit),
    scriptPath,
    "--child",
    "--tree",
    tree,
    "--kind",
    unit.kind,
    "--id",
    unit.id,
    "--input",
    args.input,
    "--jit",
    jit,
    "--policy",
    args.policy,
  ];

  const readLine = (stdout: string): Effect.Effect<Measurement> => {
    const last = stdout.trim().split("\n").at(-1) ?? "";

    return Schema.decodeUnknownEffect(ChildLineJson)(last).pipe(
      Effect.map((line): Measurement => ({ ...unit, line, load })),
      Effect.orElseSucceed(() => failed(`the child printed no line; its last line was: ${last}`)),
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
          : Effect.succeed(failed(`the child did not start: ${String(cause)}`)),
      onSuccess: readLine,
    }),
  );
};

/**
 * Plan the units of one round in forward order: each `effect-xml/` case on the new then the old
 * tree, each other case on the new tree, each rung on the new tree (on the new then the old tree
 * under `--paired-rungs`), then each failure-path unit on the new then the old tree. Under
 * `--new-only` the paired units run on the new tree alone.
 *
 * @param args - The driver arguments.
 * @returns The forward schedule; odd rounds run it reversed.
 */
const schedule = (args: DriverArgs): readonly Unit[] => {
  const paired = (kind: UnitKind, id: string): Unit[] =>
    args.newOnly
      ? [{ id, kind, side: "new" }]
      : [
          { id, kind, side: "new" },
          { id, kind, side: "old" },
        ];

  return [
    ...args.cases.flatMap((id): Unit[] =>
      id.startsWith("effect-xml/") ? paired("case", id) : [{ id, kind: "case", side: "new" }],
    ),
    ...args.rungs.flatMap((id): Unit[] =>
      args.pairedRungs ? paired("rung", id) : [{ id, kind: "rung", side: "new" }],
    ),
    ...args.failures.flatMap((id) => paired("failure", id)),
  ];
};

/**
 * Run one round.
 *
 * @param args - The driver arguments.
 * @param index - The round's index; odd indexes run the schedule reversed.
 * @param repeatOf - The round this one repeats, if any.
 * @returns The round.
 */
const runRound = Effect.fnUntraced(function* runRound(
  args: DriverArgs,
  index: number,
  repeatOf: number | undefined,
): Effect.fn.Return<Round> {
  const forward = schedule(args);
  const order = index % 2 === 0 ? "forward" : "reverse";
  const units = order === "forward" ? forward : Arr.reverse(forward);
  const loadStart = load1();
  const startedAt = DateTime.formatIso(yield* DateTime.now);

  const measurements = yield* Effect.all(
    units.map((unit) => runUnit(unit, args)),
    { concurrency: 1 },
  );

  return {
    index,
    loadEnd: load1(),
    loadStart,
    measurements,
    order,
    repeatOf,
    startedAt,
    superseded: undefined,
  };
});

/**
 * Compute the median of a non-empty list.
 *
 * @param xs - The values.
 * @returns The middle value, or the mean of the two middle values.
 */
const median = (xs: Arr.NonEmptyReadonlyArray<number>): number => {
  const sorted = Arr.sort(xs, Order.Number);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? Number.NaN;

  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? Number.NaN) + upper) / 2;
};

/**
 * Compute the probability that a binomial(n, 1/2) variable is at most `k`.
 *
 * @param n - The trial count.
 * @param k - The bound.
 * @returns P(X <= k).
 */
const binomialAtMost = (n: number, k: number): number => {
  let term = 0.5 ** n;
  let total = 0;

  for (let i = 0; i <= k; i += 1) {
    total += term;
    term = (term * (n - i)) / (i + 1);
  }

  return total;
};

/**
 * Compute a median and its distribution-free interval.
 *
 * The interval is `[x(k), x(n-k+1)]` for the largest rank `k` with `2 P(X <= k-1) <= 0.05`, `X`
 * binomial(n, 1/2); below 6 values no rank reaches 95%, so the interval is the range and its
 * coverage is `1 - 2^(1-n)`.
 *
 * @param xs - The per-round values.
 * @returns The interval, or `None` when `xs` is empty.
 */
export const interval = (xs: readonly number[]): Option.Option<Interval> => {
  if (!Arr.isReadonlyArrayNonEmpty(xs)) {
    return Option.none();
  }

  const sorted = Arr.sort(xs, Order.Number);
  const n = sorted.length;
  let k = 1;

  while (k + 1 <= Math.ceil(n / 2) && 2 * binomialAtMost(n, k) <= 0.05) {
    k += 1;
  }

  return Option.some({
    coverage: 1 - 2 * binomialAtMost(n, k - 1),
    high: sorted[n - k] ?? Number.NaN,
    low: sorted[k - 1] ?? Number.NaN,
    median: median(xs),
    n,
  });
};

/**
 * Name a unit for the summary: `<side>:<id>`.
 *
 * @param unit - The unit.
 * @returns Its key.
 */
const keyOf = (unit: Unit): string => `${unit.side}:${unit.id}`;

/**
 * Read one metric of every unit of a round.
 *
 * @param round - The round.
 * @param metric - The metric to read from each result.
 * @returns Each unit's key mapped to the metric; failed units and units whose runtime does not
 *   report the metric (a non-finite value) are absent.
 */
const valuesOf = (
  round: Round,
  metric: (result: ChildResult) => number,
): ReadonlyMap<string, number> =>
  new Map(
    round.measurements.flatMap((m) => {
      if (!("result" in m.line)) {
        return [];
      }

      const value = metric(m.line.result);

      return Number.isFinite(value) ? [[keyOf(m), value]] : [];
    }),
  );

/**
 * Find the outlier test a round fails, against the distribution of every round in the block.
 *
 * A round is an outlier when its larger load reading exceeds twice the block's median, when any
 * unit failed, or when any unit's CPU time per operation lies beyond 3 scaled MADs
 * (`1.4826 * MAD`) of that unit's median over the block.
 *
 * @param rounds - The block's rounds.
 * @param round - The round to test.
 * @returns The failed test, or `None` when the round passes.
 */
const outlierTest = (rounds: readonly Round[], round: Round): Option.Option<string> => {
  const loads = rounds.map((r) => Math.max(r.loadStart, r.loadEnd));
  const loadMedian = Arr.isReadonlyArrayNonEmpty(loads) ? median(loads) : Number.NaN;
  const own = Math.max(round.loadStart, round.loadEnd);

  if (own > 2 * loadMedian) {
    return Option.some(`load ${own.toFixed(2)} > 2 x block median ${loadMedian.toFixed(2)}`);
  }

  const failedUnit = round.measurements.find((m) => "failure" in m.line);

  if (failedUnit !== undefined) {
    return Option.some(`${keyOf(failedUnit)} failed`);
  }

  const cpu = valuesOf(round, (r) => r.cpuPerOpMs);

  for (const [key, value] of cpu) {
    const all = rounds.flatMap((r) => {
      const v = valuesOf(r, (x) => x.cpuPerOpMs).get(key);

      return v === undefined ? [] : [v];
    });

    if (Arr.isReadonlyArrayNonEmpty(all)) {
      const m = median(all);
      const deviations = all.map((x) => Math.abs(x - m));
      const mad = Arr.isReadonlyArrayNonEmpty(deviations) ? median(deviations) : 0;

      if (mad > 0 && Math.abs(value - m) > 3 * 1.4826 * mad) {
        return Option.some(
          `${key} CPU ${value.toFixed(3)} ms/op beyond 3 MAD of median ${m.toFixed(3)}`,
        );
      }
    }
  }

  return Option.none();
};

/**
 * Compute a per-round derived value over the rounds the summary keeps.
 *
 * @param rounds - The kept rounds.
 * @param derive - The value of one round from its per-unit metric, or `None` when a unit is
 *   missing.
 * @param metric - The metric each unit contributes.
 * @returns The interval of the derived values, or `None` when no round yields one.
 */
const perRound = (
  rounds: readonly Round[],
  derive: (values: ReadonlyMap<string, number>) => Option.Option<number>,
  metric: (result: ChildResult) => number,
): Option.Option<Interval> =>
  interval(rounds.flatMap((round) => Option.toArray(derive(valuesOf(round, metric)))));

/**
 * Construct the ratio of two units' values in a round.
 *
 * @param numerator - The key of the numerator unit.
 * @param denominator - The key of the denominator unit.
 * @returns The derivation reading both units of a round.
 */
const ratio =
  (numerator: string, denominator: string) =>
  (values: ReadonlyMap<string, number>): Option.Option<number> => {
    const a = values.get(numerator);
    const b = values.get(denominator);

    return a === undefined || b === undefined ? Option.none() : Option.some(a / b);
  };

/**
 * Read a new-tree unit's value from a round.
 *
 * @param values - The round's per-unit values.
 * @param id - The case or rung id.
 * @returns The value, or `None` when the unit is missing or failed.
 */
const ladder = (values: ReadonlyMap<string, number>, id: string): Option.Option<number> =>
  Option.fromNullishOr(values.get(`new:${id}`));

/**
 * Read `K`, the tokenizer plus resolver cost, from a round: the `resolver` rung minus `transport`.
 *
 * @param values - The round's per-unit values.
 * @returns `K`, or `None` when either rung is missing.
 */
const k = (values: ReadonlyMap<string, number>): Option.Option<number> =>
  Option.zipWith(ladder(values, "resolver"), ladder(values, "transport"), (r, tr) => r - tr);

/**
 * Read `T`, the new tree's `effect-xml/typed-decode`, from a round.
 *
 * @param values - The round's per-unit values.
 * @returns `T`, or `None` when the case is missing.
 */
const t = (values: ReadonlyMap<string, number>): Option.Option<number> =>
  ladder(values, "effect-xml/typed-decode");

/**
 * Read `C`, `computis-effect-xml/typed-decode`, from a round.
 *
 * @param values - The round's per-unit values.
 * @returns `C`, or `None` when the case is missing.
 */
const c = (values: ReadonlyMap<string, number>): Option.Option<number> =>
  ladder(values, "computis-effect-xml/typed-decode");

/**
 * The CPU and wall metrics every summary reports, by name.
 */
const metrics = {
  cpuPerOpMs: (r) => r.cpuPerOpMs,
  wallMedianMs: (r) => r.wallMs.median,
} satisfies Readonly<Record<string, (result: ChildResult) => number>>;

/**
 * Read a resource field's number for a per-round metric.
 *
 * @param measured - The field.
 * @returns Its value, or `NaN` when the runtime reports it unavailable, which drops the unit from
 *   that metric's rounds.
 */
const numberOf = (measured: Measured): number =>
  Option.getOrElse(valueOf(measured), () => Number.NaN);

/**
 * The memory, first-record, and collector metrics every summary also reports, by name, as each
 * unit's per-round value and NEW/OLD ratio.
 *
 * `peakHeapUsedBytes` is the largest `heapUsed` read at each run's end over the sampling phase;
 * `peakRssBytes` is the process-lifetime maximum RSS, input loading included. The per-operation
 * metrics divide the sampling phase's totals by its sample count.
 */
const resourceMetrics = {
  allocationBytesPerOp: (r) => (numberOf(r.allocationBytesPerSecond) * r.wallMeanMs) / 1000,
  gcCountPerOp: (r) => numberOf(r.gcCount) / r.samples,
  gcPauseMsPerOp: (r) => numberOf(r.gcPauseMs) / r.samples,
  peakHeapUsedBytes: (r) => numberOf(r.heapUsedBytes),
  peakRssBytes: (r) => numberOf(r.peakRssBytes),
  timeToFirstRecordMedianMs: (r) => r.timeToFirstRecordMs?.median ?? Number.NaN,
} satisfies Readonly<Record<string, (result: ChildResult) => number>>;

/**
 * Summarize a block: each unit's per-round medians, the NEW/OLD and competitor ratios, and, when
 * the block carries the ladder rungs, the step-2 inputs.
 *
 * `K` is the `resolver` rung minus the `transport` rung, which is the tokenizer delta plus the
 * resolver delta of the ladder; `T` is the new tree's `effect-xml/typed-decode` and `C` is
 * `computis-effect-xml/typed-decode`, all from the same rounds.
 *
 * @param rounds - The rounds the summary keeps.
 * @param args - The driver arguments.
 * @returns The summary record written beside the rounds.
 */
const summarize = (rounds: readonly Round[], args: DriverArgs) => {
  const units = schedule(args);

  const paired = [
    ...args.cases.filter((id) => id.startsWith("effect-xml/")),
    ...(args.pairedRungs ? args.rungs : []),
    ...args.failures,
  ];

  const unitsOf = (metric: (result: ChildResult) => number) =>
    Object.fromEntries(
      units.map((unit) => [
        keyOf(unit),
        perRound(rounds, (values) => Option.fromNullishOr(values.get(keyOf(unit))), metric),
      ]),
    );

  const newOverOldOf = (metric: (result: ChildResult) => number) =>
    Object.fromEntries(
      paired.map((id) => [id, perRound(rounds, ratio(`new:${id}`, `old:${id}`), metric)]),
    );

  const competitors: readonly (readonly [string, string])[] = [
    ["effect-xml/typed-decode", "computis-effect-xml/typed-decode"],
    ["effect-xml/encode-typed", "computis-effect-xml/encode-typed"],
  ];

  const byMetric = (metric: (result: ChildResult) => number) => {
    const deltas = Arr.zip(args.rungs.slice(0, -1), args.rungs.slice(1)).map(
      ([above, rung]) =>
        [
          rung,
          perRound(
            rounds,
            (values) =>
              Option.zipWith(ladder(values, rung), ladder(values, above), (a, b) => a - b),
            metric,
          ),
        ] as const,
    );

    return {
      competitors: Object.fromEntries(
        competitors
          .filter(([ours, theirs]) => args.cases.includes(ours) && args.cases.includes(theirs))
          .flatMap(([ours, theirs]) => [
            [`new/${theirs}`, perRound(rounds, ratio(`new:${ours}`, `new:${theirs}`), metric)],
            [`old/${theirs}`, perRound(rounds, ratio(`old:${ours}`, `new:${theirs}`), metric)],
          ]),
      ),
      ladderDeltas: Object.fromEntries(deltas),
      newOverOld: newOverOldOf(metric),
      step2: {
        C: perRound(rounds, c, metric),
        K: perRound(rounds, k, metric),
        KOverTMinusK: perRound(
          rounds,
          (v) => Option.zipWith(k(v), t(v), (kv, tv) => kv / (tv - kv)),
          metric,
        ),
        T: perRound(rounds, t, metric),
        TMinusK: perRound(rounds, (v) => Option.zipWith(t(v), k(v), (tv, kv) => tv - kv), metric),
        TMinusKOverC: perRound(
          rounds,
          (v) =>
            Option.flatMap(
              Option.zipWith(t(v), k(v), (tv, kv) => tv - kv),
              (d) => Option.map(c(v), (cv) => d / cv),
            ),
          metric,
        ),
        TOverC: perRound(rounds, (v) => Option.zipWith(t(v), c(v), (tv, cv) => tv / cv), metric),
      },
      units: unitsOf(metric),
    };
  };

  return {
    ...Object.fromEntries(Object.entries(metrics).map(([name, read]) => [name, byMetric(read)])),
    ...Object.fromEntries(
      Object.entries(resourceMetrics).map(([name, read]) => [
        name,
        { newOverOld: newOverOldOf(read), units: unitsOf(read) },
      ]),
    ),
  };
};

/**
 * The results file of one block.
 */
interface AbFile {
  readonly environment: Environment;
  readonly block: {
    readonly input: string;
    readonly jit: JitMode;
    readonly oldJit: JitMode;
    readonly policyName: string;
    readonly policy: SamplePolicy;
    readonly oldTree: string;
    readonly newTree: string;
    readonly oldCommit: string;
    readonly newCommit: string;
    readonly cases: readonly string[];
    readonly rungs: readonly string[];
    readonly failures: readonly FailureId[];
    readonly newOnly: boolean;
    readonly pairedRungs: boolean;
    readonly rounds: number;
  };
  readonly method: string;
  readonly rounds: readonly Round[];
  readonly repeated: number;
  readonly summary: ReturnType<typeof summarize> | undefined;
}

// Native: `effect/process` `ChildProcessSpawner` needs a platform layer, and no platform package is a dependency.
/**
 * Read a tree's checked-out commit.
 *
 * @param tree - The checkout.
 * @returns The full commit hash, or `unknown` when git cannot read it.
 */
const commitOf = (tree: string): Effect.Effect<string> =>
  Effect.try(() =>
    execFileSync("git", ["-C", tree, "rev-parse", "HEAD"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim(),
  ).pipe(Effect.orElseSucceed(() => "unknown"));

/**
 * The method text every results file carries.
 */
const methodText =
  "Interleaved A/B: each round runs every unit once, each in a child process of its own on the driver's runtime, in the schedule order on even rounds and reversed on odd rounds. A child loads the case or rung from its tree, runs the check once, warms up under the policy, then meters process.resourceUsage over the sampling phase alone; cpuPerOpMs is user+system CPU of the whole process over that phase divided by the sample count. The 1-minute load average is read at the start and end of every round and at the start of every unit. A round is an outlier when max(load start, load end) exceeds 2x the block median of that value, when a unit failed, or when a unit's cpuPerOpMs lies beyond 3 x 1.4826 x MAD of that unit's block median; each outlier round is repeated once after the planned rounds, and the repeat replaces it in the summary (the original stays, marked superseded). Summary values are per-round values reduced to a median with a distribution-free order-statistic interval (95%, or the range below 6 rounds, with its coverage). New-side units run in block.jit and old-side units in block.oldJit; when both sides are one tree, newOverOld is the ratio of the two JIT modes.";

/**
 * Run one block: the planned rounds, then one repeat of each outlier round, writing the results
 * file after every round.
 *
 * @param args - The driver arguments.
 * @returns The results file path and the number of repeated rounds.
 */
const runBlock = Effect.fnUntraced(function* runBlock(args: DriverArgs) {
  const env = yield* environment;
  const policy = policies[args.policy];

  const block = {
    cases: args.cases,
    failures: args.failures,
    input: args.input,
    jit: args.jit,
    newCommit: yield* commitOf(args.newTree),
    newOnly: args.newOnly,
    newTree: args.newTree,
    oldCommit: yield* commitOf(args.oldTree),
    oldJit: args.oldJit,
    oldTree: args.oldTree,
    pairedRungs: args.pairedRungs,
    policy,
    policyName: args.policy,
    rounds: args.rounds,
    rungs: args.rungs,
  };

  const write = (rounds: readonly Round[], repeated: number, done: boolean) => {
    const kept = rounds.filter((r) => r.superseded === undefined);

    const file: AbFile = {
      block,
      environment: env,
      method: methodText,
      repeated,
      rounds,
      summary: done ? summarize(kept, args) : undefined,
    };

    return Effect.try({
      catch: (cause) => new AbError({ reason: `cannot write ${args.out}: ${String(cause)}` }),
      try: () => {
        writeJsonFile(args.out, file);
      },
    });
  };

  const rounds: Round[] = [];

  for (let index = 0; index < args.rounds; index += 1) {
    rounds.push(yield* runRound(args, index, undefined));
    yield* write(rounds, 0, false);
    console.error(`ab: ${args.input} ${args.jit} round ${index + 1}/${args.rounds} done`);
  }

  const planned = [...rounds];
  let repeated = 0;

  for (const round of planned) {
    const test = outlierTest(planned, round);

    if (Option.isSome(test)) {
      const position = rounds.indexOf(round);

      rounds[position] = { ...round, superseded: test.value };
      repeated += 1;
      console.error(`ab: repeating round ${round.index + 1}: ${test.value}`);
      rounds.push(yield* runRound(args, round.index, round.index));
      yield* write(rounds, repeated, false);
    }
  }

  yield* write(rounds, repeated, true);

  return { out: args.out, repeated };
});

if (isEntryPoint(import.meta)) {
  const argv = process.argv.slice(2);

  void Effect.runPromise(
    readFlags(argv).pipe(
      Effect.flatMap((flags) =>
        flags.has("--child")
          ? parseChild(flags).pipe(
              Effect.flatMap(measureChild),
              Effect.map((result): ChildLine => ({ result })),
              Effect.catch(({ reason }) => Effect.succeed<ChildLine>({ failure: reason })),
              Effect.flatMap((line) =>
                Effect.sync(() => {
                  process.stdout.write(`${JSON.stringify(line)}\n`);
                  process.exitCode = "result" in line ? 0 : 1;
                }),
              ),
            )
          : parseDriver(flags).pipe(
              Effect.flatMap(runBlock),
              Effect.flatMap(({ out, repeated }) =>
                Effect.sync(() => {
                  console.log(`ab: wrote ${out}; ${repeated} round(s) repeated`);
                }),
              ),
            ),
      ),
      Effect.catch(({ reason }) =>
        Effect.sync(() => {
          console.error(`ab: ${reason}`);
          process.exitCode = 2;
        }),
      ),
    ),
  );
}
