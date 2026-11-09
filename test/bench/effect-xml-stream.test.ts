/**
 * The effect-xml stream cases: record counts, the first-record mark, and the tokenizer each case
 * reads, on a three-record bank fed as two chunks.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";

import { cases } from "../../bench/cases/effect-xml-stream.ts";
import type { BenchInput } from "../../bench/types.ts";
import type { Tokenizer } from "../../src/tokenizer.ts";
import { spyTokenizer } from "../tokenizer/fakes.ts";

/**
 * One item-bank record with no children.
 *
 * @param i - The record index.
 * @returns The record's XML text.
 */
const record = (i: number): string =>
  `<qti-assessment-item-ref identifier="item-${i}" href="items/item-${i}.xml"/>`;

/**
 * A three-record bank whose text splits inside the second record.
 */
const text = `<qti-item-bank xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">${record(0)}${record(1)}${record(2)}</qti-item-bank>`;

/**
 * The offset the bank's text is split at, inside the second record's start tag.
 */
const split = text.indexOf("item-1") + 2;

/**
 * The bank as a `bank-16k` input of one document in two chunks.
 */
const input: BenchInput = {
  bytes: text.length,
  documents: [{ chunks: [text.slice(0, split), text.slice(split)], name: "bank.xml", text }],
  family: "synthetic",
  id: "bank-16k",
  reference: { elements: 4, records: 3 },
};

/**
 * Prepare a registered stream case on the bank, run it once, and count how often it called `mark`.
 *
 * @param id - The case id; the effect fails when no case has it.
 * @param tokenizer - The tokenizer the case is prepared with.
 * @returns The case's checked count, its expected count, and the number of `mark` calls.
 */
const runOnce = Effect.fnUntraced(function* runOnceBody(id: string, tokenizer: Tokenizer) {
  const benchCase = yield* Effect.fromOption(
    Arr.findFirst(cases, (candidate) => candidate.id === id),
  );

  const prepared = yield* benchCase.prepare(input, tokenizer);

  let marks = 0;

  const output = prepared.run(() => {
    marks += 1;
  });

  return { count: prepared.check(output), expected: prepared.expected, marks };
});

describe("effect-xml stream cases", () => {
  it("registers the plain and positioned stream cases for the four bank sizes", () => {
    expect(cases.map((benchCase) => benchCase.id)).toStrictEqual([
      "effect-xml/stream",
      "effect-xml/stream/positions",
    ]);

    for (const benchCase of cases) {
      expect(benchCase.class).toBe("stream");
      expect(benchCase.accepts({ family: "synthetic", id: "bank-64m" })).toBe(true);
      expect(benchCase.accepts({ family: "synthetic", id: "bank-4m-bad-last" })).toBe(false);
      expect(benchCase.accepts({ family: "corpus", id: "corpus-items" })).toBe(false);
    }
  });

  it.effect("counts three records and marks the first once, without positions", () =>
    Effect.gen(function* plainCase() {
      const spy = spyTokenizer();
      const result = yield* runOnce("effect-xml/stream", spy.tokenizer);

      expect(result).toStrictEqual({ count: 3, expected: 3, marks: 1 });
      expect(spy.calls.map((call) => call.factory)).toContain("decodeString");
    }),
  );

  it.effect("counts three records and marks the first once, with positions", () =>
    Effect.gen(function* positionedCase() {
      const result = yield* runOnce("effect-xml/stream/positions", spyTokenizer().tokenizer);

      expect(result).toStrictEqual({ count: 3, expected: 3, marks: 1 });
    }),
  );
});
