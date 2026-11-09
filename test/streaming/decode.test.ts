import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { XmlSchema } from "../../src/index.ts";
import { defaultMaxElementNodes, defaultMaxElementSize } from "../../src/resolve.ts";
import { forceGc, liveHeapBytes } from "./heap.ts";
import { byteSource } from "./source.ts";
import { ensureSynthetic } from "./synthetic.ts";
import { AssessmentTest, ItemRef, QTI, itemRefPath, testPath } from "./vocabulary.ts";

/**
 * The running fold of the count test: how many records arrived and the latest one.
 */
interface Fold {
  readonly count: number;
  readonly last: (typeof ItemRef)["Type"] | undefined;
}

describe("decode over the 50 MiB synthetic", () => {
  it.live(
    "emits every record in document order",
    () =>
      Effect.gen(function* run() {
        const { path, refsPerRepetition, repetitions } = yield* ensureSynthetic();

        const [duration, result] = yield* Effect.timed(
          Stream.runFold(
            byteSource(path).pipe(
              Stream.pipeThroughChannel(XmlSchema.decodeSchema(ItemRef, itemRefPath)()),
            ),
            (): Fold => ({ count: 0, last: undefined }),
            (acc, ref) => ({ count: acc.count + 1, last: ref }),
          ),
        );

        console.log(
          `streaming: ${result.count} records, wall ${Math.round(Duration.toMillis(duration))} ms`,
        );
        expect(result.count).toBe(repetitions * refsPerRepetition);
        expect(result.last?.identifier.startsWith(`r${repetitions - 1}-`)).toBe(true);
      }),
    120_000,
  );

  it.live(
    "stops reading once the consumer has taken enough records",
    () =>
      Effect.gen(function* run() {
        const { path } = yield* ensureSynthetic();

        const [duration, taken] = yield* Effect.timed(
          Stream.runCollect(
            byteSource(path).pipe(
              Stream.pipeThroughChannel(XmlSchema.decodeSchema(ItemRef, itemRefPath)()),
              Stream.take(3),
            ),
          ),
        );

        console.log(`streaming: take(3) wall ${Math.round(Duration.toMillis(duration))} ms`);
        expect(taken).toHaveLength(3);
      }),
    120_000,
  );
  it.live(
    "keeps the live heap bounded by the record across the document",
    () =>
      Effect.gen(function* run() {
        const { path } = yield* ensureSynthetic();
        const samples: number[] = [];
        let seen = 0;

        forceGc();

        const baseline = process.memoryUsage().heapUsed;

        yield* Stream.runDrain(
          byteSource(path).pipe(
            Stream.pipeThroughChannel(XmlSchema.decodeSchema(ItemRef, itemRefPath)()),
            Stream.tap(() =>
              Effect.sync(() => {
                seen += 1;

                if (seen % 20_000 === 0) {
                  samples.push(liveHeapBytes(baseline));
                }
              }),
            ),
          ),
        );

        console.log(
          `streaming: live heap MiB above baseline ${samples
            .map((bytes) => (bytes / 1024 / 1024).toFixed(1))
            .join(", ")}`,
        );
        expect(samples.length).toBeGreaterThanOrEqual(8);
        expect(Math.max(...samples)).toBeLessThanOrEqual(16 * 1024 * 1024);
        expect(Math.max(...samples) - (samples[0] ?? 0)).toBeLessThanOrEqual(4 * 1024 * 1024);
      }),
    120_000,
  );

  it.live(
    "fails the whole document with a maxElementSize Limit",
    () =>
      Effect.gen(function* run() {
        const { path } = yield* ensureSynthetic();

        const error = yield* Stream.runCollect(
          byteSource(path).pipe(
            Stream.pipeThroughChannel(XmlSchema.decodeSchema(AssessmentTest, testPath)()),
          ),
        ).pipe(Effect.flip);

        expect(error._tag).toBe("XmlDecodeError");

        if (error._tag !== "XmlDecodeError") {
          return;
        }

        expect(error.reason._tag).toBe("Limit");
        expect(error.reason._tag === "Limit" && error.reason.limit).toBe("maxElementSize");
        expect(error.reason._tag === "Limit" && error.reason.element).toBe(
          XmlSchema.clark(Option.some(QTI), "qti-assessment-test"),
        );
        expect(error.reason._tag === "Limit" && error.reason.max).toBe(defaultMaxElementSize);
        expect(error.path).toBe("/qti-assessment-test");
        expect(error.record).toBe(1);
      }),
    120_000,
  );

  it.live(
    "stops at the node budget and decodes past it when disabled",
    () =>
      Effect.gen(function* run() {
        const weights = 1_000_000;
        const children = '<qti-weight identifier="E" value="1"/>'.repeat(weights);

        const text = `<qti-assessment-item-ref xmlns="${QTI}" identifier="x" href="x">${children}</qti-assessment-item-ref>`;

        const itemRef = [XmlSchema.clark(Option.some(QTI), "qti-assessment-item-ref")];

        const error = yield* Stream.runCollect(
          Stream.make(text).pipe(
            Stream.pipeThroughChannel(
              XmlSchema.decodeSchemaString(ItemRef, itemRef)({ maxElementSize: Infinity }),
            ),
          ),
        ).pipe(Effect.flip);

        expect(error._tag).toBe("XmlDecodeError");

        if (error._tag !== "XmlDecodeError") {
          return;
        }

        expect(error.reason._tag).toBe("Limit");
        expect(error.reason._tag === "Limit" && error.reason.limit).toBe("maxElementNodes");
        expect(error.reason._tag === "Limit" && error.reason.measured).toBe(weights + 1);
        expect(error.reason._tag === "Limit" && error.reason.max).toBe(defaultMaxElementNodes);

        const refs = yield* Stream.runCollect(
          Stream.make(text).pipe(
            Stream.pipeThroughChannel(
              XmlSchema.decodeSchemaString(
                ItemRef,
                itemRef,
              )({
                maxElementNodes: Infinity,
                maxElementSize: Infinity,
              }),
            ),
          ),
        );

        expect(refs).toHaveLength(1);
        expect(refs[0]?.weights).toHaveLength(weights);
      }),
    120_000,
  );
});
