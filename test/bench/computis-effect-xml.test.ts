/**
 * The @computis/effect-xml cases: record counts on a two-record bank, the inputs each case
 * accepts, and the capability profile checked against probes run on the library.
 */
import { codec, root } from "@computis/effect-xml";
import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { cases, libraries } from "../../bench/cases/computis-effect-xml.ts";
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
 * An item bank of two records with QTI as the default namespace.
 */
const text = `<?xml version="1.0" encoding="UTF-8"?>
<qti-item-bank xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0">
${record(0)}${record(1)}</qti-item-bank>
`;

/**
 * The two-record bank as a `bank-16k` input of one document.
 */
const input: BenchInput = {
  bytes: text.length,
  documents: [{ chunks: [text], name: "bank.xml", text }],
  family: "synthetic",
  id: "bank-16k",
  reference: { elements: 13, records: 2 },
};

/**
 * Prepare a registered case on the bank and run it once.
 *
 * @param id - The case id; the effect fails when no case has it.
 * @returns The case's checked count and its expected count.
 */
const runOnce = Effect.fnUntraced(function* runOnce(id: string) {
  const benchCase = yield* Effect.fromOption(
    Arr.findFirst(cases, (candidate) => candidate.id === id),
  );

  const prepared = yield* benchCase.prepare(input, defaultTokenizer);

  return { count: prepared.check(prepared.run(() => {})), expected: prepared.expected };
});

/**
 * A root `r` holding one text leaf `a`, for the entity probes; the library's root must be a
 * Struct, so the probe text sits one level down.
 */
const Leaf = Schema.Struct({ a: Schema.String }).pipe(root("r"));

/**
 * Decode `xml` with a codec compiled from `schema`.
 *
 * @param schema - The root Schema the probe decodes against.
 * @param xml - The probe document.
 * @returns The decoded value, failing with the library's plan, parse, or decode error.
 */
const decodeWith = <S extends Parameters<typeof codec>[0]>(schema: S, xml: string) =>
  Effect.fromResult(codec(schema)).pipe(Effect.flatMap(({ decode }) => decode(xml)));

describe("@computis/effect-xml cases", () => {
  it("registers typed-decode and encode-typed for the four bank sizes", () => {
    expect(cases.map((benchCase) => [benchCase.id, benchCase.class])).toStrictEqual([
      ["computis-effect-xml/typed-decode", "typed-decode"],
      ["computis-effect-xml/encode-typed", "encode-typed"],
    ]);

    for (const benchCase of cases) {
      expect(benchCase.library).toBe("@computis/effect-xml");
      expect(benchCase.accepts({ family: "synthetic", id: "bank-16k" })).toBe(true);
      expect(benchCase.accepts({ family: "synthetic", id: "bank-64m" })).toBe(true);
      expect(benchCase.accepts({ family: "synthetic", id: "bank-4m-bad-last" })).toBe(false);
      expect(benchCase.accepts({ family: "corpus", id: "corpus-items" })).toBe(false);
      expect(benchCase.accepts({ family: "corpus", id: "corpus-all" })).toBe(false);
    }
  });

  it.effect("decodes the two records of the bank", () =>
    Effect.gen(function* decodesBank() {
      expect(yield* runOnce("computis-effect-xml/typed-decode")).toStrictEqual({
        count: 2,
        expected: 2,
      });
    }),
  );

  it.effect("encodes the two records of the bank so they decode again", () =>
    Effect.gen(function* encodesBank() {
      expect(yield* runOnce("computis-effect-xml/encode-typed")).toStrictEqual({
        count: 2,
        expected: 2,
      });
    }),
  );

  it.effect("exports the profile the probes measure", () =>
    Effect.gen(function* probesProfile() {
      const Empty = Schema.Struct({});

      const rejectsMalformed = yield* Effect.isFailure(
        decodeWith(Schema.Struct({ b: Empty }).pipe(root("a")), "<a><b></a>"),
      );

      const acceptsBound = yield* Effect.isSuccess(
        decodeWith(Empty.pipe(root("a", { namespace: "urn:x" })), `<p:a xmlns:p="urn:x"/>`),
      );

      const rejectsOther = yield* Effect.isFailure(
        decodeWith(Empty.pipe(root("a", { namespace: "urn:y" })), `<p:a xmlns:p="urn:x"/>`),
      );

      const entity = yield* decodeWith(Leaf, "<r><a>&amp;</a></r>");

      const doctype = yield* decodeWith(
        Leaf,
        `<!DOCTYPE r [<!ENTITY e "x">]><r><a>&e;</a></r>`,
      ).pipe(Effect.option);

      expect(libraries).toHaveLength(1);
      expect(libraries[0]).toMatchObject({
        decodesEntities: entity.a === "&",
        expandsDoctypeEntities: Option.exists(doctype, (value) => value.a === "x"),
        library: "@computis/effect-xml",
        rejectsMalformed,
        reportsPositions: false,
        resolvesNamespaces: acceptsBound && rejectsOther,
        streams: false,
        typed: true,
      });
    }),
  );
});
