/**
 * Compares the `src` fast path with the `src` standard path over the QTI corpus, through the
 * differential harness. Each surface runs once over the `src` root and once over its `standardOf`
 * copy, and every outcome compares strictly equal.
 *
 * The typed `fromString(AssessmentItem)` decode, the encode of each decoded value, and both record
 * channels take the fast path on the `src` side, so they compare the fast path with the standard
 * path. A failed fast-path attempt returns the standard path's result, so their failing outcomes
 * compare the standard path with itself and guard against false accepts only. The raw-tree decode
 * (`ElementFromString`), the encode of each decoded tree, and the direct
 * `Schema.decodeUnknownExit(AssessmentItem)` over each side's own raw tree never take the fast
 * path, so they run the standard path on both sides. They stay as smoke coverage of the standard
 * path, which no reference guards against drift (accepted loss L1,
 * `docs/goals/performance/phase-3.slices.md`).
 *
 * The channel surfaces decode `qti-response-declaration` records at the root-anchored path
 * `[{QTI}qti-assessment-item, {QTI}qti-response-declaration]`, as `decodeSchemaString` over the
 * text and `decodeSchema` over its UTF-8 bytes, with `positions` off and on and the source whole
 * and in 64-unit pieces. The typed, direct, and channel surfaces run again under
 * `{ errors: "all" }` and `{ onExcessProperty: "error" }`.
 *
 * Every case compares `[id, outcome]` pairs with `expect.soft`, so one run reports every diverging
 * case. The final test asserts the compared-case, error, channel-record, per-variant, and
 * structural counts are above zero, so the suite cannot pass by comparing nothing, and its
 * fast-path surfaces cannot pass by comparing the standard path with itself. The native-position
 * path (`positions: "native"`) is not covered: it needs an honest native tokenizer per side.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Order from "effect/Order";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { XmlSchema as SrcXml } from "../../src/index.ts";
import { structuralPlan } from "../../src/structural-slot.ts";
import {
  byteChunks,
  channelInputs,
  corpus,
  itemInputs,
  parseVariants,
  recordPath,
  textChunks,
  treeInputs,
} from "./corpus.cases.ts";
import type { ChannelInput, ItemInput } from "./corpus.cases.ts";
import {
  channelDecode,
  directOutcome,
  documentDecode,
  documentEncode,
  src,
  standard,
} from "./harness.ts";
import type {
  ChannelOutcome,
  DecodeOutcome,
  DirectOutcome,
  EncodeOutcome,
  Side,
} from "./harness.ts";

/**
 * Any summary a corpus case compares.
 */
type Outcome = DecodeOutcome | EncodeOutcome | DirectOutcome | ChannelOutcome;

/**
 * The counts the suite accumulates across its surfaces, checked by the final test.
 *
 * `structural` counts the inputs whose `src` root has a structural plan, so at least one compared
 * run took the fast path.
 */
const tally = {
  compared: 0,
  errors: 0,
  records: 0,
  structural: 0,
  variants: new Map<string, number>(),
};

/**
 * Count one input whose `src` root takes the structural fast path.
 *
 * @param root - The input's `src` root or record definition.
 */
const countStructural = (root: Schema.Top): void => {
  tally.structural += structuralPlan(root) === undefined ? 0 : 1;
};

/**
 * Tell whether an outcome is an error: a document failure, a direct Schema failure, a defect, or a
 * channel run that did not end with `"done"`.
 *
 * @param outcome - The `src` side's outcome.
 * @returns `true` when the outcome is not a success.
 */
const isError = (outcome: Outcome): boolean => {
  if ("end" in outcome) {
    return outcome.end !== "done";
  }

  return !("value" in outcome) && !("text" in outcome);
};

/**
 * Compare one case's two outcomes softly and count it.
 *
 * @param id - The case id, carried into both sides of the comparison so a diff names it.
 * @param left - The `src` outcome.
 * @param right - The standard outcome.
 */
const compare = (id: string, left: Outcome, right: Outcome): void => {
  expect.soft([id, left]).toStrictEqual([id, right]);
  tally.compared += 1;
  tally.errors += isError(left) ? 1 : 0;
};

/**
 * Count one input against its parse-option variant.
 *
 * @param input - A typed or channel input.
 */
const countVariant = (input: ItemInput | ChannelInput): void => {
  const label =
    parseVariants.find(({ parseOptions }) => parseOptions === input.parseOptions)?.label ??
    "unknown";

  tally.variants.set(label, (tally.variants.get(label) ?? 0) + 1);
};

/**
 * Run the direct surface on one side: decode the text with that side's raw-tree codec, then decode
 * the tree with that side's root through `Schema.decodeUnknownExit`.
 *
 * @param side - The side whose codecs run.
 * @param roots - That side's raw-tree codec and root.
 * @param input - The typed input.
 * @returns The direct outcome, or the raw-tree failure when the text does not decode.
 */
const directOf = (
  side: Side,
  roots: { readonly item: Schema.Decoder<unknown>; readonly tree: Schema.Codec<unknown, string> },
  input: ItemInput,
) =>
  documentDecode(side, roots.tree, input.text).pipe(
    Effect.map((tree): DecodeOutcome | DirectOutcome =>
      "value" in tree
        ? directOutcome(Schema.decodeUnknownExit(roots.item)(tree.value, input.parseOptions))
        : tree,
    ),
  );

describe("QTI corpus differential", () => {
  it.effect("raw-tree decode, and encode of each decoded tree, agree with the standard path", () =>
    Effect.gen(function* rawTrees() {
      for (const input of treeInputs) {
        const left = yield* documentDecode(src, input.roots.src, input.text);
        const right = yield* documentDecode(standard, input.roots.standard, input.text);

        compare(`${input.id} decode`, left, right);
        countStructural(input.roots.src);

        if ("value" in left && "value" in right) {
          compare(
            `${input.id} encode`,
            yield* documentEncode(src, input.roots.src, left.value),
            yield* documentEncode(standard, input.roots.standard, right.value),
          );
        }
      }

      expect(treeInputs).toHaveLength(corpus.length);
    }),
  );

  it.effect("fromString(AssessmentItem) decode, and encode of each value, agree", () =>
    Effect.gen(function* typed() {
      let failures = 0;

      for (const input of itemInputs) {
        const srcCodec = SrcXml.fromString(input.roots.src.item);
        const standardCodec = SrcXml.fromString(input.roots.standard.item);
        const left = yield* documentDecode(src, srcCodec, input.text, input.parseOptions);

        const right = yield* documentDecode(
          standard,
          standardCodec,
          input.text,
          input.parseOptions,
        );

        compare(`${input.id} decode`, left, right);
        countVariant(input);
        countStructural(input.roots.src.item);
        failures += isError(left) ? 1 : 0;

        if ("value" in left && "value" in right) {
          compare(
            `${input.id} encode`,
            yield* documentEncode(src, srcCodec, left.value, input.parseOptions),
            yield* documentEncode(standard, standardCodec, right.value, input.parseOptions),
          );
        }
      }

      expect(itemInputs).toHaveLength(corpus.length * parseVariants.length);
      expect(failures).toBeGreaterThan(0);
    }),
  );

  it.effect("decodeUnknownExit(AssessmentItem) over each side's own raw tree agrees", () =>
    Effect.gen(function* direct() {
      for (const input of itemInputs) {
        compare(
          `${input.id} direct`,
          yield* directOf(src, input.roots.src, input),
          yield* directOf(standard, input.roots.standard, input),
        );
        countVariant(input);
      }
    }),
  );

  it.effect("decodeSchemaString and decodeSchema records and ends agree", () =>
    Effect.gen(function* channels() {
      for (const input of channelInputs) {
        const path = input.path ?? recordPath;
        const { options, parseOptions } = input;

        const textLeft = yield* channelDecode(
          SrcXml.decodeSchemaString(input.roots.src, path),
          Stream.fromIterable(textChunks(input)),
          options,
          parseOptions,
        );

        const textRight = yield* channelDecode(
          SrcXml.decodeSchemaString(input.roots.standard, path),
          Stream.fromIterable(textChunks(input)),
          options,
          parseOptions,
        );

        const bytesLeft = yield* channelDecode(
          SrcXml.decodeSchema(input.roots.src, path),
          Stream.fromIterable(byteChunks(input)),
          options,
          parseOptions,
        );

        const bytesRight = yield* channelDecode(
          SrcXml.decodeSchema(input.roots.standard, path),
          Stream.fromIterable(byteChunks(input)),
          options,
          parseOptions,
        );

        compare(`${input.id} decodeSchemaString`, textLeft, textRight);
        compare(`${input.id} decodeSchema`, bytesLeft, bytesRight);
        tally.records += textLeft.records.length + bytesLeft.records.length;
        countVariant(input);
        countStructural(input.roots.src);
      }
    }),
  );

  it("compared cases, errors, channel records, structural roots, and every variant", () => {
    expect(corpus.length).toBeGreaterThan(0);
    expect(tally.compared).toBeGreaterThan(0);
    expect(tally.errors).toBeGreaterThan(0);
    expect(tally.records).toBeGreaterThan(0);
    expect(tally.structural).toBeGreaterThan(0);

    for (const { label } of parseVariants) {
      expect([label, tally.variants.get(label) ?? 0]).not.toStrictEqual([label, 0]);
    }

    expect(Arr.sort(tally.variants.keys(), Order.String)).toStrictEqual(
      Arr.sort(
        parseVariants.map(({ label }) => label),
        Order.String,
      ),
    );
  });
});
