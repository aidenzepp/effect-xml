import { describe, expect, expectTypeOf, test } from "bun:test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as SchemaIssue from "effect/SchemaIssue";
import * as A from "./approach-a.ts";
import * as B from "./approach-b.ts";
import {
  canonical,
  eventsToString,
  fixtureText,
  readElements,
  withAttribute,
} from "./xml-fixture.ts";

const declarationPath = ["qti-assessment-item", "qti-response-declaration"];

const loadDeclaration = Effect.map(
  readElements(fixtureText(), declarationPath),
  (found) => found[0]!,
);

const expected = {
  identifier: "RESPONSE",
  baseType: "string",
  cardinality: "single",
  correctResponse: { values: ["winter"] },
  mapping: {
    defaultValue: 0,
    entries: [
      { mapKey: "winter", mappedValue: 1, caseSensitive: true },
      { mapKey: "Winter", mappedValue: 0.5 },
    ],
  },
};

const message = (issue: SchemaIssue.Issue): string => new Schema.SchemaError(issue).message;

describe("SPIKE-06 schema layering", () => {
  test("A: decodeTo from Element decodes qti-response-declaration", async () => {
    const value = await Effect.runPromise(Effect.flatMap(loadDeclaration, A.decodeA));
    expect(value as unknown).toEqual(expected);
    expectTypeOf(value.mapping?.entries[0]?.mappedValue).toEqualTypeOf<number | undefined>();
    expectTypeOf<A.ResponseDeclaration["cardinality"]>().toEqualTypeOf<
      "single" | "multiple" | "ordered" | "record"
    >();
  });

  test("B: cursor AST rewrite decodes qti-response-declaration", async () => {
    const value = await Effect.runPromise(Effect.flatMap(loadDeclaration, B.codecB.decode));
    expect(value as unknown).toEqual(expected);
    expectTypeOf(value.mapping?.entries[0]?.mappedValue).toEqualTypeOf<number | undefined>();
    expectTypeOf<B.ResponseDeclaration["cardinality"]>().toEqualTypeOf<
      "single" | "multiple" | "ordered" | "record"
    >();
    expect(B.codecB.rewrite.unsupported).toEqual([]);
    console.log("B visited AST tags:", B.codecB.rewrite.visited.join(", "));
  });

  test("attribute type failure: issue paths", async () => {
    const broken = await Effect.runPromise(
      Effect.map(loadDeclaration, (element) =>
        withAttribute(element, "qti-map-entry", "mapped-value", "x"),
      ),
    );
    const a = await Effect.runPromise(Effect.flip(A.decodeA(broken)));
    const b = await Effect.runPromise(Effect.flip(B.codecB.decode(broken)));
    console.log("A issue:\n" + message(a));
    console.log("B issue (raw):\n" + message(b));
    console.log("B issue (xml path):\n" + message(B.codecB.xmlIssue(b)));
    expect(message(a)).toContain('["mapping"]["entries"][0]["mappedValue"]');
    expect(message(b)).toContain('["mapping"]["entries"][0]["mappedValue"]');
    expect(message(B.codecB.xmlIssue(b))).toContain(
      '["qti-mapping"]["qti-map-entry"][0]["@mapped-value"]',
    );
  });

  test("bad literal and missing child: issue paths", async () => {
    const element = await Effect.runPromise(loadDeclaration);
    const badLiteral = withAttribute(element, "qti-response-declaration", "cardinality", "x");
    const noCorrect = {
      ...element,
      children: element.children.filter(
        (child) => typeof child === "string" || child.name !== "qti-correct-response",
      ),
    };
    for (const [label, input] of [
      ["cardinality=x", badLiteral],
      ["no qti-correct-response", noCorrect],
    ] as const) {
      const a = await Effect.runPromise(Effect.flip(A.decodeA(input)));
      const b = await Effect.runPromise(Effect.flip(B.codecB.decode(input)));
      console.log(`${label} A:\n${message(a)}`);
      console.log(`${label} B (xml path):\n${message(B.codecB.xmlIssue(b))}`);
      expect(message(a)).toMatch(/at \["(cardinality|correctResponse)"\]/);
      expect(message(B.codecB.xmlIssue(b))).toMatch(/at \["(@cardinality|qti-correct-response)"\]/);
    }
  });

  test("A: wrong element name fails in the getter", async () => {
    const element = await Effect.runPromise(loadDeclaration);
    const issue = await Effect.runPromise(
      Effect.flip(A.decodeA({ ...element, name: "qti-outcome-declaration" })),
    );
    expect(message(issue)).toContain("expected element <qti-response-declaration>");
  });

  test("A: encode returns an Element canonically equal to the input", async () => {
    const element = await Effect.runPromise(loadDeclaration);
    const value = await Effect.runPromise(A.decodeA(element));
    const encoded = await Effect.runPromise(A.encodeA(value));
    expect(canonical(encoded)).toBe(canonical(element));
  });

  test("B: encode emits events that round-trip to an equal Element", async () => {
    const element = await Effect.runPromise(loadDeclaration);
    const value = await Effect.runPromise(B.codecB.decode(element));
    const events = await Effect.runPromise(B.codecB.encode(value));
    const xml = await Effect.runPromise(eventsToString(events));
    console.log("B encoded:\n" + xml);
    const again = await Effect.runPromise(
      Effect.map(readElements(xml, ["qti-response-declaration"]), (found) => found[0]!),
    );
    expect(canonical(again)).toBe(canonical(element));
    expect(events[0]).toEqual({
      _tag: "StartElement",
      name: "qti-response-declaration",
      attributes: { identifier: "RESPONSE", "base-type": "string", cardinality: "single" },
    });
  });

  test("B: the same definition decodes and encodes (C1)", async () => {
    const element = await Effect.runPromise(loadDeclaration);
    const value = await Effect.runPromise(B.codecB.decode(element));
    const events = await Effect.runPromise(B.codecB.encode(value));
    const xml = await Effect.runPromise(eventsToString(events));
    const again = await Effect.runPromise(
      Effect.flatMap(
        Effect.map(readElements(xml, ["qti-response-declaration"]), (found) => found[0]!),
        B.codecB.decode,
      ),
    );
    expect(again).toEqual(value);
  });
});
