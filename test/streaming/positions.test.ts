import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { XmlSchema } from "../../src/index.ts";
import { byteSource } from "./source.ts";
import { ensureSynthetic, syntheticParts } from "./synthetic.ts";
import { ItemRef, itemRefPath } from "./vocabulary.ts";

/**
 * Split a string into consecutive pieces of `size` UTF-16 code units; the last may be shorter.
 *
 * @param source - The text to split.
 * @param size - The piece length in code units.
 * @returns The pieces in order.
 */
const splitEvery = (source: string, size: number): string[] => {
  const chunks: string[] = [];

  for (let offset = 0; offset < source.length; offset += size) {
    chunks.push(source.slice(offset, offset + size));
  }

  return chunks;
};

describe("decode with positions over the 50 MiB synthetic", () => {
  it.live(
    "counts every record while recording positions",
    () =>
      Effect.gen(function* run() {
        const { path, refsPerRepetition, repetitions } = yield* ensureSynthetic();

        const [duration, count] = yield* Effect.timed(
          Stream.runCount(
            byteSource(path).pipe(
              Stream.pipeThroughChannel(
                XmlSchema.decodeSchema(ItemRef, itemRefPath)({ positions: true }),
              ),
            ),
          ),
        );

        console.log(
          `positions: ${count} records, wall ${Math.round(Duration.toMillis(duration))} ms`,
        );
        expect(count).toBe(repetitions * refsPerRepetition);
      }),
    180_000,
  );

  it.live(
    "positions an injected failure on a large text stream",
    () =>
      Effect.gen(function* run() {
        const { footer, header, parts } = syntheticParts();
        const refsPerRepetition = parts.split("<qti-assessment-item-ref").length - 1;
        const prefixed = (i: number) => parts.replaceAll('identifier="', `identifier="r${i}-`);
        const k = Math.ceil((2 * 1024 * 1024) / parts.length);
        const chunks = [header];

        for (let i = 0; i < k; i += 1) {
          chunks.push(prefixed(i));
        }

        chunks.push(prefixed(k).replace('value="1.5"', 'value="x"'), footer);

        const doc = chunks.join("");
        const tag = doc.lastIndexOf("<qti-weight", doc.indexOf('value="x"'));
        const before = doc.slice(0, tag);
        const lineStart = before.lastIndexOf("\n") + 1;

        const expected = {
          column: tag - lineStart + 1,
          line: before.split("\n").length,
        };

        const error = yield* Stream.fromIterable(splitEvery(doc, 65_536)).pipe(
          Stream.pipeThroughChannel(
            XmlSchema.decodeSchemaString(ItemRef, itemRefPath)({ positions: true }),
          ),
          Stream.runDrain,
          Effect.flip,
        );

        expect(doc.length).toBeGreaterThan(2 * 1024 * 1024);
        expect(error.reason._tag).toBe("SchemaFailure");
        expect(error.record).toBe(k * refsPerRepetition + 3);
        expect(error.path).toBe("/qti-assessment-item-ref/qti-weight/@value");
        expect(error.position).toStrictEqual(expected);
      }),
    180_000,
  );
});
