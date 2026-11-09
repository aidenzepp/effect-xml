/**
 * The @rgrove/parse-xml adapter: the tree case counts the reference elements on a bank and a
 * corpus fixture, and every capability flag of its profile matches a probe run here.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import { parseXml } from "@rgrove/parse-xml";
import * as Effect from "effect/Effect";

import { cases, libraries } from "../../bench/cases/parse-xml.ts";
import { countElements } from "../../bench/inputs/reference.ts";
import type { BenchCase, BenchInput } from "../../bench/types.ts";
import { defaultTokenizer } from "../../src/tokenizer.ts";

/**
 * The fixture file the corpus check reads, by path because `test/` never imports from `spikes/`.
 */
const fixtureUrl = new URL("../../spikes/fixtures/qti/bg007-true-false.xml", import.meta.url);

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
 * Build a one-document input whose element count is read from the upstream tokenizer.
 *
 * @param id - The input id.
 * @param text - The document's text.
 * @returns The input, with `reference.elements` from `countElements`.
 */
const inputOf = Effect.fnUntraced(function* inputOf(id: string, text: string) {
  const elements = yield* countElements(text);

  const input: BenchInput = {
    bytes: Buffer.byteLength(text),
    documents: [{ chunks: [text], name: id, text }],
    family: id.startsWith("bank") ? "synthetic" : "corpus",
    id,
    reference: { elements, records: 1 },
  };

  return input;
});

/**
 * Prepare a case on an input and return what its `check` counts in one run's output.
 *
 * @param benchCase - The case to run.
 * @param input - The input to prepare it on.
 * @returns The observed count and the count the case expects.
 */
const observe = Effect.fnUntraced(function* observe(benchCase: BenchCase, input: BenchInput) {
  const prepared = yield* benchCase.prepare(input, defaultTokenizer);

  return { expected: prepared.expected, observed: prepared.check(prepared.run(() => {})) };
});

/**
 * Parse text with parse-xml, failing in the error channel when the parser throws.
 *
 * @param text - The XML text to parse.
 * @returns The parsed document.
 */
const parse = (text: string) => Effect.try(() => parseXml(text));

/**
 * Read the root element's text, or `undefined` when the document has no root.
 *
 * @param text - The XML text to parse.
 * @returns The root's text content.
 */
const rootText = (text: string) => parse(text).pipe(Effect.map((document) => document.root?.text));

describe("parse-xml adapter", () => {
  it("registers one tree case and no encode case", () => {
    expect(cases.map((benchCase) => [benchCase.id, benchCase.class])).toStrictEqual([
      ["parse-xml/tree", "tree"],
    ]);
  });

  it("accepts every input except the bad-last banks", () => {
    const [treeCase] = cases;

    expect(treeCase?.accepts({ family: "corpus", id: "corpus-all" })).toBe(true);
    expect(treeCase?.accepts({ family: "synthetic", id: "bank-64m" })).toBe(true);
    expect(treeCase?.accepts({ family: "synthetic", id: "bank-4m-bad-last" })).toBe(false);
  });

  it.effect("counts the reference elements of a two-record bank", () =>
    Effect.gen(function* countsBank() {
      const input = yield* inputOf("bank-inline", twoRecordBank);

      for (const benchCase of cases) {
        const { expected, observed } = yield* observe(benchCase, input);

        expect(expected).toBe(13);
        expect(observed).toBe(expected);
      }
    }),
  );

  it.effect("counts the reference elements of bg007-true-false.xml", () =>
    Effect.gen(function* countsFixture() {
      const text = yield* Effect.sync(() => readFileSync(fixtureUrl, "utf-8"));
      const input = yield* inputOf("corpus-bg007", text);

      for (const benchCase of cases) {
        const { expected, observed } = yield* observe(benchCase, input);

        expect(observed).toBe(expected);
      }
    }),
  );

  it.effect("matches every probe in the exported profile", () =>
    Effect.gen(function* matchesProbes() {
      const rejectsMalformed = yield* Effect.isFailure(parse("<a><b></a>"));

      const resolvesNamespaces = yield* parse('<p:a xmlns:p="urn:x"/>').pipe(
        Effect.map((document) =>
          Object.entries(document.root ?? {}).some(
            ([key, value]) => key !== "attributes" && value === "urn:x",
          ),
        ),
      );

      const decodesEntities = (yield* rootText("<a>&amp;</a>")) === "&";

      const expandsDoctypeEntities = yield* rootText(
        '<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>',
      ).pipe(
        Effect.map((text) => text === "x"),
        Effect.orElseSucceed(() => false),
      );

      expect(libraries).toHaveLength(1);
      expect(libraries[0]).toMatchObject({
        decodesEntities,
        expandsDoctypeEntities,
        library: "@rgrove/parse-xml",
        rejectsMalformed,
        reportsPositions: true,
        resolvesNamespaces,
        streams: false,
        typed: false,
      });
    }),
  );
});
