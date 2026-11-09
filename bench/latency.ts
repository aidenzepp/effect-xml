/* oxlint-disable sort-keys -- row key order is the committed latency file's field order, which a rerun reproduces byte for byte. */
/**
 * The latency derivation: read the committed phase-3 A/B files measured with the Schema JIT off
 * and write `docs/rd/performance/phase-3-ab/latency-jit-off.json`, the per-case wall-time median,
 * p95, p99, mean, and CPU per operation of the new side.
 *
 * Run directly (`bun bench/latency.ts` or `node bench/latency.ts`), it rewrites the latency file
 * from the A/B files beside it and prints one summary line per row.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import * as Arr from "effect/Array";
import * as Console from "effect/Console";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";

import { isEntryPoint } from "./harness/script.ts";

declare global {
  /**
   * `JSON.rawJSON` from JSON.parse source text access: Bun and Node ship it, but the `ES2022` lib
   * this repository compiles against does not declare it.
   *
   * @see https://tc39.es/proposal-json-parse-with-source/
   */
  interface JSON {
    /**
     * Wrap the text of a JSON primitive so `JSON.stringify` emits it verbatim.
     *
     * @param text - The primitive's JSON text.
     * @returns A frozen raw JSON object carrying `text`.
     */
    readonly rawJSON: (text: string) => object;
  }
}

/**
 * The directory that holds the phase-3 A/B files and the latency file derived from them.
 */
const directory = path.join(import.meta.dirname, "../docs/rd/performance/phase-3-ab");

/**
 * The runtimes the latency file covers, in row order.
 */
const runtimes = ["bun", "node"] as const;

/**
 * The inputs the latency file covers per runtime, in row order.
 */
const inputs = ["bank-16k", "bank-4m"] as const;

/**
 * The cases the latency file covers per runtime and input, in row order.
 */
const cases = [
  "effect-xml/typed-decode",
  "effect-xml/encode-typed",
  "effect-xml/stream",
  "effect-xml/stream/positions",
] as const;

/**
 * The `method` field of the latency file: how every row value derives from the A/B files.
 */
const method =
  "Derived from the committed phase-3 A/B files named in each row (JIT off, NEW side, kept rounds only: rounds whose superseded field is unset). Each value is the median over those rounds of one child-process figure: wallMs.median, wallMs.p95, wallMs.p99 (the child's sampled per-run wall-time quantiles, rank ceil(q*n)), wallMeanMs (sampling-phase elapsed / samples), cpuPerOpMs (sampling-phase user+system CPU / samples). CPU is metered per process over the sampling phase, not per run, so no CPU p95/p99 exists. A child's p99 equals its slowest run when it took fewer than 100 samples, and its p95 when fewer than 20; p99IsMaxInRounds and p95IsMaxInRounds count such rounds. Script: bench/latency.ts.";

/**
 * The part of one child's result line the latency file reads.
 */
const ChildResult = Schema.Struct({
  cpuPerOpMs: Schema.Number,
  samples: Schema.Number,
  wallMeanMs: Schema.Number,
  wallMs: Schema.Struct({ median: Schema.Number, p95: Schema.Number, p99: Schema.Number }),
});

/**
 * The part of an A/B file the latency file reads: each round's measurements and whether a repeat
 * superseded the round. A measurement without a `result` is a failed child and contributes nothing.
 */
const AbFileJson = Schema.fromJsonString(
  Schema.Struct({
    rounds: Schema.Array(
      Schema.Struct({
        measurements: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            line: Schema.Struct({ result: Schema.optional(ChildResult) }),
            side: Schema.String,
          }),
        ),
        superseded: Schema.optional(Schema.NullOr(Schema.Unknown)),
      }),
    ),
  }),
);

/**
 * A latency file that could not be derived: an A/B file that cannot be read or decoded, or a
 * latency file that cannot be written.
 */
class LatencyError extends Data.TaggedError("LatencyError")<{
  readonly message: string;
}> {}

/**
 * A number as the latency file serializes it.
 *
 * The file's formatting predates this script and follows Python's `statistics.median`, whose
 * median of an even count is a float that serializes with a trailing `.0` when integral, such as
 * `9975.0`; a raw JSON number keeps that text, so a rerun leaves the committed file byte-identical.
 */
type JsonNumber = number | object;

/**
 * Take the median of a non-empty list the way Python's `statistics.median` does.
 *
 * @param values - The values.
 * @returns The middle value of an odd count, or the mean of the middle two of an even count, with
 *   an integral even-count median written as `<n>.0`.
 */
const median = (values: readonly number[]): JsonNumber => {
  const sorted = Arr.sort(values, Order.Number);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? Number.NaN;
  }

  const mean = ((sorted[middle - 1] ?? Number.NaN) + (sorted[middle] ?? Number.NaN)) / 2;

  return Number.isInteger(mean) ? JSON.rawJSON(`${mean}.0`) : mean;
};

// Native: `effect/FileSystem` lacks an implementation without a platform layer, which is not a dependency.
/**
 * Read and decode one A/B file of the phase-3 directory.
 *
 * @param file - The file name inside the phase-3 directory.
 * @returns The decoded file, or a `LatencyError` naming the file and the cause.
 */
const readAbFile = (file: string) => {
  const failure = (cause: unknown) =>
    new LatencyError({
      message: `Cannot read A/B file ${file}; restore it from the repository. Cause: ${String(cause)}`,
    });

  return Effect.try({
    catch: failure,
    try: () => readFileSync(path.join(directory, file), "utf-8"),
  }).pipe(
    Effect.flatMap((text) =>
      Schema.decodeUnknownEffect(AbFileJson)(text).pipe(Effect.mapError(failure)),
    ),
  );
};

/**
 * Derive the latency rows of one runtime and input: one row per case from the new side of the
 * kept rounds.
 *
 * @param runtime - The runtime the A/B file measured on.
 * @param input - The input id the A/B file measured.
 * @returns The rows, in case order.
 */
const rowsOf = Effect.fnUntraced(function* rowsOf(runtime: string, input: string) {
  const file = `${runtime}-jit-off-${input}.json`;
  const ab = yield* readAbFile(file);

  const kept = ab.rounds.filter(
    (round) => round.superseded === undefined || round.superseded === null,
  );

  return cases.map((id) => {
    const results = kept.flatMap((round) =>
      round.measurements.flatMap((measurement) =>
        measurement.side === "new" && measurement.id === id && measurement.line.result !== undefined
          ? [measurement.line.result]
          : [],
      ),
    );

    const samples = results.map((result) => result.samples);

    return {
      runtime,
      input,
      case: id,
      file,
      rounds: results.length,
      samplesPerChild: {
        min: Math.min(...samples),
        median: median(samples),
        max: Math.max(...samples),
      },
      wallMedianMs: median(results.map((result) => result.wallMs.median)),
      wallP95Ms: median(results.map((result) => result.wallMs.p95)),
      wallP99Ms: median(results.map((result) => result.wallMs.p99)),
      wallMeanMs: median(results.map((result) => result.wallMeanMs)),
      cpuPerOpMs: median(results.map((result) => result.cpuPerOpMs)),
      p99IsMaxInRounds: samples.filter((count) => count < 100).length,
      p95IsMaxInRounds: samples.filter((count) => count < 20).length,
    };
  });
});

if (isEntryPoint(import.meta)) {
  void Effect.runPromise(
    Effect.gen(function* deriveLatency() {
      const rows = (yield* Effect.all(
        runtimes.flatMap((runtime) => inputs.map((input) => rowsOf(runtime, input))),
      )).flat();

      const out = path.join(directory, "latency-jit-off.json");

      yield* Effect.try({
        catch: (cause) =>
          new LatencyError({
            message: `Cannot write latency file ${out}; check that the directory is writable. Cause: ${String(cause)}`,
          }),
        try: () => {
          writeFileSync(out, `${JSON.stringify({ method, rows }, null, 2)}\n`);
        },
      });

      for (const row of rows) {
        yield* Console.log(
          `${row.runtime} ${row.input} ${row.case} rounds=${row.rounds} samples=${row.samplesPerChild.min}..${row.samplesPerChild.max}`,
        );
      }
    }),
  );
}
