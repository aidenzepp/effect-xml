/**
 * The fast-xml-parser adapter: each case's count on a two-record bank and a corpus fixture, and
 * the exported profile against probes run on the library.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { XMLParser } from "fast-xml-parser";

import { cases, libraries } from "../../bench/cases/fast-xml-parser.ts";
import { chunk } from "../../bench/inputs/chunk.ts";
import { countElements } from "../../bench/inputs/reference.ts";
import type { BenchCase, BenchInput } from "../../bench/types.ts";
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
 * Build a one-document input with the given reference counts.
 *
 * @param id - The input id, which decides which cases accept it.
 * @param family - The input family.
 * @param text - The document text.
 * @param reference - The expected element and record counts.
 * @returns The input.
 */
const inputOf = (
  id: string,
  family: BenchInput["family"],
  text: string,
  reference: BenchInput["reference"],
): BenchInput => ({
  bytes: new TextEncoder().encode(text).length,
  documents: [{ chunks: chunk(text), name: `${id}.xml`, text }],
  family,
  id,
  reference,
});

/**
 * A two-record bank: the root plus six elements per record, and two records.
 */
const bank = inputOf(
  "bank-16k",
  "synthetic",
  `<?xml version="1.0" encoding="UTF-8"?>
<qti-item-bank xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">
${record(0)}${record(1)}</qti-item-bank>
`,
  { elements: 13, records: 2 },
);

/**
 * The text of the `bg007-true-false.xml` corpus fixture.
 */
const fixtureText = readFileSync(
  new URL("../../spikes/fixtures/qti/bg007-true-false.xml", import.meta.url),
  "utf-8",
);

/**
 * Find a registered case by id.
 *
 * @param id - The case id.
 * @returns The case.
 */
const caseOf = (id: string): BenchCase =>
  Option.getOrThrow(Arr.findFirst(cases, (benchCase) => benchCase.id === id));

/**
 * Prepare a case on an input and return the count `check` reads from one run.
 *
 * @param id - The case id.
 * @param input - The input to run on.
 * @returns The observed count and the expected count.
 */
const observe = (id: string, input: BenchInput) =>
  caseOf(id)
    .prepare(input, defaultTokenizer)
    .pipe(
      Effect.map((prepared) => ({
        expected: prepared.expected,
        observed: prepared.check(prepared.run(() => {})),
      })),
    );

/**
 * The parser the probes run, with the tree cases' options.
 */
const probeParser = new XMLParser({ ignoreAttributes: false, preserveOrder: true });

/**
 * The `preserveOrder` output of a one-element document `<a>` holding one text node.
 */
const TextDocument = Schema.Tuple([
  Schema.Struct({ a: Schema.Tuple([Schema.Struct({ "#text": Schema.String })]) }),
]);

/**
 * The `preserveOrder` output of a one-element document, read as its node's keys.
 */
const OneNode = Schema.Tuple([Schema.Record(Schema.String, Schema.Unknown)]);

/**
 * Read the text of a one-element document `<a>` as the probe parser yields it.
 *
 * @param xml - The document to parse.
 * @returns The element's text, or `undefined` when the output has another shape.
 */
const rootText = (xml: string): string | undefined =>
  Schema.decodeUnknownOption(TextDocument)(probeParser.parse(xml)).pipe(
    Option.map(([root]) => root.a[0]["#text"]),
    Option.getOrUndefined,
  );

/**
 * Read the keys of a one-element document's node as the probe parser yields it.
 *
 * @param xml - The document to parse.
 * @returns The node's keys: the tag name as reported, and `:@` when attributes are present.
 */
const nodeKeys = (xml: string): readonly string[] =>
  Schema.decodeUnknownOption(OneNode)(probeParser.parse(xml)).pipe(
    Option.map(([node]) => Object.keys(node)),
    Option.getOrElse((): readonly string[] => []),
  );

describe("fast-xml-parser adapter", () => {
  it("registers tree, encode-tree, and typed-decode", () => {
    expect(cases.map((benchCase) => benchCase.id)).toEqual([
      "fast-xml-parser/tree",
      "fast-xml-parser/encode-tree",
      "fast-xml-parser/typed-decode",
    ]);
  });

  it("accepts the row's inputs and never a bad-last input", () => {
    const tree = caseOf("fast-xml-parser/tree");
    const typed = caseOf("fast-xml-parser/typed-decode");

    expect(tree.accepts({ family: "corpus", id: "corpus-all" })).toBe(true);
    expect(tree.accepts({ family: "synthetic", id: "bank-4m-bad-last" })).toBe(false);
    expect(typed.accepts({ family: "synthetic", id: "bank-64m" })).toBe(true);
    expect(typed.accepts({ family: "corpus", id: "corpus-items" })).toBe(false);
    expect(typed.accepts({ family: "synthetic", id: "bank-256k-bad-last" })).toBe(false);
  });

  it.effect("counts the bank's elements and records", () =>
    Effect.gen(function* countsBank() {
      for (const id of [
        "fast-xml-parser/tree",
        "fast-xml-parser/encode-tree",
        "fast-xml-parser/typed-decode",
      ]) {
        const { expected, observed } = yield* observe(id, bank);

        expect({ id, observed }).toEqual({ id, observed: expected });
      }
    }),
  );

  it.effect("counts the corpus fixture's elements", () =>
    Effect.gen(function* countsFixture() {
      const elements = yield* countElements(fixtureText);
      const fixture = inputOf("corpus-items", "corpus", fixtureText, { elements, records: 1 });

      for (const id of ["fast-xml-parser/tree", "fast-xml-parser/encode-tree"]) {
        const { expected, observed } = yield* observe(id, fixture);

        expect({ id, observed }).toEqual({ id, observed: expected });
      }
    }),
  );

  it.effect("exports the profile the probes measure", () =>
    Effect.gen(function* matchesProbes() {
      const malformed = yield* Effect.exit(
        Effect.try(() => {
          probeParser.parse("<a><b></a>");
        }),
      );

      const tagKeys = nodeKeys('<p:a xmlns:p="urn:x"/>').filter((key) => key !== ":@");

      expect(libraries.length).toBe(1);
      expect(libraries[0]).toMatchObject({
        decodesEntities: rootText("<a>&amp;</a>") === "&",
        expandsDoctypeEntities: rootText('<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>') === "x",
        library: "fast-xml-parser",
        rejectsMalformed: Exit.isFailure(malformed),
        reportsPositions: false,
        resolvesNamespaces: tagKeys.some((key) => key.includes("urn:x")),
        streams: false,
        typed: false,
      });
    }),
  );
});
