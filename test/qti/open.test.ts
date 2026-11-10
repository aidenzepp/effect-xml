/**
 * The open `mixed` witness on `bg011-media.xml`: a QTI item body declared with `{ open: true }`
 * decodes the undeclared `video` element as one generic member, round-trips it, and re-encodes a
 * tree canonically equal to the input.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { XmlSchema } from "../../src/index.ts";
import {
  AssessmentItem,
  Blockquote,
  ChoiceInteraction,
  Div,
  ExtendedTextInteraction,
  HotspotInteraction,
  Identifier,
  Img,
  ObjectElement,
  OutcomeDeclaration,
  P,
  QTI,
  ResponseDeclaration,
  qti,
} from "./vocabulary.ts";

/**
 * A `div` that admits `img` alongside the vocabulary `div`'s members.
 *
 * The vocabulary's closed `div` declares no `img`, and `bg011-media.xml` wraps its picture in a
 * `div`, so the body's `div` member is this one; deeper divisions use the vocabulary `div`.
 */
const MediaDiv = qti.Element("div", {
  attributes: { class: Schema.optionalKey(Schema.String) },
  content: XmlSchema.mixed([P, Blockquote, ObjectElement, ExtendedTextInteraction, Img, Div]),
});

/**
 * An item body that keeps the vocabulary's attributes and block members and accepts any other
 * child element as the generic member `{ _tag: "*", element }`.
 */
const OpenItemBody = qti.Element("qti-item-body", {
  attributes: { "data-*": Schema.String },
  content: XmlSchema.mixed(
    [P, MediaDiv, Blockquote, Img, ChoiceInteraction, HotspotInteraction, ExtendedTextInteraction],
    { open: true },
  ),
});

/**
 * Response processing whose children are all kept, undeclared, in its `"*"` slot.
 */
const OpenResponseProcessing = qti.Element("qti-response-processing", {
  attributes: { template: Schema.optionalKey(Schema.String) },
  content: XmlSchema.elements({}, { open: true }),
});

/**
 * The vocabulary's item root with an optional open body and optional open response processing.
 */
const OpenAssessmentItem = qti.Element("qti-assessment-item", {
  attributes: {
    adaptive: Schema.optionalKey(Schema.Boolean),
    identifier: Identifier,
    "time-dependent": Schema.Boolean,
    title: Schema.String,
    "xml:lang": Schema.optionalKey(Schema.String),
    "xsi:schemaLocation": Schema.optionalKey(Schema.String),
  },
  /* oxlint-disable sort-keys -- slot order is encode order, which must follow QTI authoring order. */
  content: XmlSchema.elements({
    responseDeclarations: XmlSchema.many(ResponseDeclaration),
    outcomeDeclarations: XmlSchema.many(OutcomeDeclaration),
    body: XmlSchema.optionalKey(OpenItemBody),
    responseProcessing: XmlSchema.optionalKey(OpenResponseProcessing),
  }),
  /* oxlint-enable sort-keys */
});

/**
 * One child of the open item body, as decoded.
 */
type BodyItem = (typeof OpenItemBody)["Type"]["$children"][number];

/**
 * Name one body item by its kind, handling every member of the item union.
 *
 * The `never` default makes the type check fail when the union gains a member this switch does
 * not handle, so the generic member `"*"` is part of the exhaustive set.
 *
 * @param item - The decoded body item.
 * @returns The item's element name, or `$text` for a text run.
 */
const render = (item: BodyItem): string => {
  switch (item._tag) {
    case "$text": {
      return "$text";
    }

    case "p":
    case "div":
    case "blockquote":
    case "img":
    case "qti-choice-interaction":
    case "qti-hotspot-interaction":
    case "qti-extended-text-interaction": {
      return item._tag;
    }

    case "*": {
      return item.element.name;
    }

    default: {
      const unhandled: never = item;

      return unhandled;
    }
  }
};

/**
 * The fixture under test, read by path.
 */
const xml = readFileSync(
  new URL("../../spikes/fixtures/qti/bg011-media.xml", import.meta.url),
  "utf-8",
);

/**
 * The open item as a whole-document codec between XML text and the decoded item.
 */
const OpenDocument = XmlSchema.fromString(OpenAssessmentItem);

/**
 * The closed vocabulary item as a whole-document codec, for the contrast with the open item.
 */
const ClosedDocument = XmlSchema.fromString(AssessmentItem);

/**
 * The generic element tree of a document whose default namespace is QTI, used as the input side
 * of each equivalence check.
 */
const Tree = XmlSchema.ElementFromString({ "": QTI });

/**
 * Count the element children that carry one Clark name.
 *
 * @param children - The children of a resolved element, text runs included.
 * @param name - The Clark name to match.
 * @returns How many element children have that name.
 */
const countNamed = (children: XmlSchema.ResolvedElement["children"], name: string): number =>
  children.filter((child) => !Predicate.isString(child) && child.name === name).length;

describe("open mixed QTI item body on bg011-media.xml", () => {
  it.effect("decodes the undeclared video element as the one generic member", () =>
    Effect.gen(function* decodesVideo() {
      const value = yield* Schema.decodeUnknownEffect(OpenDocument)(xml);
      const generic = (value.body?.$children ?? []).filter((item) => item._tag === "*");

      expect(generic).toHaveLength(1);

      const [video] = generic;
      const children = video?.element.children ?? [];

      expect(video?.element.name).toBe(`{${QTI}}video`);
      expect(countNamed(children, `{${QTI}}source`)).toBe(2);
      expect(countNamed(children, `{${QTI}}track`)).toBe(1);
      expect((value.body?.$children ?? []).map(render)).toContain(`{${QTI}}video`);
    }),
  );

  it.effect("encodes, and decodes the encoded text to a deep-equal value", () =>
    Effect.gen(function* roundTrips() {
      const value = yield* Schema.decodeUnknownEffect(OpenDocument)(xml);
      const encoded = yield* Schema.encodeEffect(OpenDocument)(value);
      const again = yield* Schema.decodeUnknownEffect(OpenDocument)(encoded);

      expect(again).toStrictEqual(value);
    }),
  );

  it.effect("encodes a tree canonically equal to the input tree", () =>
    Effect.gen(function* canonicallyEqual() {
      const input = yield* Schema.decodeUnknownEffect(Tree)(xml);
      const value = yield* Schema.decodeUnknownEffect(OpenDocument)(xml);
      const output = yield* Schema.encodeEffect(OpenAssessmentItem)(value);

      expect(XmlSchema.equivalence(OpenAssessmentItem)(output, input)).toBe(true);
    }),
  );
});

/**
 * The adaptive-absent fixture, read by path: response processing holds elements the M1
 * vocabulary does not declare.
 */
const adaptiveAbsent = readFileSync(
  new URL("../../spikes/fixtures/qti/conformance-adaptive-absent.xml", import.meta.url),
  "utf-8",
);

/**
 * Collect the Clark names of every element in a resolved subtree, the root included.
 *
 * @param element - The subtree root.
 * @returns The names in document order.
 */
const namesIn = (element: XmlSchema.ResolvedElement): readonly string[] => [
  element.name,
  ...element.children.flatMap((child) => (Predicate.isString(child) ? [] : namesIn(child))),
];

describe("open elements response processing on conformance-adaptive-absent.xml", () => {
  it.effect("keeps the undeclared set-outcome-value in the open slot with its descendants", () =>
    Effect.gen(function* keepsOpenSlot() {
      const value = yield* Schema.decodeUnknownEffect(OpenDocument)(adaptiveAbsent);
      const slot = value.responseProcessing?.["*"] ?? [];

      expect(value.responseProcessing).toBeDefined();
      expect(slot).toHaveLength(1);
      expect(slot[0]?.name).toBe(`{${QTI}}qti-set-outcome-value`);
      expect(namesIn(slot[0] ?? { attributes: {}, children: [], name: "" })).toContain(
        `{${QTI}}qti-sum`,
      );
    }),
  );

  it.effect("encodes, and decodes the encoded text to a deep-equal value", () =>
    Effect.gen(function* roundTrips() {
      const value = yield* Schema.decodeUnknownEffect(OpenDocument)(adaptiveAbsent);
      const encoded = yield* Schema.encodeEffect(OpenDocument)(value);
      const again = yield* Schema.decodeUnknownEffect(OpenDocument)(encoded);

      expect(again).toStrictEqual(value);
    }),
  );

  it.effect("encodes a tree canonically equal to the input tree", () =>
    Effect.gen(function* canonicallyEqual() {
      const input = yield* Schema.decodeUnknownEffect(Tree)(adaptiveAbsent);
      const value = yield* Schema.decodeUnknownEffect(OpenDocument)(adaptiveAbsent);
      const output = yield* Schema.encodeEffect(OpenAssessmentItem)(value);

      expect(XmlSchema.equivalence(OpenAssessmentItem)(output, input)).toBe(true);
    }),
  );
});

/**
 * `bg011-media.xml` without its leading `div`.
 *
 * The vocabulary's closed `div` declares no `img`, so the full fixture fails first at `div/img`;
 * removing the `div` leaves `video` as the one child the closed body cannot place.
 */
const withoutDiv = xml.replace(/<div>.*<\/div>\n/u, "");

describe("the closed contrast on bg011-media.xml", () => {
  it.effect("fails the closed item with one Schema error at the body's video", () =>
    Effect.gen(function* failsClosed() {
      expect(withoutDiv).not.toBe(xml);

      const failure = yield* Schema.decodeUnknownEffect(ClosedDocument)(withoutDiv).pipe(
        Effect.flip,
      );

      const error = yield* Effect.fromOption(XmlSchema.findDecodeErrorOption(failure.issue));

      expect(failure._tag).toBe("SchemaError");
      expect(error._tag).toBe("XmlDecodeError");
      expect(error.reason._tag).toBe("SchemaFailure");
      expect(error.path).toMatch(/\/qti-item-body\/video(?:\[1\])?$/u);
      expect(error.message).toContain("video");
      expect(error.message).toContain("qti-item-body");
    }),
  );
});
