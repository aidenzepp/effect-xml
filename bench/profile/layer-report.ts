/**
 * The layer report: read A/B results files that ran the typed ladders of
 * `bench/profile/layers.ts` beside the typed cases, and derive each layer's CPU and wall cost per
 * operation round by round, its share of the new tree's total `T`, and its size against
 * `@computis/effect-xml`'s total `C`.
 *
 * A layer's cost in a round is its ladder unit's value minus the value of the unit before it, each
 * from its own child process; the last unit is the typed case itself. Each derived value is reduced
 * across the block's kept rounds to a median with the driver's distribution-free interval, so a
 * layer within the noise shows an interval that spans zero.
 *
 * Run directly as `bun bench/profile/layer-report.ts --out <file> <ab file>...` (or `node`).
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { interval } from "../ab.ts";
import type { Interval } from "../ab.ts";
import { environment } from "../harness/environment.ts";
import { isEntryPoint, writeJsonFile } from "../harness/script.ts";
import type { ResultsFile } from "../harness/script.ts";

/**
 * The failure of the command-line entry: a bad argument, or a file that cannot be read, decoded,
 * or written.
 */
export class LayerReportError extends Data.TaggedError("LayerReportError")<{
  readonly reason: string;
}> {}

/**
 * The parts of an A/B results file the report reads: the block's runtime, JIT mode, and input, and
 * each round's per-unit CPU and wall values. A superseded round is left out, as the driver's own
 * summary leaves it out.
 */
const AbFileSchema = Schema.Struct({
  block: Schema.Struct({ input: Schema.String, jit: Schema.String, newCommit: Schema.String }),
  environment: Schema.Struct({ runtime: Schema.String, runtimeVersion: Schema.String }),
  rounds: Schema.Array(
    Schema.Struct({
      loadEnd: Schema.Number,
      loadStart: Schema.Number,
      measurements: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          line: Schema.Union([
            Schema.Struct({
              result: Schema.Struct({
                cpuPerOpMs: Schema.Number,
                wallMs: Schema.Struct({ median: Schema.Number }),
              }),
            }),
            Schema.Struct({ failure: Schema.String }),
          ]),
          side: Schema.String,
        }),
      ),
      superseded: Schema.optionalKey(Schema.String),
    }),
  ),
});

/**
 * A decoded {@link AbFileSchema}.
 */
type AbFile = typeof AbFileSchema.Type;

/**
 * One rung of a typed ladder: the layer it adds and the A/B unit that measures the pipeline up to
 * and including that layer.
 */
interface Step {
  readonly layer: string;
  readonly unit: string;
}

/**
 * A typed ladder: its steps in order, the last being the new tree's typed case `total`; the
 * competitor's case; and the units that stand beside the ladder, each measuring one layer alone.
 */
interface Ladder {
  readonly direction: "decode" | "encode";
  readonly steps: readonly Step[];
  readonly total: string;
  readonly competitor: string;
  readonly beside: readonly Step[];
}

/**
 * The two typed ladders, in the rung order of `bench/profile/layers.ts`.
 *
 * Decode: the tokenizer, the namespace resolver, the collector that builds the resolved root, the
 * builder to the plain object, the structural codec's decode, `decodeString`'s glue (the faster
 * path's attempt, the span, and the debug log), and the `fromString` wrapper, whose type-side
 * decode `typed/to-type` measures alone. Encode mirrors it: the structural codec's encode, the
 * writer to events, the tokenizer's encode to text, `encodeString`'s glue, and the `fromString`
 * wrapper, whose type-side encode `typed/encode-to-type` measures alone.
 */
const ladders: readonly Ladder[] = [
  {
    beside: [{ layer: "from-string type-side decode", unit: "typed/to-type" }],
    competitor: "computis-effect-xml/typed-decode",
    direction: "decode",
    steps: [
      { layer: "tokenizer", unit: "typed/tokenizer" },
      { layer: "resolver", unit: "typed/resolver" },
      { layer: "collector", unit: "typed/collector" },
      { layer: "builder", unit: "typed/builder" },
      { layer: "structural decode", unit: "typed/structural" },
      { layer: "decodeString glue", unit: "typed/decode-string" },
      { layer: "fromString wrapper", unit: "effect-xml/typed-decode" },
    ],
    total: "effect-xml/typed-decode",
  },
  {
    beside: [{ layer: "from-string type-side encode", unit: "typed/encode-to-type" }],
    competitor: "computis-effect-xml/encode-typed",
    direction: "encode",
    steps: [
      { layer: "structural encode", unit: "typed/encode-structural" },
      { layer: "writer", unit: "typed/encode-writer" },
      { layer: "tokenizer encode", unit: "typed/encode-tokenizer" },
      { layer: "encodeString glue", unit: "typed/encode-string" },
      { layer: "fromString wrapper", unit: "effect-xml/encode-typed" },
    ],
    total: "effect-xml/encode-typed",
  },
];

/**
 * The metrics the report derives, by name: CPU time per operation first, wall median second.
 */
const metrics = {
  cpuPerOpMs: (result: { readonly cpuPerOpMs: number }) => result.cpuPerOpMs,
  wallMedianMs: (result: { readonly wallMs: { readonly median: number } }) => result.wallMs.median,
} as const;

/**
 * One layer's derived values, each a median over the kept rounds with its interval: the cost per
 * operation, its share of `T`, its ratio to `C`, and `T/C` with the layer's cost removed, the
 * ceiling of making that layer free.
 */
interface LayerRow {
  readonly layer: string;
  readonly unit: string;
  readonly costMs: Interval | undefined;
  readonly shareOfTotal: Interval | undefined;
  readonly overCompetitor: Interval | undefined;
  readonly totalOverCompetitorWithout: Interval | undefined;
}

/**
 * Read each new-tree unit's value of one metric from a round.
 *
 * @param round - The round.
 * @param metric - The metric to read.
 * @returns Each unit id mapped to its value; failed units are absent.
 */
const roundValues = (
  round: AbFile["rounds"][number],
  metric: (typeof metrics)[keyof typeof metrics],
): ReadonlyMap<string, number> =>
  new Map(
    round.measurements.flatMap((m) =>
      m.side === "new" && "result" in m.line ? [[m.id, metric(m.line.result)] as const] : [],
    ),
  );

/**
 * Reduce a per-round derivation to its median and interval.
 *
 * @param values - Each kept round's unit values.
 * @param derive - The derived value of one round, or `undefined` when a unit is missing.
 * @returns The interval, or `undefined` when no round yields a value.
 */
const across = (
  values: readonly ReadonlyMap<string, number>[],
  derive: (round: ReadonlyMap<string, number>) => number | undefined,
): Interval | undefined =>
  Option.getOrUndefined(
    interval(
      values.flatMap((round) => {
        const value = derive(round);

        return value === undefined ? [] : [value];
      }),
    ),
  );

/**
 * Derive one layer row from a cost per round.
 *
 * @param ladder - The ladder the layer belongs to.
 * @param step - The layer and its unit.
 * @param values - Each kept round's unit values.
 * @param cost - The layer's cost in one round, or `undefined` when a unit is missing.
 * @returns The layer's row.
 */
const rowOf = (
  ladder: Ladder,
  step: Step,
  values: readonly ReadonlyMap<string, number>[],
  cost: (round: ReadonlyMap<string, number>) => number | undefined,
): LayerRow => {
  const withTotals =
    (f: (x: number, t: number, c: number) => number) => (round: ReadonlyMap<string, number>) => {
      const x = cost(round);
      const t = round.get(ladder.total);
      const c = round.get(ladder.competitor);

      return x === undefined || t === undefined || c === undefined ? undefined : f(x, t, c);
    };

  return {
    costMs: across(values, cost),
    layer: step.layer,
    overCompetitor: across(
      values,
      withTotals((x, _t, c) => x / c),
    ),
    shareOfTotal: across(
      values,
      withTotals((x, t) => x / t),
    ),
    totalOverCompetitorWithout: across(
      values,
      withTotals((x, t, c) => (t - x) / c),
    ),
    unit: step.unit,
  };
};

/**
 * Derive one ladder's rows under one metric.
 *
 * @param ladder - The ladder.
 * @param values - Each kept round's unit values.
 * @returns `T`, `C`, `T/C`, a row per ladder layer, and a row per unit beside the ladder.
 */
const ladderReport = (ladder: Ladder, values: readonly ReadonlyMap<string, number>[]) => ({
  beside: ladder.beside.map((step) => rowOf(ladder, step, values, (round) => round.get(step.unit))),
  competitorMs: across(values, (round) => round.get(ladder.competitor)),
  layers: ladder.steps.map((step, index) =>
    rowOf(ladder, step, values, (round) => {
      const own = round.get(step.unit);
      const previous = index === 0 ? 0 : round.get(ladder.steps[index - 1]?.unit ?? "");

      return own === undefined || previous === undefined ? undefined : own - previous;
    }),
  ),
  totalMs: across(values, (round) => round.get(ladder.total)),
  totalOverCompetitor: across(values, (round) => {
    const t = round.get(ladder.total);
    const c = round.get(ladder.competitor);

    return t === undefined || c === undefined ? undefined : t / c;
  }),
});

/**
 * Derive the report of one A/B block.
 *
 * @param file - The decoded A/B file.
 * @param source - The file's path, recorded so every number traces to it.
 * @returns The block's identity, its kept round count and load range, and both ladders under
 *   every metric.
 */
const blockReport = (file: AbFile, source: string) => {
  const kept = file.rounds.filter((round) => round.superseded === undefined);
  const loads = kept.flatMap((round) => [round.loadStart, round.loadEnd]);

  return {
    commit: file.block.newCommit,
    input: file.block.input,
    jit: file.block.jit,
    keptRounds: kept.length,
    load: { max: Math.max(...loads), min: Math.min(...loads) },
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([name, metric]) => {
        const values = kept.map((round) => roundValues(round, metric));

        return [
          name,
          Object.fromEntries(
            ladders.map((ladder) => [ladder.direction, ladderReport(ladder, values)]),
          ),
        ];
      }),
    ),
    runtime: `${file.environment.runtime} ${file.environment.runtimeVersion}`,
    source,
  };
};

// Native: `effect/FileSystem` lacks an implementation without a platform layer, which is not a dependency.
/**
 * Read and decode one A/B results file.
 *
 * @param source - The file's path.
 * @returns The block's report.
 */
const readBlock = Effect.fnUntraced(function* readBlock(source: string) {
  const text = yield* Effect.try({
    catch: (cause) => new LayerReportError({ reason: `cannot read ${source}: ${String(cause)}` }),
    try: () => readFileSync(source, "utf-8"),
  });

  const file = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(AbFileSchema))(text).pipe(
    Effect.mapError(
      (error) =>
        new LayerReportError({ reason: `${source} is not an A/B results file: ${error.message}` }),
    ),
  );

  return blockReport(file, source);
});

// Native: `effect/cli` `Command.run` needs FileSystem, Path, Terminal, ChildProcessSpawner, and Stdio from a platform layer, which is not a dependency; `node:util` `parseArgs` runs on Bun and Node.
/**
 * Derive the report of every A/B file named on the command line and write it.
 *
 * @param args - The arguments after the script path.
 * @returns The path of the report written.
 */
const main = Effect.fnUntraced(function* main(
  args: readonly string[],
): Effect.fn.Return<string, LayerReportError> {
  const { positionals, values } = yield* Effect.try({
    catch: (cause) => new LayerReportError({ reason: String(cause) }),
    try: () =>
      parseArgs({ allowPositionals: true, args: [...args], options: { out: { type: "string" } } }),
  });

  const { out } = values;

  if (out === undefined || positionals.length === 0) {
    return yield* new LayerReportError({
      reason: "pass --out <file> and at least one A/B results file",
    });
  }

  const blocks = yield* Effect.all(positionals.map(readBlock));

  const report: ResultsFile & { readonly blocks: typeof blocks; readonly ladders: typeof ladders } =
    { blocks, environment: yield* environment, ladders };

  yield* Effect.try({
    catch: (cause) => new LayerReportError({ reason: `cannot write ${out}: ${String(cause)}` }),
    try: () => {
      writeJsonFile(out, report);
    },
  });

  return out;
});

if (isEntryPoint(import.meta)) {
  Effect.runSync(
    main(process.argv.slice(2)).pipe(
      Effect.match({
        onFailure: (error) => {
          console.error(`layer-report: ${error.reason}`);
          process.exitCode = 1;
        },
        onSuccess: (out) => {
          console.log(out);
        },
      }),
    ),
  );
}
