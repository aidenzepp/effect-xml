/**
 * The resource half of the owner's metric set: CPU, peak RSS, heap, allocation rate, and GC.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { heapProbe, measureResources } from "../../bench/harness/metrics.ts";
import type { Resources } from "../../bench/harness/metrics.ts";
import type { Measured } from "../../bench/types.ts";

/**
 * The seven resource fields every measurement reports.
 */
const fields: readonly (keyof Resources)[] = [
  "cpuUserMs",
  "cpuSystemMs",
  "peakRssBytes",
  "heapUsedBytes",
  "allocationBytesPerSecond",
  "gcCount",
  "gcPauseMs",
];

/**
 * Read the number a measured field carries, failing the test when the field is unavailable.
 *
 * @param measured - The field to read.
 * @returns The measured value.
 */
const valueOf = (measured: Measured): number => {
  expect(measured).toHaveProperty("value");

  return Predicate.hasProperty(measured, "value") ? measured.value : Number.NaN;
};

/**
 * The two branches of `Measured`: a number with its unit and source, or the reason it is absent.
 */
const MeasuredSchema = Schema.Union([
  Schema.Struct({ source: Schema.String, unit: Schema.String, value: Schema.Number }),
  Schema.Struct({ unavailable: Schema.String }),
]);

/**
 * Whether a field is one of the two `Measured` branches.
 */
const isMeasured = Schema.is(MeasuredSchema);

/**
 * Allocate and drop about 50 MiB of small objects, probing the heap along the way.
 *
 * @returns The RSS observed inside the body and a marker value.
 */
const churn = () => {
  let batch: { readonly i: number }[] = [];

  for (let i = 0; i < 1_500_000; i += 1) {
    batch.push({ i });

    if (batch.length > 10_000) {
      heapProbe();
      batch = [];
    }
  }

  return { marker: "done", rssInside: process.memoryUsage().rss };
};

describe("measureResources", () => {
  it.effect("reports every resource field over an allocating body", () =>
    Effect.sync(() => {
      const measurement = measureResources(churn);
      const { resources } = measurement;

      expect(measurement.value.marker).toBe("done");
      expect(valueOf(resources.cpuUserMs)).toBeGreaterThanOrEqual(0);
      expect(valueOf(resources.peakRssBytes)).toBeGreaterThanOrEqual(measurement.value.rssInside);
      expect(valueOf(resources.gcCount)).toBeGreaterThan(0);
      expect(valueOf(resources.allocationBytesPerSecond)).toBeGreaterThan(0);

      for (const field of fields) {
        expect(isMeasured(resources[field])).toBe(true);
      }
    }),
  );

  it.effect("skips the heap statistics reads and keeps every other field measured", () =>
    Effect.sync(() => {
      const measurement = measureResources(churn, { skipHeapStatistics: true });
      const { resources } = measurement;
      const allocation = resources.allocationBytesPerSecond;

      expect(measurement.value.marker).toBe("done");
      expect(allocation).toHaveProperty("unavailable");
      expect(
        Predicate.hasProperty(allocation, "unavailable") ? allocation.unavailable : "",
      ).toContain("--cpu-prof");
      expect(valueOf(resources.cpuUserMs)).toBeGreaterThanOrEqual(0);
      expect(valueOf(resources.cpuSystemMs)).toBeGreaterThanOrEqual(0);
      expect(valueOf(resources.peakRssBytes)).toBeGreaterThanOrEqual(measurement.value.rssInside);
      expect(valueOf(resources.heapUsedBytes)).toBeGreaterThan(0);
      expect(valueOf(resources.gcCount)).toBeGreaterThan(0);
      expect(valueOf(resources.gcPauseMs)).toBeGreaterThanOrEqual(0);

      for (const field of fields) {
        expect(isMeasured(resources[field])).toBe(true);
      }
    }),
  );
});
