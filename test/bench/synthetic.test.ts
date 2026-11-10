/**
 * The synthetic item-bank inputs: target sizes, reference counts, the bad-last error path, and
 * deterministic generation.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Array from "effect/Array";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { countElements } from "../../bench/inputs/reference.ts";
import { loadInput } from "../../bench/inputs/synthetic.ts";
import { ItemBank } from "../../bench/vocabulary.ts";
import { XmlSchema } from "../../src/index.ts";

/**
 * The smallest bank's target size in UTF-8 bytes.
 */
const target16k = 16_384;

/**
 * Measure the UTF-8 byte length of one item-bank record in the synthetic bank's template.
 *
 * @param i - The record index.
 * @returns The record's length in UTF-8 bytes.
 */
const recordBytes = (i: number): number =>
  new TextEncoder()
    .encode(`  <qti-assessment-item-ref identifier="item-${i}" href="items/item-${i}.xml" category="section-${i % 8}" required="true" fixed="false">
    <qti-weight identifier="W${i % 4}" value="${(i % 10) / 2 + 0.5}"/>
    <qti-branch-rule target="item-${i + 1}">
      <qti-match>
        <qti-variable identifier="SCORE-${i}"/>
        <qti-correct identifier="RESPONSE-${i}"/>
      </qti-match>
    </qti-branch-rule>
  </qti-assessment-item-ref>
`).length;

/**
 * Load a synthetic input and its single document's text.
 *
 * @param id - The input id to load.
 * @returns The loaded input and the text of its one document, failing when the id is not
 *   provided or the input holds no document.
 */
const loadText = Effect.fnUntraced(function* loadText(id: string) {
  const input = yield* Effect.fromOption(yield* loadInput(id));
  const document = yield* Effect.fromOption(Array.head(input.documents));

  return { input, text: document.text };
});

/**
 * Decode an item bank from its text.
 */
const decodeBank = Schema.decodeUnknownEffect(XmlSchema.fromString(ItemBank));

describe("synthetic item bank", () => {
  it.effect("generates bank-16k at its target size, within one record", () =>
    Effect.gen(function* sizesBank() {
      const { input } = yield* loadText("bank-16k");

      expect(input.family).toBe("synthetic");
      expect(input.documents.length).toBe(1);
      expect(input.bytes).toBeGreaterThanOrEqual(target16k);
      expect(input.bytes).toBeLessThan(target16k + recordBytes(input.reference.records - 1));
    }),
  );

  it.effect("counts one root plus six elements per record", () =>
    Effect.gen(function* countsBank() {
      const { input, text } = yield* loadText("bank-16k");

      expect(input.reference.elements).toBe(1 + 6 * input.reference.records);
      expect(yield* countElements(text)).toBe(input.reference.elements);
    }),
  );

  it.effect("decodes one ref per record", () =>
    Effect.gen(function* decodesBank() {
      const { input, text } = yield* loadText("bank-16k");
      const bank = yield* decodeBank(text);

      expect(bank.refs.length).toBe(input.reference.records);
    }),
  );

  it.effect("fails the decode of bank-256k-bad-last with a schema failure", () =>
    Effect.gen(function* failsBadLast() {
      const { text } = yield* loadText("bank-256k-bad-last");
      const failure = yield* Effect.flip(decodeBank(text));
      const error = yield* Effect.fromOption(XmlSchema.findDecodeErrorOption(failure.issue));

      expect(error.reason._tag).toBe("SchemaFailure");
    }),
  );

  it.effect("generates the same text on every load", () =>
    Effect.gen(function* loadsDeterministically() {
      const first = yield* loadText("bank-16k");
      const second = yield* loadText("bank-16k");

      expect(second.text).toBe(first.text);
    }),
  );
});
