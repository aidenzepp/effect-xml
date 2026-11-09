/**
 * The saxes adapter: its events and stream cases count what saxes reports, and every capability
 * probe agrees with the exported profile.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { SaxesParser } from "saxes";
import type { SaxesOptions } from "saxes";

import { cases, libraries } from "../../bench/cases/saxes.ts";
import { chunk } from "../../bench/inputs/chunk.ts";
import { countElements } from "../../bench/inputs/reference.ts";
import type { BenchInput, PreparedCase } from "../../bench/types.ts";
import { defaultTokenizer } from "../../src/tokenizer.ts";

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
 * A chunk size small enough that the inline inputs split mid-tag, so the cases are exercised
 * across chunk boundaries.
 */
const smallChunk = 50;

/**
 * Build a one-document input whose reference element count comes from the upstream tokenizer.
 *
 * @param id - The input id the input poses as.
 * @param family - The input family.
 * @param text - The document text.
 * @param records - The record count of the document.
 * @returns The input, failing when the upstream tokenizer rejects `text`.
 */
const makeInput = Effect.fnUntraced(function* makeInput(
  id: string,
  family: BenchInput["family"],
  text: string,
  records: number,
) {
  const elements = yield* countElements(text);

  return {
    bytes: new TextEncoder().encode(text).length,
    documents: [{ chunks: chunk(text, smallChunk), name: id, text }],
    family,
    id,
    reference: { elements, records },
  } satisfies BenchInput;
});

/**
 * The inline two-record bank as an input.
 */
const bankInput = makeInput("bank-16k", "synthetic", twoRecordBank, 2);

/**
 * The `bg007-true-false.xml` corpus fixture, read by path, as an input.
 */
const corpusInput = Effect.sync(() =>
  readFileSync(new URL("../../spikes/fixtures/qti/bg007-true-false.xml", import.meta.url), "utf-8"),
).pipe(Effect.flatMap((text) => makeInput("corpus-items", "corpus", text, 0)));

/**
 * Prepare the case with the given id on an input.
 *
 * @param id - The case id.
 * @param input - The input to prepare on.
 * @returns The prepared case, failing when no case has `id` or preparation fails.
 */
const prepare = Effect.fnUntraced(function* prepare(id: string, input: BenchInput) {
  const benchCase = yield* Effect.fromOption(Arr.findFirst(cases, (each) => each.id === id));

  return yield* benchCase.prepare(input, defaultTokenizer);
});

/**
 * Run a prepared case once and count its output, recording how often it marks a first record.
 *
 * @param prepared - The prepared case.
 * @returns The observed count, the expected count, and the number of `mark` calls.
 */
const runOnce = (prepared: PreparedCase) => {
  let marks = 0;

  const observed = prepared.check(
    prepared.run(() => {
      marks += 1;
    }),
  );

  return { expected: prepared.expected, marks, observed };
};

/**
 * Parse a whole document with saxes and collect its text and element namespace URIs.
 *
 * @param options - The saxes options to parse with.
 * @param text - The document text.
 * @returns The concatenated text events and each element's namespace URI, failing when saxes
 *   reports an error.
 */
const parse = (options: SaxesOptions, text: string) =>
  Effect.try(() => {
    const parser = new SaxesParser<SaxesOptions>(options);
    const texts: string[] = [];
    const uris: string[] = [];

    parser.on("text", (value) => {
      texts.push(value);
    });
    parser.on("opentag", (tag) => {
      uris.push(tag.uri ?? "");
    });
    parser.write(text).close();

    return { text: texts.join(""), uris };
  });

describe("saxes/events", () => {
  it.effect("counts every start tag of a two-record bank fed in chunks", () =>
    Effect.gen(function* countsBank() {
      const result = runOnce(yield* prepare("saxes/events", yield* bankInput));

      expect(result.observed).toBe(result.expected);
    }),
  );

  it.effect("counts every start tag of a corpus fixture", () =>
    Effect.gen(function* countsCorpus() {
      const result = runOnce(yield* prepare("saxes/events", yield* corpusInput));

      expect(result.observed).toBe(result.expected);
    }),
  );

  it("accepts every input except the bad-last ones", () => {
    const events = cases.find((each) => each.id === "saxes/events");

    expect(events?.accepts({ family: "corpus", id: "corpus-all" })).toBe(true);
    expect(events?.accepts({ family: "synthetic", id: "bank-4m" })).toBe(true);
    expect(events?.accepts({ family: "synthetic", id: "bank-4m-bad-last" })).toBe(false);
  });
});

describe("saxes/stream", () => {
  it.effect("counts each record and marks the first one once", () =>
    Effect.gen(function* countsRecords() {
      const result = runOnce(yield* prepare("saxes/stream", yield* bankInput));

      expect(result.observed).toBe(result.expected);
      expect(result.marks).toBe(1);
    }),
  );

  it("accepts the four bank sizes only", () => {
    const stream = cases.find((each) => each.id === "saxes/stream");

    expect(stream?.accepts({ family: "synthetic", id: "bank-64m" })).toBe(true);
    expect(stream?.accepts({ family: "corpus", id: "corpus-items" })).toBe(false);
    expect(stream?.accepts({ family: "synthetic", id: "bank-256k-bad-last" })).toBe(false);
  });
});

describe("saxes profile", () => {
  it.effect("matches every probe run against saxes", () =>
    Effect.gen(function* probes() {
      const profile = libraries.find((each) => each.library === "saxes");
      const malformed = yield* Effect.exit(parse({}, "<a><b></a>"));
      const namespaced = yield* parse({ xmlns: true }, '<p:a xmlns:p="urn:x"/>');
      const entity = yield* parse({}, "<a>&amp;</a>");
      const doctype = yield* Effect.exit(parse({}, '<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>'));

      expect(profile?.rejectsMalformed).toBe(Exit.isFailure(malformed));
      expect(profile?.resolvesNamespaces).toBe(namespaced.uris[0] === "urn:x");
      expect(profile?.decodesEntities).toBe(entity.text === "&");
      expect(profile?.expandsDoctypeEntities).toBe(
        Exit.isSuccess(doctype) && doctype.value.text === "x",
      );
    }),
  );
});
