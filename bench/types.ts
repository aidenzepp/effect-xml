/**
 * The shared contract of the benchmark harness: inputs, cases, library profiles, metrics, and the
 * results file every case module, input module, and driver codes against.
 */
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

import type { Tokenizer } from "../src/tokenizer.ts";
import type { JitMode } from "./harness/jit.ts";

/**
 * The six like-for-like comparison classes of the performance goal; a case is compared only with
 * cases of the same class.
 */
export type BenchClass =
  | "events"
  | "tree"
  | "typed-decode"
  | "encode-tree"
  | "encode-typed"
  | "stream";

/**
 * One XML document of an input, with its text pre-split for the stream class.
 */
export interface BenchDocument {
  readonly name: string;
  readonly text: string;
  /**
   * Consecutive 64 KiB slices of `text`, fed chunk by chunk to the stream class.
   */
  readonly chunks: readonly string[];
}

/**
 * One benchmark input: a set of documents with the counts every case's output is checked against.
 */
export interface BenchInput {
  /**
   * One of the fixed input ids: `corpus-all`, `corpus-items`, `bank-16k`, `bank-256k`, `bank-4m`,
   * `bank-64m`, `bank-256k-bad-last`, `bank-4m-bad-last`.
   */
  readonly id: string;
  readonly family: "corpus" | "synthetic";
  /**
   * The UTF-8 length of all documents together.
   */
  readonly bytes: number;
  readonly documents: readonly BenchDocument[];
  /**
   * The element and record counts of the input, read from the upstream tokenizer, never from a
   * case under measurement.
   */
  readonly reference: { readonly elements: number; readonly records: number };
}

/**
 * A case after its one-time preparation, ready for the timed loop.
 */
export interface PreparedCase {
  /**
   * Run the measured work once, synchronously.
   *
   * @param mark - Called once when the first record is out; only the stream class calls it.
   * @returns The output, kept alive by the harness so the work is not optimized away.
   */
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- each library's output has its own type; the harness only keeps it alive and hands it back to the same case's `check`.
  readonly run: (mark: () => void) => unknown;
  /**
   * Count what an output of `run` holds, once per process and outside the timed loop.
   *
   * @param output - A value `run` returned.
   * @returns Elements for `events`, `tree`, and `encode-*`; records for `typed-decode` and
   *   `stream`.
   */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the opaque output of this case's own `run`; the case, not the harness, knows its type.
  readonly check: (output: unknown) => number;
  /**
   * The count `check` must return; a mismatch fails the case.
   */
  readonly expected: number;
}

/**
 * The capability record of one library, each flag measured by a probe rather than claimed from
 * memory.
 */
export interface LibraryProfile {
  /**
   * The npm package name, or `@aidenzepp/effect-xml`.
   */
  readonly library: string;
  /**
   * Parsing `<a><b></a>` fails.
   */
  readonly rejectsMalformed: boolean;
  /**
   * Prefixes become namespace URIs in the output, with the options the library's cases use.
   */
  readonly resolvesNamespaces: boolean;
  /**
   * The text of `<a>&amp;</a>` is `&`.
   */
  readonly decodesEntities: boolean;
  /**
   * The text of `<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>` is `x`.
   */
  readonly expandsDoctypeEntities: boolean;
  readonly reportsPositions: boolean;
  /**
   * The library accepts input chunk by chunk.
   */
  readonly streams: boolean;
  readonly typed: boolean;
  /**
   * The API names behind `reportsPositions`, `streams`, and `typed`, and any other caveat.
   */
  readonly notes: readonly string[];
}

/**
 * A preparation failure of one case; the harness records it and moves to the next case.
 */
export class CaseError extends Data.TaggedError("CaseError")<{
  readonly caseId: string;
  readonly reason: string;
}> {}

/**
 * One benchmark case: one library measured in one comparison class.
 */
export interface BenchCase {
  /**
   * `<library>/<class>[/<variant>]`, unique across the registry.
   */
  readonly id: string;
  readonly library: string;
  readonly class: BenchClass;
  /**
   * Decide from the input's id and family whether the case runs on it, so the driver plans the
   * matrix without loading any input.
   *
   * @param input - The id and family of a candidate input.
   * @returns `true` when the case runs on that input.
   */
  readonly accepts: (input: Pick<BenchInput, "id" | "family">) => boolean;
  /**
   * Build everything the timed loop needs, once per process.
   *
   * @param input - The loaded input to measure on.
   * @param tokenizer - The tokenizer an effect-xml case decodes and encodes through.
   * @returns The prepared case, or a `CaseError` naming why it cannot run.
   */
  readonly prepare: (
    input: BenchInput,
    tokenizer: Tokenizer,
  ) => Effect.Effect<PreparedCase, CaseError>;
}

/**
 * A measured value with its source, or the reason it is unavailable on this runtime.
 */
export type Measured =
  | { readonly value: number; readonly unit: string; readonly source: string }
  | { readonly unavailable: string };

/**
 * Latency quantiles in milliseconds, computed by nearest rank.
 */
export interface Quantiles {
  readonly median: number;
  readonly p95: number;
  readonly p99: number;
  readonly min: number;
  readonly max: number;
}

/**
 * Every metric of the owner's set for one case on one input.
 */
export interface CaseMetrics {
  readonly samples: number;
  readonly wallMs: Quantiles;
  /**
   * The input's bytes divided by the median seconds, over 1e6.
   */
  readonly throughputMBps: Measured;
  /**
   * Present for the stream class only.
   */
  readonly timeToFirstRecordMs: Quantiles | undefined;
  readonly cpuUserMs: Measured;
  readonly cpuSystemMs: Measured;
  readonly peakRssBytes: Measured;
  readonly heapUsedBytes: Measured;
  readonly allocationBytesPerSecond: Measured;
  readonly gcCount: Measured;
  readonly gcPauseMs: Measured;
}

/**
 * The result of one case on one input with one tokenizer.
 */
export interface CaseResult {
  readonly caseId: string;
  readonly library: string;
  readonly class: BenchClass;
  readonly input: string;
  readonly tokenizer: string;
  readonly bytes: number;
  readonly expected: number;
  /**
   * The count `check` returned.
   */
  readonly observed: number;
  readonly metrics: CaseMetrics;
}

/**
 * A case that failed to prepare, run, or check on one input.
 */
export interface CaseFailure {
  readonly caseId: string;
  readonly input: string;
  readonly reason: string;
}

/**
 * The machine, versions, and commit a run measured on.
 */
export interface Environment {
  readonly runtime: "bun" | "node";
  readonly runtimeVersion: string;
  readonly os: string;
  readonly arch: string;
  readonly cpuModel: string;
  readonly cores: number;
  readonly totalMemoryBytes: number;
  readonly commit: string;
  readonly dirty: boolean;
  /**
   * Each package name mapped to its installed version, or `"absent"`.
   */
  readonly packages: Readonly<Record<string, string>>;
}

/**
 * The sampling method a run used.
 */
export interface Method {
  readonly warmupIterations: number;
  readonly warmupMs: number;
  readonly minSamples: number;
  readonly minMs: number;
  readonly maxSamples: number;
  readonly maxMs: number;
  readonly chunkBytes: number;
  readonly quantile: "nearest-rank";
  /**
   * `process-per-case` for the case matrix; `single-process` for the layer ladder, which times
   * every rung of an input in one process.
   */
  readonly isolation: "process-per-case" | "single-process";
  /**
   * The sampler's own cost, measured on a no-op case.
   */
  readonly floorMs: Quantiles;
}

/**
 * One results file: the environment and method of a run with every result and failure.
 */
export interface RunFile {
  readonly environment: Environment;
  readonly method: Method;
  readonly results: readonly CaseResult[];
  readonly failures: readonly CaseFailure[];
}

/**
 * The environment block of a matrix results file: the machine record and the Schema JIT mode every
 * case process ran in.
 */
export interface MatrixEnvironment extends Environment {
  readonly jit: JitMode;
}

/**
 * The results file `bench/run.ts` writes: a {@link RunFile} whose environment records the JIT mode.
 */
export interface MatrixRunFile extends RunFile {
  readonly environment: MatrixEnvironment;
}
