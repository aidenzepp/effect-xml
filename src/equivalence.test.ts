/* oxlint-disable sort-keys -- slot order is encode order; QTI writes the prompt before the choices. */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { decodeString, decodeTree, encodeString } from "./codec.ts";
import { namespaces } from "./dsl.ts";
import { equivalence } from "./equivalence.ts";
import { elements, many, mixed, optional, text } from "./plan.ts";

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
 * The README document with its prompt written after the choices: the same set of children in
 * another order.
 */
const reordered = `<qti-choice-interaction xmlns="${QTI}" response-identifier="RESPONSE" max-choices="1">
  <qti-simple-choice identifier="A">First</qti-simple-choice>
  <qti-simple-choice identifier="B">Second</qti-simple-choice>
  <qti-prompt>Pick one</qti-prompt>
</qti-choice-interaction>`;

/**
 * A mixed-content element over the README members, where child order is content.
 */
const Div = Element("qti-div", { content: mixed([Prompt, SimpleChoice]) });

describe("equivalence", () => {
  it.effect("holds between the README document and its encoded copy", () =>
    Effect.gen(function* roundTrip() {
      const value = yield* decodeString(ChoiceInteraction)(xml);
      const encoded = yield* encodeString(ChoiceInteraction)(value);
      const before = yield* decodeTree()(xml);
      const after = yield* decodeTree()(encoded);

      expect(equivalence(ChoiceInteraction)(before, after)).toBe(true);
    }),
  );

  it.effect("fails when the copy carries an added attribute", () =>
    Effect.gen(function* addedAttribute() {
      const before = yield* decodeTree()(xml);

      const after = yield* decodeTree()(
        xml.replace('max-choices="1"', 'max-choices="1" lang="en"'),
      );

      expect(equivalence(ChoiceInteraction)(before, after)).toBe(false);
    }),
  );

  it.effect("ignores the order of differently named children inside elements content", () =>
    Effect.gen(function* elementsOrder() {
      const before = yield* decodeTree()(xml);
      const after = yield* decodeTree()(reordered);

      expect(equivalence(ChoiceInteraction)(before, after)).toBe(true);
    }),
  );

  it.effect("keeps the order of differently named children inside mixed content", () =>
    Effect.gen(function* mixedOrder() {
      const before = yield* decodeTree()(
        `<qti-div xmlns="${QTI}"><qti-prompt>Pick one</qti-prompt><qti-simple-choice identifier="A">First</qti-simple-choice></qti-div>`,
      );

      const after = yield* decodeTree()(
        `<qti-div xmlns="${QTI}"><qti-simple-choice identifier="A">First</qti-simple-choice><qti-prompt>Pick one</qti-prompt></qti-div>`,
      );

      expect(equivalence(Div)(before, after)).toBe(false);
    }),
  );
});
