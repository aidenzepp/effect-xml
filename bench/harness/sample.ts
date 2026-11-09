/**
 * The timing sampler: warm a prepared case up, time each synchronous run with `performance.now()`,
 * and reduce the samples to nearest-rank quantiles.
 *
 * The timed loop is a plain synchronous loop with no per-sample Effect or promise, so its own cost
 * is the {@link floor} a no-op case measures.
 */
import * as Arr from "effect/Array";
import { constUndefined, constVoid } from "effect/Function";
import * as Order from "effect/Order";

import type { PreparedCase, Quantiles } from "../types.ts";

/**
 * The bounds of one sampling run.
 *
 * Warmup runs until both `warmupIterations` and `warmupMs` are met. Sampling stops once at least
 * `minSamples` samples and `minMs` of sampling are both reached, or at `maxSamples`, or once the
 * whole run (warmup included) reaches `maxMs`; the time cap may stop sampling below `minSamples`,
 * but never before the first sample.
 */
export interface SamplePolicy {
  readonly warmupIterations: number;
  readonly warmupMs: number;
  readonly minSamples: number;
  readonly minMs: number;
  readonly maxSamples: number;
  readonly maxMs: number;
}

/**
 * The policy of a measured run: a 5-run, 1 s warmup, then 30 samples over at least 3 s, capped at
 * 200 samples or 60 s.
 */
export const defaultPolicy: SamplePolicy = {
  maxMs: 60_000,
  maxSamples: 200,
  minMs: 3000,
  minSamples: 30,
  warmupIterations: 5,
  warmupMs: 1000,
};

/**
 * The policy of a smoke run: no warmup and exactly one sample, to prove a case runs end to end.
 */
export const smokePolicy: SamplePolicy = {
  maxMs: 0,
  maxSamples: 1,
  minMs: 0,
  minSamples: 1,
  warmupIterations: 0,
  warmupMs: 0,
};

/**
 * The raw samples of one sampling run, in run order.
 */
export interface Samples {
  /**
   * The wall time of each timed run in milliseconds; never empty.
   */
  readonly wallMs: Arr.NonEmptyReadonlyArray<number>;
  /**
   * The offset in milliseconds from a run's start to its first `mark` call, for each timed run
   * that called `mark`; empty when the case never marks.
   */
  readonly firstRecordMs: readonly number[];
}

/**
 * The last output of a run, kept reachable from module scope so the runtime cannot discard the
 * measured work as dead code.
 */
// oxlint-disable-next-line no-unused-vars -- written on every run and never read: the write alone keeps each output alive.
let sink: unknown;

// Native: `effect/Clock` and `effect/Duration` report time through an Effect, which would add per-sample runtime overhead to the timed loop; `performance.now()` is read directly.
/**
 * Time a prepared case's `run` under a sampling policy, synchronously.
 *
 * Warmup runs receive a `mark` that records nothing. Each timed run receives a `mark` that records
 * the offset from that run's start the first time it is called in the run; later calls in the same
 * run are ignored. Every output is written to a module-level sink so the measured work stays
 * observable.
 *
 * @param prepared - The case to time; only its `run` is called.
 * @param policy - The warmup and stopping bounds.
 * @returns The wall time of every timed run and the first-record offset of every run that marked.
 */
export const sample = (prepared: PreparedCase, policy: SamplePolicy): Samples => {
  const started = performance.now();
  const firstRecordMs: number[] = [];
  let runStarted = 0;
  let marked = false;

  const mark = (): void => {
    if (!marked) {
      marked = true;
      firstRecordMs.push(performance.now() - runStarted);
    }
  };

  const timeRun = (): number => {
    marked = false;
    runStarted = performance.now();
    sink = prepared.run(mark);

    return performance.now() - runStarted;
  };

  for (
    let warmups = 0;
    (warmups < policy.warmupIterations || performance.now() - started < policy.warmupMs) &&
    performance.now() - started < policy.maxMs;
    warmups += 1
  ) {
    sink = prepared.run(constVoid);
  }

  const sampling = performance.now();
  const wallMs: Arr.NonEmptyArray<number> = [timeRun()];

  while (
    !(wallMs.length >= policy.minSamples && performance.now() - sampling >= policy.minMs) &&
    wallMs.length < policy.maxSamples &&
    performance.now() - started < policy.maxMs
  ) {
    wallMs.push(timeRun());
  }

  return { firstRecordMs, wallMs };
};

/**
 * Read the nearest-rank quantiles of a set of samples.
 *
 * The `q` quantile of `n` sorted samples is the sample at rank `ceil(q * n)`, so every quantile is
 * an observed value and one sample is every quantile.
 *
 * @param xs - The samples in milliseconds, in any order.
 * @returns The median, p95, p99, minimum, and maximum.
 */
export const quantiles = (xs: Arr.NonEmptyReadonlyArray<number>): Quantiles => {
  const sorted = Arr.sort(xs, Order.Number);
  const rank = (q: number): number => Arr.getUnsafe(sorted, Math.ceil(q * sorted.length) - 1);

  return {
    max: Arr.lastNonEmpty(sorted),
    median: rank(0.5),
    min: Arr.headNonEmpty(sorted),
    p95: rank(0.95),
    p99: rank(0.99),
  };
};

/**
 * The case the floor measures: its `run` does no work.
 */
const noop: PreparedCase = {
  check: () => 0,
  expected: 0,
  run: constUndefined,
};

/**
 * Measure the sampler's own cost: the quantiles of a no-op case sampled under a policy.
 *
 * @param policy - The policy the measured cases use, so the floor is comparable.
 * @returns The wall-time quantiles of the no-op case.
 */
export const floor = (policy: SamplePolicy): Quantiles => quantiles(sample(noop, policy).wallMs);
