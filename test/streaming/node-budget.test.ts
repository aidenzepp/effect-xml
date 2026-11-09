import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Xml } from "effect/encoding";
import { collect, resolveEvents } from "../../src/resolve.ts";
import { retained } from "./heap.ts";

/**
 * Collect the `r` record of a document made of `count` repetitions of `unit` and hold it.
 *
 * @param unit - The markup repeated under the root.
 * @param count - The number of repetitions.
 * @returns The retained heap measurement with the collected root as its value.
 */
const retainedRepetitions = (unit: string, count: number) => {
  const text = `<r>${unit.repeat(count)}</r>`;

  return retained(() =>
    Effect.runSync(
      Stream.make(text).pipe(
        Stream.pipeThroughChannel(Xml.decodeString()),
        Stream.pipeThroughChannel(resolveEvents()),
        Stream.pipeThroughChannel(
          collect(["r"], { maxElementNodes: Infinity, maxElementSize: Infinity }),
        ),
        Stream.runCollect,
      ),
    ),
  );
};

/**
 * Retained bytes per repetition of `unit`, from the slope between two document sizes so the
 * pipeline's fixed cost cancels.
 *
 * @param unit - The markup repeated under the root.
 * @returns The slope in bytes and both measurements, which keep their collected values alive.
 */
const slope = (unit: string) => {
  const small = retainedRepetitions(unit, 200_000);
  const large = retainedRepetitions(unit, 400_000);

  return { large, perRepetition: (large.retainedBytes - small.retainedBytes) / 200_000, small };
};

describe("node budget", () => {
  it.live(
    "empty elements and text runs",
    () =>
      Effect.sync(() => {
        const empty = slope("<a/>");
        const bytesPerEmptyElement = empty.perRepetition;

        expect(empty.small.value.length).toBe(1);
        expect(empty.large.value.length).toBe(1);
        expect(bytesPerEmptyElement).toBeGreaterThan(0);
        // A budget of 1,000,000 nodes keeps the worst case under 256 MiB retained on this runtime.
        expect(bytesPerEmptyElement * 1_000_000).toBeLessThanOrEqual(256 * 1024 * 1024);

        // Each repetition of `<a>x</a>` is two nodes: one element start and one text run.
        const text = slope("<a>x</a>");
        const bytesPerTextRun = text.perRepetition - bytesPerEmptyElement;

        expect(text.small.value.length).toBe(1);
        expect(text.large.value.length).toBe(1);
        expect(text.perRepetition).toBeGreaterThan(0);
        console.log(
          `node-budget: ${bytesPerEmptyElement} B per empty element, ${bytesPerTextRun} B per text run, runtime ${process.versions.bun ?? process.version}`,
        );
      }),
    120_000,
  );
});
