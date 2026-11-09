import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { decodeSchemaString } from "../src/channel.ts";
import { fromString } from "../src/document.ts";
import { Element } from "../src/dsl.ts";
import { XML, planOf, text } from "../src/plan.ts";

/**
 * The element every case decodes: a text element whose Type is `{ $text: string }`.
 */
const Leaf = Element("leaf", { content: text(Schema.String) });

/**
 * The plan of {@link Leaf}, read once so a counted marker returns it without recompiling.
 */
const leafPlan = planOf(Leaf);

/**
 * Build {@link Leaf} with a marker that counts how often its plan is read.
 *
 * `annotate` keeps the compiled encoding link, so the counted codec is still one the faster path
 * attempts; every read of the root's plan, by the decode or by its structural plan, counts.
 *
 * @returns The counted codec and its read count.
 */
const countedLeaf = () => {
  const reads = { count: 0 };

  const Counted = Leaf.annotate({
    [XML]: {
      name: "leaf",
      plan: () => {
        reads.count += 1;

        return leafPlan;
      },
      wire: "leaf",
    },
  });

  return { Counted, reads };
};

/**
 * Build a recursive reference to {@link Leaf} that counts how often its `Schema.suspend` thunk is
 * forced.
 *
 * The marker carries the plan without forcing the thunk, so reading the record codec's plan does
 * not force it; only the structural plan, which reads through the `Suspend` node, does.
 *
 * @returns The reference and its force count.
 */
const countedReference = () => {
  const forced = { count: 0 };

  // SAFETY: `Schema.suspend` keeps `Leaf`'s codec type; the marker only adds the element's name.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the marker leaves the codec type unchanged.
  const Ref = Schema.suspend(() => {
    forced.count += 1;

    return Leaf;
  }).annotate({ [XML]: { name: "leaf", plan: () => leafPlan, wire: "leaf" } }) as typeof Leaf;

  return { Ref, forced };
};

/**
 * Decode one document per body through `codec`, counting the root's plan reads of each decode.
 *
 * @param codec - The document codec.
 * @param reads - The read count of the codec's root.
 * @param bodies - The leaf text of each document.
 * @returns The plan reads of each decode, in order.
 */
const readsPerDecode = Effect.fnUntraced(function* readsPerDecode(
  codec: ReturnType<typeof fromString<typeof Leaf>>,
  reads: { readonly count: number },
  bodies: readonly string[],
) {
  const deltas: number[] = [];

  for (const body of bodies) {
    const before = reads.count;
    const value = yield* Schema.decodeUnknownEffect(codec)(`<leaf>${body}</leaf>`);

    expect(value).toStrictEqual({ $text: body });
    expect(yield* Schema.encodeEffect(codec)(value)).toContain(`<leaf>${body}</leaf>`);
    deltas.push(reads.count - before);
  }

  return deltas;
});

describe("fromString", () => {
  it.effect("builds its decoder once per codec, not once per document", () =>
    Effect.gen(function* buildsOnce() {
      const { Counted, reads } = countedLeaf();
      const decodes = yield* readsPerDecode(fromString(Counted), reads, ["a", "b", "c"]);

      // The first decode also reads the structural plan; later ones reuse the decoder's memo.
      expect(decodes[1]).toBe(decodes[2]);
      expect(decodes[0]).toBeGreaterThan(decodes[1] ?? 0);

      // A second codec over the same root builds its own decoder and reads the plan again.
      const again = yield* readsPerDecode(fromString(Counted), reads, ["d"]);

      expect(again).toStrictEqual([decodes[0]]);
    }),
  );
});

describe("decodeSchemaString", () => {
  it.effect("builds a channel over a recursive reference without forcing its thunk", () =>
    Effect.gen(function* buildsLazily() {
      const { Ref, forced } = countedReference();
      const channel = decodeSchemaString(Ref, ["leaf"])();

      expect(forced.count).toBe(0);

      const values = yield* Stream.runCollect(
        Stream.make("<leaf>a</leaf>").pipe(Stream.pipeThroughChannel(channel)),
      );

      expect(values).toStrictEqual([{ $text: "a" }]);
      expect(forced.count).toBe(1);
    }),
  );
});
