/**
 * The effect-xml typed cases: `typed-decode` and `encode-typed` count the records of an inline
 * bank and of one corpus item, read the tokenizer `prepare` receives, and accept only the
 * well-formed typed inputs.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { cases } from "../../bench/cases/effect-xml-typed.ts";
import { chunk } from "../../bench/inputs/chunk.ts";
import { countElements } from "../../bench/inputs/reference.ts";
import type { BenchCase, BenchInput } from "../../bench/types.ts";
import { defaultTokenizer } from "../../src/tokenizer.ts";
import { spyTokenizer } from "../tokenizer/fakes.ts";

/**
 * The ids of the cases under test.
 */
const caseIds = ["effect-xml/typed-decode", "effect-xml/encode-typed"] as const;

/**
 * Look up a case of the module by id.
 *
 * @param id - The case id.
 * @returns The registered case; the lookup throws, failing the test, when the module lacks it.
 */
const caseOf = (id: string): BenchCase =>
  Option.getOrThrow(Arr.findFirst(cases, (benchCase) => benchCase.id === id));

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

/**
 * The text of the corpus item `bg007-true-false.xml`, read by path.
 */
const trueFalseItem = readFileSync(
  new URL("../../spikes/fixtures/qti/bg007-true-false.xml", import.meta.url),
  "utf-8",
);

/**
 * Build a one-document input with its element reference read from the upstream tokenizer.
 *
 * @param id - The input id, which decides the vocabulary the cases decode with.
 * @param family - The input family.
 * @param text - The document text.
 * @param records - The records the document holds.
 * @returns The input.
 */
const inputOf = (
  id: string,
  family: BenchInput["family"],
  text: string,
  records: number,
): Effect.Effect<BenchInput> =>
  countElements(text).pipe(
    Effect.orDie,
    Effect.map((elements) => ({
      bytes: Buffer.byteLength(text),
      documents: [{ chunks: chunk(text), name: `${id}.xml`, text }],
      family,
      id,
      reference: { elements, records },
    })),
  );

/**
 * The two inputs every case runs on: an inline two-record bank and one corpus item.
 */
const inputs = Effect.all([
  inputOf("bank-16k", "synthetic", twoRecordBank, 2),
  inputOf("corpus-items", "corpus", trueFalseItem, 1),
]);

/**
 * A `mark` callback for runs whose class never marks a first record.
 */
const noMark = (): void => {};

describe("effect-xml typed cases", () => {
  for (const id of caseIds) {
    it.effect(`${id} counts the records of a bank and of a corpus item`, () =>
      Effect.gen(function* counts() {
        for (const input of yield* inputs) {
          const prepared = yield* caseOf(id).prepare(input, defaultTokenizer);

          expect({ input: input.id, observed: prepared.check(prepared.run(noMark)) }).toEqual({
            input: input.id,
            observed: input.reference.records,
          });
          expect(prepared.expected).toBe(input.reference.records);
        }
      }),
    );

    it.effect(`${id} runs through the tokenizer prepare receives`, () =>
      Effect.gen(function* readsTokenizer() {
        for (const input of yield* inputs) {
          const spy = spyTokenizer();
          const prepared = yield* caseOf(id).prepare(input, spy.tokenizer);
          const before = spy.calls.length;

          prepared.run(noMark);

          expect({ input: input.id, ran: spy.calls.length > before }).toEqual({
            input: input.id,
            ran: true,
          });
        }
      }),
    );

    it(`${id} accepts the item corpus and the well-formed banks only`, () => {
      const benchCase = caseOf(id);

      expect({
        "bank-4m": benchCase.accepts({ family: "synthetic", id: "bank-4m" }),
        "bank-4m-bad-last": benchCase.accepts({ family: "synthetic", id: "bank-4m-bad-last" }),
        "corpus-all": benchCase.accepts({ family: "corpus", id: "corpus-all" }),
        "corpus-items": benchCase.accepts({ family: "corpus", id: "corpus-items" }),
      }).toEqual({
        "bank-4m": true,
        "bank-4m-bad-last": false,
        "corpus-all": false,
        "corpus-items": true,
      });
    });
  }
});
