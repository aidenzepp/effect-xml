/* oxlint-disable sort-keys -- slot order is encode order; QTI writes the prompt before the choices. */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";
import { expectTypeOf } from "vitest";

import { QTI, spanNames } from "../test/support.ts";
import { decodeString, decodeTree, encodeString } from "./codec.ts";
import {
  ElementFromString,
  findDecodeError,
  findDecodeErrorOption,
  findEncodeError,
  findEncodeErrorOption,
  fromString,
} from "./document.ts";
import { Element as plainElement, namespaces } from "./dsl.ts";
import { elements, many, mixed, optional, text } from "./plan.ts";

const { Element } = namespaces({ "": QTI });

const SimpleChoice = Element("qti-simple-choice", {
  attributes: { identifier: Schema.String },
  content: text(Schema.String),
});

const Prompt = Element("qti-prompt", { content: text(Schema.String) });

const ChoiceInteraction = Element("qti-choice-interaction", {
  attributes: { "max-choices": Schema.Int, "response-identifier": Schema.String },
  content: elements({ prompt: optional(Prompt), choices: many(SimpleChoice) }),
});

const xml = `<qti-choice-interaction xmlns="${QTI}" response-identifier="RESPONSE" max-choices="1">
  <qti-prompt>Pick one</qti-prompt>
  <qti-simple-choice identifier="A">First</qti-simple-choice>
  <qti-simple-choice identifier="B">Second</qti-simple-choice>
</qti-choice-interaction>`;

/**
 * The README document with a `max-choices` value `Schema.Int` rejects.
 */
const badXml = xml.replace('max-choices="1"', 'max-choices="x"');

/**
 * A choice interaction as a domain model.
 */
class Interaction extends Schema.Class<Interaction>("Interaction")({
  maxChoices: Schema.Int,
  responseIdentifier: Schema.String,
  choices: Schema.Array(Schema.Struct({ identifier: Schema.String, $text: Schema.String })),
}) {}

/**
 * The transformation between a decoded `qti-choice-interaction` and the fields of
 * {@link Interaction}; the prompt is not carried.
 */
const toInteraction = {
  decode: SchemaGetter.transform((value: (typeof ChoiceInteraction)["Type"]) => ({
    maxChoices: value["max-choices"],
    responseIdentifier: value["response-identifier"],
    choices: value.choices,
  })),
  encode: SchemaGetter.transform((value: (typeof Interaction)["Encoded"]) => ({
    "max-choices": value.maxChoices,
    "response-identifier": value.responseIdentifier,
    choices: value.choices,
  })),
};

describe("fromString", () => {
  it.effect("decodes and encodes the README document like the document functions", () =>
    Effect.gen(function* decodesReadme() {
      const expected = yield* decodeString(ChoiceInteraction)(xml);
      const expectedText = yield* encodeString(ChoiceInteraction)(expected);

      expect(Schema.decodeUnknownSync(fromString(ChoiceInteraction))(xml)).toEqual(expected);
      expect(Schema.encodeSync(fromString(ChoiceInteraction))(expected)).toBe(expectedText);
    }),
  );

  it.effect("carries the decode error of a rejected attribute in the schema issue", () =>
    Effect.gen(function* carriesDecodeError() {
      const internal = yield* Effect.flip(decodeString(ChoiceInteraction)(badXml));

      const error = yield* Effect.flip(
        Schema.decodeUnknownEffect(fromString(ChoiceInteraction))(badXml),
      );

      const found = findDecodeErrorOption(error.issue);

      expect(error._tag).toBe("SchemaError");
      expect(found.pipe(Option.map((decode) => decode.path))).toEqual(
        Option.some("/qti-choice-interaction/@max-choices"),
      );
      expect(found.pipe(Option.map((decode) => decode.position))).toEqual(
        Option.some({ line: 1, column: 1 }),
      );
      expect(found.pipe(Option.map((decode) => decode.message))).toEqual(
        Option.some(internal.message),
      );
    }),
  );

  it.effect("keeps the decode error inside a struct field and behind fromJsonString", () =>
    Effect.gen(function* keepsNestedDecodeError() {
      const Envelope = Schema.Struct({ id: Schema.String, item: fromString(ChoiceInteraction) });
      const envelope = { id: "item-1", item: badXml };

      const nested = yield* Effect.flip(Schema.decodeUnknownEffect(Envelope)(envelope));

      const json = yield* Effect.flip(
        Schema.decodeUnknownEffect(Schema.fromJsonString(Envelope))(JSON.stringify(envelope)),
      );

      expect(findDecodeErrorOption(nested.issue).pipe(Option.map((decode) => decode.path))).toEqual(
        Option.some("/qti-choice-interaction/@max-choices"),
      );
      expect(findDecodeErrorOption(json.issue).pipe(Option.map((decode) => decode.path))).toEqual(
        Option.some("/qti-choice-interaction/@max-choices"),
      );
    }),
  );

  it.effect("finds no decode error when the input is not a string", () =>
    Effect.gen(function* findsNoDecodeError() {
      const error = yield* Effect.flip(
        Schema.decodeUnknownEffect(fromString(ChoiceInteraction))(42),
      );

      expect(Option.isNone(findDecodeErrorOption(error.issue))).toBe(true);
    }),
  );

  it.effect("returns the stored decode error as a Result, and the input issue when none", () =>
    Effect.gen(function* findsDecodeResult() {
      const stored = yield* Effect.flip(
        Schema.decodeUnknownEffect(fromString(ChoiceInteraction))(badXml),
      );
      const missing = yield* Effect.flip(
        Schema.decodeUnknownEffect(fromString(ChoiceInteraction))(42),
      );

      expect(findDecodeError(stored.issue)).toEqual(
        Result.succeed(Option.getOrThrow(findDecodeErrorOption(stored.issue))),
      );
      const failed = findDecodeError(missing.issue);

      expect(Result.isFailure(failed)).toBe(true);
      expect(Result.isFailure(failed) && failed.failure === missing.issue).toBe(true);
    }),
  );

  it.effect("carries the encode error of a rejected value in the schema issue", () =>
    Effect.gen(function* carriesEncodeError() {
      const Label = plainElement("label", {
        attributes: {
          id: Schema.String.check(Schema.isNonEmpty()).pipe(Schema.decodeTo(Schema.String)),
        },
      });

      const error = yield* Effect.flip(Schema.encodeEffect(fromString(Label))({ id: "" }));

      const found = findEncodeErrorOption(error.issue);

      expect(found.pipe(Option.map((encode) => encode._tag))).toEqual(
        Option.some("XmlEncodeError"),
      );
      expect(found.pipe(Option.map((encode) => encode.reason._tag))).toEqual(
        Option.some("EncodeSchemaFailure"),
      );
      expect(found.pipe(Option.map((encode) => encode.path))).toEqual(Option.some("/label/@id"));
      expect(Option.isNone(findDecodeErrorOption(error.issue))).toBe(true);
    }),
  );

  it.effect("returns the stored encode error as a Result, and the input issue when none", () =>
    Effect.gen(function* findsEncodeResult() {
      const Label = plainElement("label", {
        attributes: {
          id: Schema.String.check(Schema.isNonEmpty()).pipe(Schema.decodeTo(Schema.String)),
        },
      });
      const stored = yield* Effect.flip(Schema.encodeEffect(fromString(Label))({ id: "" }));
      const missing = yield* Effect.flip(
        Schema.decodeUnknownEffect(fromString(ChoiceInteraction))(badXml),
      );

      expect(findEncodeError(stored.issue)).toEqual(
        Result.succeed(Option.getOrThrow(findEncodeErrorOption(stored.issue))),
      );
      const failed = findEncodeError(missing.issue);

      expect(Result.isFailure(failed)).toBe(true);
      expect(Result.isFailure(failed) && failed.failure === missing.issue).toBe(true);
    }),
  );

  it.effect("finds no encode error in a decode failure", () =>
    Effect.gen(function* findsNoEncodeError() {
      const error = yield* Effect.flip(
        Schema.decodeUnknownEffect(fromString(ChoiceInteraction))(badXml),
      );

      expect(Option.isSome(findDecodeErrorOption(error.issue))).toBe(true);
      expect(Option.isNone(findEncodeErrorOption(error.issue))).toBe(true);
    }),
  );

  it("keeps its type through annotate", () => {
    expectTypeOf(fromString(ChoiceInteraction).annotate({ title: "doc" })).toEqualTypeOf<
      fromString<typeof ChoiceInteraction>
    >();
  });

  it("decodes a decodeTo(Class) root to an instance", () => {
    const Root = ChoiceInteraction.pipe(Schema.decodeTo(Interaction, toInteraction));

    const value = Schema.decodeUnknownSync(fromString(Root))(xml);

    expect(value).toBeInstanceOf(Interaction);
    expect(value.choices.map((choice) => choice.identifier)).toEqual(["A", "B"]);
  });

  it.effect("collects every attribute issue under errors all", () =>
    Effect.gen(function* collectsAllIssues() {
      const badAttributes = ["a", "b"];
      const Pair = plainElement("r", { attributes: { a: Schema.Int, b: Schema.Int } });
      const pairXml = `<r ${badAttributes.map((name) => `${name}="x"`).join(" ")}/>`;

      const error = yield* Effect.flip(
        Schema.decodeUnknownEffect(fromString(Pair), { errors: "all" })(pairXml),
      );

      const issues = findDecodeErrorOption(error.issue).pipe(
        Option.map((decode) =>
          decode.reason._tag === "SchemaFailure"
            ? SchemaIssue.makeFormatterStandardSchemaV1()(decode.reason.cause.issue).issues.length
            : 0,
        ),
      );

      expect(Option.getOrElse(issues, () => 0)).toBeGreaterThanOrEqual(badAttributes.length);
    }),
  );

  it.effect("runs one xml.decodeString span per decode", () =>
    Effect.gen(function* recordsSpan() {
      const names = yield* spanNames(
        Schema.decodeUnknownEffect(fromString(ChoiceInteraction))(xml),
      );

      expect(names.filter((name) => name === "xml.decodeString")).toHaveLength(1);
    }),
  );
});

/**
 * A root whose mixed content lists `p` in `urn:a` with an optional `x` and `p` in `urn:b` with a
 * required `y`, and the document that holds the `urn:b` member.
 *
 * The two members form a collision group, so the root's type side is a `oneOf` union over exact
 * member values: it keeps the `urn:b` value `{ y: "1" }` as it stands. The row still pins that
 * `fromString` decodes in one pass to the value `decodeString` returns; a type side that strips
 * excess keys, such as a union whose first member accepts the `urn:b` value without `y`, would
 * change the value on a second type-side parse.
 */
const overlapping = {
  Root: plainElement("r", {
    content: mixed([
      namespaces({ "": "urn:a" }).Element("p", {
        attributes: { x: Schema.optionalKey(Schema.String) },
      }),
      namespaces({ "": "urn:b" }).Element("p", { attributes: { y: Schema.String } }),
    ]),
  }),
  text: '<r>a<p xmlns="urn:b" y="1"/>b</r>',
} as const;

/**
 * A root whose text is a union of two leaf codecs told apart by their encoded prefix, `A:` to an
 * optional `x` and `B:` to a required `y`, and the document that holds the `B:` member.
 *
 * The encoded side selects the `B:` member by its prefix, but on the type side the `A:` member's
 * struct accepts the `B:` value with `y` stripped, so a second type-side parse would change it.
 * The class is any text or attribute leaf union whose members overlap on the type side.
 */
const prefixedUnion = {
  Root: plainElement("t", {
    content: text(
      Schema.Union([
        Schema.String.check(Schema.isPattern(/^A:/u)).pipe(
          Schema.decodeTo(Schema.Struct({ x: Schema.optionalKey(Schema.String) }), {
            decode: SchemaGetter.transform((encoded: string) => ({ x: encoded.slice(2) })),
            encode: SchemaGetter.transform(
              (value: { readonly x?: string }) => `A:${value.x ?? ""}`,
            ),
          }),
        ),
        Schema.String.check(Schema.isPattern(/^B:/u)).pipe(
          Schema.decodeTo(Schema.Struct({ y: Schema.String }), {
            decode: SchemaGetter.transform((encoded: string) => ({ y: encoded.slice(2) })),
            encode: SchemaGetter.transform((value: { readonly y: string }) => `B:${value.y}`),
          }),
        ),
      ]),
    ),
  }),
  text: "<t>B:1</t>",
} as const;

describe("fromString passes decodeString's value through", () => {
  it.effect("decodes an overlapping mixed union to the value decodeString returns", () =>
    Effect.gen(function* decodesOverlapping() {
      const expected = yield* decodeString(overlapping.Root)(overlapping.text);

      const value = yield* Schema.decodeUnknownEffect(fromString(overlapping.Root))(
        overlapping.text,
      );

      expect(value).toStrictEqual(expected);
    }),
  );

  it.effect("decodes an overlapping prefixed text union to the value decodeString returns", () =>
    Effect.gen(function* decodesPrefixedUnion() {
      const expected = yield* decodeString(prefixedUnion.Root)(prefixedUnion.text);

      const value = yield* Schema.decodeUnknownEffect(fromString(prefixedUnion.Root))(
        prefixedUnion.text,
      );

      expect(expected).toStrictEqual({ $text: { y: "1" } });
      expect(value).toStrictEqual(expected);
    }),
  );

  it.effect("runs the root check once per decode and once per encode", () =>
    Effect.gen(function* countsChecks() {
      let runs = 0;

      const Counted = plainElement("label", { attributes: { id: Schema.String } }).check(
        Schema.makeFilter(() => {
          runs += 1;

          return true;
        }),
      );

      const Document = fromString(Counted);
      const value = yield* Schema.decodeUnknownEffect(Document)('<label id="a"/>');
      const decodeRuns = runs;

      runs = 0;
      yield* Schema.encodeEffect(Document)(value);

      expect({ decode: decodeRuns, encode: runs }).toStrictEqual({ decode: 1, encode: 1 });
    }),
  );

  // Fail-open by owner decision (option B): failing closed would change this row deliberately.
  it("accepts a value the root rejects through Schema.is on the fromString codec", () => {
    const Document = fromString(ChoiceInteraction);

    expect(Schema.is(Document)({ choices: "not an array" })).toBe(true);
    expect(Schema.is(Schema.toType(Document))(42)).toBe(true);
  });

  it("rejects that value through Schema.is on the root's type side", () => {
    expect(Schema.is(Schema.toType(ChoiceInteraction))({ choices: "not an array" })).toBe(false);
    expect(Schema.is(Schema.toType(ChoiceInteraction))(42)).toBe(false);
  });

  // Fail-open by owner decision (option B), as for Schema.is above.
  it("accepts a value the root rejects through Schema.asserts on the fromString codec", () => {
    const Document = fromString(ChoiceInteraction);

    expect(() => {
      Schema.asserts(Document, { choices: "not an array" });
    }).not.toThrow();
    expect(() => {
      Schema.asserts(Schema.toType(Document), 42);
    }).not.toThrow();
  });

  it("rejects that value through Schema.asserts on the root's type side", () => {
    const Type = Schema.toType(ChoiceInteraction);

    expect(() => {
      Schema.asserts(Type, { choices: "not an array" });
    }).toThrow();
    expect(() => {
      Schema.asserts(Type, 42);
    }).toThrow();
  });
});

describe("ElementFromString", () => {
  const Tree = ElementFromString({ "": QTI });

  it.effect("decodes the README document to the tree and round-trips it", () =>
    Effect.gen(function* roundTripsTree() {
      const expected = yield* decodeTree()(xml);

      const tree = yield* Schema.decodeUnknownEffect(Tree)(xml);
      const encoded = yield* Schema.encodeEffect(Tree)(tree);

      expect(tree).toEqual(expected);
      expect(yield* Schema.decodeUnknownEffect(Tree)(encoded)).toEqual(tree);
    }),
  );

  it.effect("carries a WellFormedness decode error for malformed text", () =>
    Effect.gen(function* carriesWellFormedness() {
      const error = yield* Effect.flip(Schema.decodeUnknownEffect(Tree)("<qti-prompt>"));

      expect(
        findDecodeErrorOption(error.issue).pipe(Option.map((decode) => decode.reason._tag)),
      ).toEqual(Option.some("WellFormedness"));
    }),
  );
});
