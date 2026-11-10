/* oxlint-disable sort-keys -- slot order is encode order; QTI writes the prompt before the choices. */
import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";

import { XmlSchema } from "../src/index.ts";

// readme:start
const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

const { Element } = XmlSchema.namespaces({ "": QTI });

const SimpleChoice = Element("qti-simple-choice", {
  attributes: { identifier: Schema.String },
  content: XmlSchema.text(Schema.String),
});

const Prompt = Element("qti-prompt", { content: XmlSchema.text(Schema.String) });

const ChoiceInteraction = Element("qti-choice-interaction", {
  attributes: { "max-choices": Schema.Int, "response-identifier": Schema.String },
  content: XmlSchema.elements({
    prompt: XmlSchema.optionalKey(Prompt),
    choices: XmlSchema.Array(SimpleChoice),
  }),
});

const xml = `<qti-choice-interaction xmlns="${QTI}" response-identifier="RESPONSE" max-choices="1">
  <qti-prompt>Pick one</qti-prompt>
  <qti-simple-choice identifier="A">First</qti-simple-choice>
  <qti-simple-choice identifier="B">Second</qti-simple-choice>
</qti-choice-interaction>`;

const Document = XmlSchema.fromString(ChoiceInteraction);

const value = Schema.decodeUnknownSync(Document)(xml);

console.log(value);

const encoded = Schema.encodeSync(Document)(value);
// readme:start-end

// readme:errors
const failure = Effect.runSync(
  Schema.decodeUnknownEffect(Document)(xml.replace('max-choices="1"', 'max-choices="x"')).pipe(
    Effect.as(undefined),
    Effect.catchTag("SchemaError", (schemaError) =>
      Effect.fail(
        Option.getOrElse(XmlSchema.findDecodeErrorOption(schemaError.issue), () => schemaError),
      ),
    ),
    Effect.catchReason("XmlDecodeError", "SchemaFailure", (_reason, error) =>
      Effect.succeed(error),
    ),
  ),
);

console.log(failure?.message);
// readme:errors-end

// readme:encode-errors
const encodeFailure = Effect.runSync(
  Schema.encodeEffect(Document)({ ...value, "response-identifier": "RESPONSE\u0000" }).pipe(
    Effect.as(undefined),
    Effect.catchTag("SchemaError", (schemaError) =>
      Effect.fail(
        Option.getOrElse(XmlSchema.findEncodeErrorOption(schemaError.issue), () => schemaError),
      ),
    ),
    Effect.catchReason("XmlEncodeError", "InvalidEvent", (_reason, error) => Effect.succeed(error)),
  ),
);

console.log(encodeFailure?.message);
// readme:encode-errors-end

// readme:round-trip
const equivalent = XmlSchema.equivalence(ChoiceInteraction);

const Tree = XmlSchema.ElementFromString({ "": QTI });

console.log(
  equivalent(Schema.decodeUnknownSync(Tree)(xml), Schema.decodeUnknownSync(Tree)(encoded)),
);
// readme:round-trip-end

describe("README example", () => {
  it("decodes and round-trips the document", () => {
    expect(value["max-choices"]).toBe(1);
    expect(value.choices.map((choice) => choice.identifier)).toEqual(["A", "B"]);
    expect(Schema.decodeUnknownSync(Document)(encoded)).toEqual(value);
  });

  it("selects the located schema failure from the SchemaError", () => {
    expect(failure?.path).toBe("/qti-choice-interaction/@max-choices");
    expect(failure?.message).toMatch(/finite/iu);
  });

  it("selects the encode failure from the SchemaError", () => {
    expect(encodeFailure?._tag).toBe("XmlEncodeError");
    expect(encodeFailure?.reason._tag).toBe("InvalidEvent");
    expect(encodeFailure?.message).toMatch(/response-identifier .*U\+0000/u);
  });

  it("decodes the input and the output to equivalent trees", () => {
    expect(
      equivalent(Schema.decodeUnknownSync(Tree)(xml), Schema.decodeUnknownSync(Tree)(encoded)),
    ).toBe(true);
  });
});
