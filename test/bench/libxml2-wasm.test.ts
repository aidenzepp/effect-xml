/**
 * The libxml2-wasm cases and profile: each case's checked count on an inline two-record bank and on
 * a corpus fixture, and every probed capability flag against the exported profile.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import { XmlDocument, XmlParseError } from "libxml2-wasm";
import type { XmlElement } from "libxml2-wasm";

import { cases, libraries } from "../../bench/cases/libxml2-wasm.ts";
import { countElements } from "../../bench/inputs/reference.ts";
import { tokenizers } from "../../bench/tokenizers.ts";
import type { BenchInput } from "../../bench/types.ts";

/**
 * Render record `i` of the synthetic item bank, as the `perf1-7` template writes it.
 *
 * @param i - The record index.
 * @returns The record's XML text: an item ref holding five elements.
 */
const record = (
  i: number,
): string => `  <qti-assessment-item-ref identifier="item-${i}" href="items/item-${i}.xml" category="section-${i % 8}" required="true" fixed="false">
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
 * A two-record bank as a `bank-16k` input: the root plus six elements per record.
 */
const bankText = `<?xml version="1.0" encoding="UTF-8"?>
<qti-item-bank xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">
${record(0)}${record(1)}</qti-item-bank>
`;

/**
 * The two-record bank input.
 */
const bank: BenchInput = {
  bytes: bankText.length,
  documents: [{ chunks: [bankText], name: "bank.xml", text: bankText }],
  family: "synthetic",
  id: "bank-16k",
  reference: { elements: 13, records: 2 },
};

/**
 * Load `bg007-true-false.xml` from the corpus as a one-document `corpus-items` input, its element
 * count read from the upstream tokenizer.
 */
const fixture: Effect.Effect<BenchInput, unknown> = Effect.gen(function* fixtureBody() {
  const text = yield* Effect.sync(() =>
    readFileSync(
      new URL("../../spikes/fixtures/qti/bg007-true-false.xml", import.meta.url),
      "utf-8",
    ),
  );

  const elements = yield* countElements(text);

  return {
    bytes: text.length,
    documents: [{ chunks: [text], name: "bg007-true-false.xml", text }],
    family: "corpus",
    id: "corpus-items",
    reference: { elements, records: 1 },
  };
});

/**
 * Prepare a registered case on an input, run it once, and check its output.
 *
 * @param id - The case id; the effect fails when no case has it.
 * @param input - The input to prepare the case on.
 * @returns The case's checked count and its expected count.
 */
const runOnce = Effect.fnUntraced(function* runOnceBody(id: string, input: BenchInput) {
  const benchCase = yield* Effect.fromOption(
    Arr.findFirst(cases, (candidate) => candidate.id === id),
  );

  const prepared = yield* benchCase.prepare(input, tokenizers.upstream);

  return { count: prepared.check(prepared.run(() => {})), expected: prepared.expected };
});

/**
 * Parse XML text with the library's defaults and read one fact from the root element.
 *
 * @param source - The XML text to parse.
 * @param read - The fact to read from the root element.
 * @returns The fact, or `false` when the text does not parse.
 */
const probe = (source: string, read: (root: XmlElement) => boolean): Effect.Effect<boolean> =>
  Effect.try({
    catch: (cause) => cause,
    try: () => {
      const document = XmlDocument.fromString(source);
      const fact = read(document.root);

      document.dispose();

      return fact;
    },
  }).pipe(Effect.orElseSucceed(() => false));

/**
 * The failure the library raises on malformed text, or `undefined` when it parses.
 */
const malformed: Effect.Effect<unknown> = Effect.try({
  catch: (cause) => cause,
  try: () => {
    XmlDocument.fromString("<a><b></a>").dispose();
  },
}).pipe(
  Effect.flip,
  Effect.orElseSucceed(() => {}),
);

describe("libxml2-wasm cases", () => {
  it("registers tree and encode-tree on every input but the bad-last banks", () => {
    expect(cases.map((benchCase) => [benchCase.id, benchCase.class])).toStrictEqual([
      ["libxml2-wasm/tree", "tree"],
      ["libxml2-wasm/encode-tree", "encode-tree"],
    ]);

    for (const benchCase of cases) {
      expect(benchCase.library).toBe("libxml2-wasm");
      expect(benchCase.accepts({ family: "corpus", id: "corpus-all" })).toBe(true);
      expect(benchCase.accepts({ family: "synthetic", id: "bank-64m" })).toBe(true);
      expect(benchCase.accepts({ family: "synthetic", id: "bank-4m-bad-last" })).toBe(false);
    }
  });

  it.effect("counts every element of the two-record bank", () =>
    Effect.gen(function* treeBankBody() {
      for (const id of ["libxml2-wasm/tree", "libxml2-wasm/encode-tree"]) {
        const { count, expected } = yield* runOnce(id, bank);

        expect(expected).toBe(13);
        expect(count).toBe(expected);
      }
    }),
  );

  it.effect("counts every element of bg007-true-false.xml", () =>
    Effect.gen(function* treeFixtureBody() {
      const input = yield* fixture;

      for (const id of ["libxml2-wasm/tree", "libxml2-wasm/encode-tree"]) {
        const { count, expected } = yield* runOnce(id, input);

        expect(count).toBe(expected);
      }
    }),
  );

  it.effect("disposes the previous run's documents before the next tree run", () =>
    Effect.gen(function* disposeBody() {
      const benchCase = yield* Effect.fromOption(
        Arr.findFirst(cases, (candidate) => candidate.id === "libxml2-wasm/tree"),
      );

      const prepared = yield* benchCase.prepare(bank, tokenizers.upstream);
      const first = prepared.run(() => {});
      const second = prepared.run(() => {});

      expect(prepared.check(second)).toBe(13);
      expect(first).not.toBe(second);
    }),
  );
});

describe("libxml2-wasm profile", () => {
  it.effect("equals what the probes measure", () =>
    Effect.gen(function* profileBody() {
      const failure = yield* malformed;

      expect(libraries).toStrictEqual([
        expect.objectContaining({
          decodesEntities: yield* probe("<a>&amp;</a>", (root) => root.content === "&"),
          expandsDoctypeEntities: yield* probe(
            '<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>',
            (root) => root.content === "x",
          ),
          library: "libxml2-wasm",
          rejectsMalformed: failure !== undefined,
          reportsPositions: failure instanceof XmlParseError && (failure.details[0]?.line ?? 0) > 0,
          resolvesNamespaces: yield* probe(
            '<p:a xmlns:p="urn:x"/>',
            (root) => root.namespaceUri === "urn:x",
          ),
          streams: false,
          typed: false,
        }),
      ]);
    }),
  );
});
