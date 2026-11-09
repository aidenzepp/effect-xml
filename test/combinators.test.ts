/* oxlint-disable sort-keys -- slot order is encode order; QTI writes the prompt before the choices. */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

import { decodeString, encodeString } from "../src/codec.ts";
import { namespaces } from "../src/dsl.ts";
import { elements, many, mixed, optional, text } from "../src/plan.ts";

const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

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
 * A choice as a domain model: a class whose getter only works on a real instance.
 */
class Choice extends Schema.Class<Choice>("Choice")({ id: Schema.String, label: Schema.String }) {
  /**
   * The choice as `id: label`.
   *
   * @returns The display form.
   */
  get display(): string {
    return `${this.id}: ${this.label}`;
  }
}

/**
 * The transformation between a decoded `qti-simple-choice` and the fields of {@link Choice}.
 */
const toChoice = {
  decode: SchemaGetter.transform(
    (choice: { readonly identifier: string; readonly $text: string }) => ({
      id: choice.identifier,
      label: choice.$text,
    }),
  ),
  encode: SchemaGetter.transform((choice: { readonly id: string; readonly label: string }) => ({
    identifier: choice.id,
    $text: choice.label,
  })),
};

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

/**
 * A member element of mixed content, decoded to a class.
 */
class Emphasis extends Schema.Class<Emphasis>("Emphasis")({ words: Schema.String }) {}

/**
 * The `em` element codec that {@link Emphasis} decodes from.
 */
const Em = Element("em", { content: text(Schema.String) });

/**
 * The transformation between a decoded `em` and the fields of {@link Emphasis}.
 */
const toEmphasis = {
  decode: SchemaGetter.transform((value: { readonly $text: string }) => ({ words: value.$text })),
  encode: SchemaGetter.transform((value: { readonly words: string }) => ({ $text: value.words })),
};

describe("element codecs behind Schema combinators", () => {
  it.effect("decodes and encodes a many slot of a decodeTo(Class) child", () =>
    Effect.gen(function* decodesChoiceModels() {
      const ChoiceModels = Element("qti-choice-interaction", {
        attributes: { "max-choices": Schema.Int, "response-identifier": Schema.String },
        content: elements({
          prompt: optional(Prompt),
          choices: many(SimpleChoice.pipe(Schema.decodeTo(Choice, toChoice))),
        }),
      });

      const value = yield* decodeString(ChoiceModels)(xml);

      expect(value.choices.every((choice) => choice instanceof Choice)).toBe(true);
      expect(value.choices.map((choice) => choice.display)).toEqual(["A: First", "B: Second"]);

      const encoded = yield* encodeString(ChoiceModels)(value);

      expect(yield* decodeString(ChoiceModels)(encoded)).toEqual(value);
    }),
  );

  it.effect("decodes a decodeTo(Class) root and keeps the failure path", () =>
    Effect.gen(function* decodesClassRoot() {
      const Root = ChoiceInteraction.pipe(Schema.decodeTo(Interaction, toInteraction));

      const value = yield* decodeString(Root)(xml);

      expect(value).toBeInstanceOf(Interaction);
      expect(value.choices.map((choice) => choice.identifier)).toEqual(["A", "B"]);

      const failure = yield* Effect.flip(
        decodeString(Root)(xml.replace('max-choices="1"', 'max-choices="x"')),
      );

      expect(failure.path).toBe("/qti-choice-interaction/@max-choices");
    }),
  );

  it("lowers a mixed member behind decodeTo(Class)", () => {
    expect(() =>
      Element("p", { content: mixed([Em.pipe(Schema.decodeTo(Emphasis, toEmphasis))]) }),
    ).not.toThrow();
  });

  it.effect("decodes annotate, check, and brand roots", () =>
    Effect.gen(function* decodesWrappedRoots() {
      const input = `<qti-prompt xmlns="${QTI}">Pick one</qti-prompt>`;
      const annotated = Prompt.annotate({ title: "prompt" });

      const checked = Prompt.pipe(
        Schema.check(Schema.makeFilter((prompt) => prompt.$text.length > 0 || "non-empty")),
      );

      const branded = Prompt.pipe(Schema.brand("Prompt"));

      expect((yield* decodeString(annotated)(input)).$text).toBe("Pick one");
      expect((yield* decodeString(checked)(input)).$text).toBe("Pick one");
      expect((yield* decodeString(branded)(input)).$text).toBe("Pick one");
    }),
  );
});
