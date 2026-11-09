/**
 * The txml adapter: each case's check of its own output equals the input's reference count, and
 * every probe of the shared contract, run against txml here, equals the exported profile.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Predicate from "effect/Predicate";
import { isElementNode, parse, toContentString, transformStream } from "txml";

import { chunk } from "../../bench/inputs/chunk.ts";
import { countElements } from "../../bench/inputs/reference.ts";
import { cases, libraries } from "../../bench/cases/txml.ts";
import type { BenchInput } from "../../bench/types.ts";
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
 * Build a one-document input whose element count comes from the upstream tokenizer.
 *
 * @param id - The input id.
 * @param text - The document text.
 * @param records - The record count the input claims.
 * @returns The input, ready for a case's `prepare`.
 */
const inputOf = (id: string, text: string, records: number): Effect.Effect<BenchInput, unknown> =>
  countElements(text).pipe(
    Effect.map((elements) => ({
      bytes: Buffer.byteLength(text),
      documents: [{ chunks: chunk(text), name: id, text }],
      family: "synthetic" as const,
      id,
      reference: { elements, records },
    })),
  );

/**
 * Read the true-false corpus fixture by path.
 */
const trueFalse = Effect.sync(() =>
  readFileSync(new URL("../../spikes/fixtures/qti/bg007-true-false.xml", import.meta.url), "utf-8"),
);

/**
 * Read the text content of the first top-level element txml returns for a document.
 *
 * @param xml - The document to parse with default options.
 * @returns The element's text content, or `undefined` when there is no element.
 */
const elementText = (xml: string): string | undefined => {
  const element = parse(xml).find(isElementNode);

  return element === undefined ? undefined : toContentString(element);
};

describe("txml cases", () => {
  it("registers the tree and encode-tree cases", () => {
    expect(cases.map((benchCase) => benchCase.id)).toStrictEqual(["txml/tree", "txml/encode-tree"]);
  });

  it("refuses the error-path inputs", () => {
    for (const benchCase of cases) {
      expect(benchCase.accepts({ family: "synthetic", id: "bank-256k-bad-last" })).toBe(false);
      expect(benchCase.accepts({ family: "corpus", id: "corpus-all" })).toBe(true);
    }
  });

  it.effect("counts the reference elements of a two-record bank", () =>
    Effect.gen(function* countsBank() {
      const input = yield* inputOf("bank-inline", twoRecordBank, 2);

      expect(input.reference.elements).toBe(13);

      for (const benchCase of cases) {
        const prepared = yield* benchCase.prepare(input, defaultTokenizer);

        expect(prepared.expected).toBe(input.reference.elements);
        expect(prepared.check(prepared.run(() => {}))).toBe(prepared.expected);
      }
    }),
  );

  it.effect("counts the reference elements of the true-false fixture", () =>
    Effect.gen(function* countsFixture() {
      const input = yield* inputOf("bg007", yield* trueFalse, 0);

      for (const benchCase of cases) {
        const prepared = yield* benchCase.prepare(input, defaultTokenizer);

        expect(prepared.check(prepared.run(() => {}))).toBe(input.reference.elements);
      }
    }),
  );
});

describe("txml profile", () => {
  it.effect("matches the probes of the shared contract", () =>
    Effect.gen(function* probes() {
      const malformed = yield* Effect.exit(Effect.try(() => parse("<a><b></a>")));
      const namespaced = parse('<p:a xmlns:p="urn:x"/>').find(isElementNode);

      const doctype = yield* Effect.exit(
        Effect.try(() => elementText('<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>')),
      );

      expect(libraries).toStrictEqual([
        {
          decodesEntities: elementText("<a>&amp;</a>") === "&",
          expandsDoctypeEntities: Exit.isSuccess(doctype) && doctype.value === "x",
          library: "txml",
          notes: libraries[0]?.notes,
          rejectsMalformed: Exit.isFailure(malformed),
          reportsPositions: false,
          resolvesNamespaces:
            namespaced !== undefined &&
            Object.entries(namespaced).some(
              ([key, value]) => key !== "attributes" && value === "urn:x",
            ),
          streams: Predicate.isFunction(transformStream),
          typed: false,
        },
      ]);
    }),
  );
});
