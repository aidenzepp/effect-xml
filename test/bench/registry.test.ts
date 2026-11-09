/**
 * The benchmark skeleton: the registry's ids and classes, the tokenizer table, chunking, the
 * reference counts, and the item-bank vocabulary.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { countElements, countTreeElements } from "../../bench/inputs/reference.ts";
import { chunk } from "../../bench/inputs/chunk.ts";
import { cases, inputIds } from "../../bench/registry.ts";
import { tokenizers } from "../../bench/tokenizers.ts";
import { ItemBank } from "../../bench/vocabulary.ts";
import { XmlSchema } from "../../src/index.ts";
import { defaultTokenizer } from "../../src/tokenizer.ts";

/**
 * The six comparison classes a case may declare.
 */
const classes = ["events", "tree", "typed-decode", "encode-tree", "encode-typed", "stream"];

/**
 * A small document with three elements and one text node.
 */
const threeElements = "<a><b/><c>t</c></a>";

/**
 * One item-bank record in the synthetic bank's template.
 *
 * @param i - The record index.
 * @returns The record's XML text.
 */
const record = (
  i: number,
) => `  <qti-assessment-item-ref identifier="item-${i}" href="items/item-${i}.xml" category="section-${i % 8}" required="true" fixed="false">
    <qti-weight identifier="W${i % 4}" value="${(i % 10) / 2 + 0.5}"/>
    <qti-branch-rule target="item-${i + 1}">
      <qti-match>
        <qti-variable identifier="SCORE-${i}"/>
        <qti-correct identifier="RESPONSE-${i}"/>
      </qti-match>
    </qti-branch-rule>
  </qti-assessment-item-ref>
`;

/**
 * An item bank of two records.
 */
const twoRecordBank = `<?xml version="1.0" encoding="UTF-8"?>
<qti-item-bank xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">
${record(0)}${record(1)}</qti-item-bank>
`;

describe("registry", () => {
  it("registers each case id once", () => {
    const ids = cases.map((benchCase) => benchCase.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every case one of the six classes", () => {
    for (const benchCase of cases) {
      expect(classes).toContain(benchCase.class);
    }
  });

  it("owns exactly the fixed input ids", () => {
    expect(inputIds).toStrictEqual([
      "corpus-all",
      "corpus-items",
      "bank-16k",
      "bank-256k",
      "bank-4m",
      "bank-64m",
      "bank-256k-bad-last",
      "bank-4m-bad-last",
    ]);
  });
});

describe("tokenizers", () => {
  it("maps upstream to the default tokenizer", () => {
    expect(tokenizers.upstream).toBe(defaultTokenizer);
  });
});

describe("chunk", () => {
  it("splits 150,000 characters into three slices that join back", () => {
    const text = "x".repeat(150_000);
    const slices = chunk(text);

    expect(slices.length).toBe(3);
    expect(slices.join("")).toBe(text);
  });

  it("joins back when a surrogate pair straddles a boundary", () => {
    const text = `${"x".repeat(3)}\u{1F600}${"y".repeat(3)}`;
    const slices = chunk(text, 4);

    expect(slices[0]?.endsWith("\uD83D")).toBe(true);
    expect(slices.join("")).toBe(text);
  });
});

describe("reference counts", () => {
  it.effect("counts the start elements the upstream tokenizer yields", () =>
    Effect.gen(function* countsStartElements() {
      expect(yield* countElements(threeElements)).toBe(3);
    }),
  );

  it.effect("counts the elements of a resolved tree", () =>
    Effect.gen(function* countsTreeElements() {
      const tree = yield* Schema.decodeUnknownEffect(XmlSchema.ElementFromString({}))(
        threeElements,
      );

      expect(countTreeElements(tree)).toBe(3);
    }),
  );
});

describe("vocabulary", () => {
  it.effect("decodes a two-record item bank", () =>
    Effect.gen(function* decodesBank() {
      const bank = yield* Schema.decodeUnknownEffect(XmlSchema.fromString(ItemBank))(twoRecordBank);

      expect(bank.refs.length).toBe(2);
    }),
  );
});
