/**
 * Process resource metrics over one synchronous body: CPU, peak RSS, heap, allocation rate, and GC.
 */
import * as Predicate from "effect/Predicate";
import * as v8 from "node:v8";

import type { Measured } from "../types.ts";

/**
 * The resource fields of `CaseMetrics`: every `Measured` field other than throughput and latency.
 */
export interface Resources {
  readonly cpuUserMs: Measured;
  readonly cpuSystemMs: Measured;
  /**
   * The process-lifetime maximum, which process-per-case isolation makes the case's own.
   */
  readonly peakRssBytes: Measured;
  /**
   * The largest `heapUsed` seen at the start, at every `heapProbe`, and at the end.
   */
  readonly heapUsedBytes: Measured;
  readonly allocationBytesPerSecond: Measured;
  readonly gcCount: Measured;
  readonly gcPauseMs: Measured;
}

/**
 * A body's value with the wall time it took and the resources it used.
 */
export interface Measurement<A> {
  readonly value: A;
  readonly elapsedMs: number;
  readonly resources: Resources;
}

/**
 * The options of one `measureResources` call.
 */
export interface MeasureOptions {
  /**
   * Skip both `v8.getHeapStatistics()` reads, leaving `allocationBytesPerSecond` unavailable.
   *
   * A case process started with `--cpu-prof` sets it: on Bun each read runs `jsc.heapStats()`,
   * which walks the whole heap, so the reads around the timed loop would dominate the profile.
   */
  readonly skipHeapStatistics?: boolean;
}

/**
 * One GC event as `GCProfiler.stop()` reports it.
 */
type GcStatistic = v8.GCProfilerResult["statistics"][number];

/**
 * The running maximum of `heapUsed` for the `measureResources` call in progress.
 */
let peakHeapUsed = 0;

/**
 * The label of the current runtime, `bun <version>` when `process.versions.bun` is present.
 */
const runtime =
  process.versions.bun === undefined
    ? `node ${process.versions.node}`
    : `bun ${process.versions.bun}`;

/**
 * The `source` every GC-derived field reports; Bun returns statistics whose fidelity is unverified.
 */
const gcSource =
  process.versions.bun === undefined
    ? "node:v8 GCProfiler"
    : "node:v8 GCProfiler on Bun (fidelity unverified)";

/**
 * Construct a measured field.
 *
 * @param value - The measured number.
 * @param unit - The unit `value` is expressed in.
 * @param source - The API the number comes from.
 * @returns The `{ value, unit, source }` branch of `Measured`.
 */
const measured = (value: number, unit: string, source: string): Measured => ({
  source,
  unit,
  value,
});

/**
 * Record the current `heapUsed` into the running maximum the current `measureResources` reports.
 *
 * Call it between samples, for example by wrapping a case's `run`, so the reported heap reflects
 * the body's working set rather than only its endpoints.
 */
export const heapProbe = (): void => {
  peakHeapUsed = Math.max(peakHeapUsed, process.memoryUsage().heapUsed);
};

/**
 * Sum the bytes allocated across a run from GC heap readings.
 *
 * Each GC boundary splits the run into intervals; an interval allocates the used heap before its
 * closing GC minus the used heap after the previous one, and the tail allocates the end reading
 * minus the last after-GC reading.
 *
 * @param startUsed - `usedHeapSize` before the body.
 * @param statistics - The GC events during the body, in order.
 * @param endUsed - `usedHeapSize` after the body.
 * @returns The bytes allocated over the body.
 */
const allocatedBytes = (
  startUsed: number,
  statistics: readonly GcStatistic[],
  endUsed: number,
): number => {
  let total = 0;
  let afterPrevious = startUsed;

  for (const gc of statistics) {
    total += gc.beforeGC.heapStatistics.usedHeapSize - afterPrevious;
    afterPrevious = gc.afterGC.heapStatistics.usedHeapSize;
  }

  return total + endUsed - afterPrevious;
};

// Native: `Effect.Metric` lacks process resource readings; it records application metrics only.
/**
 * Run a synchronous body once and measure the process resources it used.
 *
 * CPU is the `process.resourceUsage()` delta, peak RSS is its `maxRSS` after the body, heap is the
 * running maximum fed by `heapProbe`, and GC count, pause, and allocation rate come from a
 * `v8.GCProfiler` started around the body. When `GCProfiler` is absent every GC-derived field is
 * unavailable and names the runtime. Allocation rate also needs `v8.getHeapStatistics()` before
 * and after the body; with `skipHeapStatistics` neither read runs, allocation rate is unavailable
 * and names `--cpu-prof`, and every other field is measured as usual.
 *
 * @param body - The work to measure; it runs exactly once.
 * @param options - Whether to skip the heap statistics reads; the default reads them.
 * @returns The body's value, its wall milliseconds, and its resources.
 * @see https://nodejs.org/api/process.html#processresourceusage
 * @see https://nodejs.org/api/v8.html#class-v8gcprofiler
 */
export const measureResources = <A>(
  body: () => A,
  options: MeasureOptions = {},
): Measurement<A> => {
  const readHeap = options.skipHeapStatistics !== true;
  const profiler = Predicate.isFunction(v8.GCProfiler) ? new v8.GCProfiler() : undefined;

  peakHeapUsed = process.memoryUsage().heapUsed;

  const startUsed = readHeap ? v8.getHeapStatistics().used_heap_size : 0;
  const startUsage = process.resourceUsage();

  profiler?.start();

  const startMs = performance.now();
  const value = body();
  const elapsedMs = performance.now() - startMs;
  const result = profiler?.stop();
  const endUsage = process.resourceUsage();
  const endUsed = readHeap ? v8.getHeapStatistics().used_heap_size : 0;

  heapProbe();

  const usageSource = "process.resourceUsage";

  const cpuUserMs = measured(
    (endUsage.userCPUTime - startUsage.userCPUTime) / 1000,
    "ms",
    usageSource,
  );

  const cpuSystemMs = measured(
    (endUsage.systemCPUTime - startUsage.systemCPUTime) / 1000,
    "ms",
    usageSource,
  );

  const peakRssBytes = measured(
    endUsage.maxRSS * 1024,
    "bytes",
    "process.resourceUsage maxRSS (process lifetime)",
  );

  const heapUsedBytes = measured(peakHeapUsed, "bytes", "process.memoryUsage heapUsed");

  if (result === undefined) {
    const absent: Measured = { unavailable: `node:v8 GCProfiler absent on ${runtime}` };

    return {
      elapsedMs,
      resources: {
        allocationBytesPerSecond: absent,
        cpuSystemMs,
        cpuUserMs,
        gcCount: absent,
        gcPauseMs: absent,
        heapUsedBytes,
        peakRssBytes,
      },
      value,
    };
  }

  const { statistics } = result;
  const pauseMicroseconds = statistics.reduce((sum, gc) => sum + gc.cost, 0);

  const allocationBytesPerSecond: Measured = readHeap
    ? measured(
        allocatedBytes(startUsed, statistics, endUsed) / (elapsedMs / 1000),
        "bytes/s",
        gcSource,
      )
    : {
        unavailable:
          "v8.getHeapStatistics skipped in a --cpu-prof process; it walks the heap on Bun",
      };

  return {
    elapsedMs,
    resources: {
      allocationBytesPerSecond,
      cpuSystemMs,
      cpuUserMs,
      gcCount: measured(statistics.length, "count", gcSource),
      gcPauseMs: measured(pauseMicroseconds / 1000, "ms", gcSource),
      heapUsedBytes,
      peakRssBytes,
    },
    value,
  };
};
