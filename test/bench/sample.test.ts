/**
 * The timing sampler: nearest-rank quantiles, the sample counts each policy yields, and the
 * first-record marks.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";

import { quantiles, sample, smokePolicy } from "../../bench/harness/sample.ts";
import type { SamplePolicy } from "../../bench/harness/sample.ts";
import type { PreparedCase } from "../../bench/types.ts";

/**
 * A fake case that counts its runs and calls `mark` a fixed number of times per run.
 */
interface CountingCase {
  readonly prepared: PreparedCase;
  readonly calls: () => number;
}

/**
 * Build a fake case whose `run` counts its calls and calls `mark` `marks` times.
 *
 * @param marks - How many times each run calls `mark`.
 * @returns The prepared case and a reader of its call count.
 */
const countingCase = (marks: number): CountingCase => {
  let calls = 0;

  return {
    calls: () => calls,
    prepared: {
      check: () => 0,
      expected: 0,
      run: (mark) => {
        calls += 1;

        for (let index = 0; index < marks; index += 1) {
          mark();
        }

        return calls;
      },
    },
  };
};

/**
 * The smoke policy widened to five samples; the time cap is lifted so the counts alone bound the
 * run.
 */
const fivePolicy: SamplePolicy = { ...smokePolicy, maxMs: 60_000, maxSamples: 5, minSamples: 5 };

describe("quantiles", () => {
  it("reads nearest-rank quantiles of 1 through 100", () => {
    expect(quantiles(Arr.range(1, 100))).toStrictEqual({
      max: 100,
      median: 50,
      min: 1,
      p95: 95,
      p99: 99,
    });
  });

  it("reads every quantile of one sample as that sample", () => {
    expect(quantiles([7])).toStrictEqual({ max: 7, median: 7, min: 7, p95: 7, p99: 7 });
  });
});

describe("sample", () => {
  it("runs once with no warmup under the smoke policy", () => {
    const fake = countingCase(0);
    const samples = sample(fake.prepared, smokePolicy);

    expect(fake.calls()).toBe(1);
    expect(samples.wallMs).toHaveLength(1);
  });

  it("takes five samples when the policy asks for five", () => {
    const fake = countingCase(0);
    const samples = sample(fake.prepared, fivePolicy);

    expect(fake.calls()).toBe(5);
    expect(samples.wallMs).toHaveLength(5);
  });

  it("records one first-record time per iteration when mark is called twice", () => {
    const samples = sample(countingCase(2).prepared, fivePolicy);

    expect(samples.firstRecordMs).toHaveLength(samples.wallMs.length);
    expect(samples.firstRecordMs).toHaveLength(5);
  });

  it("records no first-record time when mark is never called", () => {
    const samples = sample(countingCase(0).prepared, fivePolicy);

    expect(samples.firstRecordMs).toHaveLength(0);
  });
});
