/**
 * Compares the `src` fast path with the `src` standard path over the synthetic item-bank inputs:
 * the bench typed case's whole-document decode and the encode of its value, and the bench stream
 * case's record channels over text and byte chunks with positions off and on.
 *
 * The standard side runs the same surfaces over `standardOf(ItemBank)` and `standardOf(ItemRef)`
 * (`../differential/harness.ts`), so every comparison is strict equality between the two paths at
 * the same commit. Each test also requires the `src` roots it compares to be structural, so the
 * suite cannot pass by comparing the standard path with itself.
 *
 * The suite lives in `test/bench/` because only that directory may import `bench/`, which owns the
 * bank generator and `ItemBank`.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { loadInput } from "../../bench/inputs/synthetic.ts";
import { ItemBank, bankPath } from "../../bench/vocabulary.ts";
import { XmlSchema } from "../../src/index.ts";
import { structuralPlan } from "../../src/structural-slot.ts";
import {
  channelDecode,
  documentDecode,
  documentEncode,
  src,
  standard,
  standardOf,
} from "../differential/harness.ts";
import type { ChannelOutcome } from "../differential/harness.ts";
import { ItemRef } from "../streaming/vocabulary.ts";

/**
 * The bank inputs the suite compares, valid sizes first and then the bad-last variants.
 * `bank-64m` is left out: its whole-document decode on both sides outgrows a Vitest run.
 */
const bankIds = [
  "bank-16k",
  "bank-256k",
  "bank-4m",
  "bank-256k-bad-last",
  "bank-4m-bad-last",
] as const;

/**
 * The parser limits of the bench typed case (`bench/cases/effect-xml-typed.ts`), so the bank root,
 * which spans the whole document, decodes at every size.
 */
const unlimited = { maxElementNodes: Infinity, maxElementSize: Infinity };

/**
 * The per-test timeout: both sides at `bank-4m` with positions on, four channel runs each, run on
 * Node, which is several times slower than the Bun positions rung of about 158 ms.
 */
const timeout = 120_000;

/**
 * Count the `src` roots that take the structural fast path (R-live), one per root with a plan.
 *
 * @param roots - The `src` roots a test compares.
 * @returns How many of them have a structural plan.
 */
const structuralCount = (roots: readonly Schema.Top[]): number =>
  roots.filter((root) => structuralPlan(root) !== undefined).length;

/**
 * The UTF-8 encoder that turns each text chunk into the byte chunk `decodeSchema` reads.
 */
const utf8 = new TextEncoder();

/**
 * Load one bank input and its single document.
 *
 * @param id - The bank input id.
 * @returns The input and its document, failing when the id is not provided or holds no document.
 */
const loadBank = Effect.fnUntraced(function* loadBank(id: string) {
  const input = yield* Effect.fromOption(yield* loadInput(id));
  const document = yield* Effect.fromOption(Array.head(input.documents));

  return { document, input };
});

/**
 * Tell whether an input's last record lacks its required `href`, so every decode of it fails.
 *
 * @param id - The bank input id.
 * @returns Whether the input is a bad-last variant.
 */
const isBadLast = (id: string): boolean => id.endsWith("-bad-last");

/**
 * Name how a channel run ended: `done`, the decode reason's `_tag`, or `defect`.
 *
 * @param outcome - The channel outcome.
 * @returns The end's name.
 */
const endOf = (outcome: ChannelOutcome): string => {
  if (outcome.end === "done") {
    return "done";
  }

  return "defect" in outcome.end ? "defect" : outcome.end.reason._tag;
};

describe("bank differential", () => {
  for (const id of bankIds) {
    it.effect(
      `${id}: fromString decode and the encode of its value match the standard path`,
      () =>
        Effect.gen(function* documents() {
          const { document } = yield* loadBank(id);
          const srcCodec = XmlSchema.fromString(ItemBank, unlimited);
          const standardCodec = XmlSchema.fromString(standardOf(ItemBank), unlimited);
          const left = yield* documentDecode(src, srcCodec, document.text);
          const right = yield* documentDecode(standard, standardCodec, document.text);
          let compared = 1;

          expect(structuralCount([ItemBank])).toBe(1);
          expect(left).toStrictEqual(right);

          if (isBadLast(id)) {
            expect("value" in left || "defect" in left).toBe(false);
          } else {
            expect("value" in left).toBe(true);
          }

          if ("value" in left) {
            const encoded = yield* documentEncode(src, srcCodec, left.value);
            const reference = yield* documentEncode(standard, standardCodec, left.value);

            expect("text" in encoded).toBe(true);
            expect(encoded).toStrictEqual(reference);
            compared += 1;
          }

          expect(compared).toBe(isBadLast(id) ? 1 : 2);
        }),
      timeout,
    );

    it.effect(
      `${id}: record channels over text and bytes, positions off and on, match the standard path`,
      () =>
        Effect.gen(function* channels() {
          const { document, input } = yield* loadBank(id);
          const bytes = document.chunks.map((chunk) => utf8.encode(chunk));
          const standardRef = standardOf(ItemRef);
          let compared = 0;

          expect(structuralCount([ItemRef])).toBe(1);

          for (const positions of [false, true]) {
            const runs: readonly (readonly [ChannelOutcome, ChannelOutcome])[] = [
              [
                yield* channelDecode(
                  XmlSchema.decodeSchemaString(ItemRef, bankPath),
                  Stream.fromIterable(document.chunks),
                  { positions },
                ),
                yield* channelDecode(
                  XmlSchema.decodeSchemaString(standardRef, bankPath),
                  Stream.fromIterable(document.chunks),
                  { positions },
                ),
              ],
              [
                yield* channelDecode(
                  XmlSchema.decodeSchema(ItemRef, bankPath),
                  Stream.fromIterable(bytes),
                  { positions },
                ),
                yield* channelDecode(
                  XmlSchema.decodeSchema(standardRef, bankPath),
                  Stream.fromIterable(bytes),
                  { positions },
                ),
              ],
            ];

            for (const [left, right] of runs) {
              expect(left).toStrictEqual(right);

              if (isBadLast(id)) {
                expect(endOf(left)).toBe("SchemaFailure");
                expect(left.records.length).toBeGreaterThan(0);
              } else {
                expect(endOf(left)).toBe("done");
                expect(left.records).toHaveLength(input.reference.records);
              }

              compared += 1;
            }
          }

          expect(compared).toBe(4);
        }),
      timeout,
    );
  }
});
