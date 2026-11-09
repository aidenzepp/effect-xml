/**
 * The C1 round trip of the QTI vocabulary over the four M1 acceptance fixtures: decode, encode,
 * decode again, and compare the re-encoded tree with the input tree under the definition's
 * equivalence.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Xml from "effect/encoding/Xml";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { XmlSchema } from "../../src/index.ts";
import { collect, resolveEvents } from "../../src/resolve.ts";
import { AssessmentItem } from "./vocabulary.ts";

/**
 * The acceptance fixtures the vocabulary must round-trip. `bg010-missing-word.xml` nests `p`
 * under `div` and `blockquote`, so its decode crosses the `suspend` member of `div`.
 */
const fixtures = [
  "bg007-true-false.xml",
  "bpig-hotspot.xml",
  "bg010-missing-word.xml",
  "extended-text-postcard.xml",
] as const;

/**
 * Read one acceptance fixture by file name.
 *
 * @param file - The fixture file name under `spikes/fixtures/qti/`.
 * @returns The fixture's XML text.
 */
const readFixture = (file: string): string =>
  readFileSync(new URL(`../../spikes/fixtures/qti/${file}`, import.meta.url), "utf-8");

/**
 * The vocabulary as a codec between XML text and the decoded value, the route every decode and
 * encode below takes.
 */
const AssessmentItemFromString = XmlSchema.fromString(AssessmentItem);

/**
 * The equivalence for the vocabulary: children compare as a set only inside the elements the
 * definition declares as `elements` or `empty`; every other element is strict.
 */
const equivalent = XmlSchema.equivalence(AssessmentItem);

/**
 * Decode XML text into its single resolved root element, with no definition involved.
 *
 * @param text - The XML text to decode.
 * @returns An effect yielding the root, dying when the text has no root element.
 */
const decodeTree = (text: string) =>
  Stream.make(text).pipe(
    Stream.pipeThroughChannel(Xml.decodeString()),
    Stream.pipeThroughChannel(resolveEvents()),
    Stream.pipeThroughChannel(collect(["*"])),
    Stream.runCollect,
    Effect.map((roots): XmlSchema.ResolvedElement | undefined => roots[0]),
    Effect.flatMap((root) =>
      root === undefined ? Effect.die("no root element") : Effect.succeed(root),
    ),
  );

describe.each(fixtures)("QTI vocabulary on %s", (file) => {
  const xml = readFixture(file);

  it.effect("decodes, encodes, and decodes the encoded text to a deep-equal value", () =>
    Effect.gen(function* roundTrips() {
      const value = yield* Schema.decodeUnknownEffect(AssessmentItemFromString)(xml);
      const encoded = yield* Schema.encodeEffect(AssessmentItemFromString)(value);
      const again = yield* Schema.decodeUnknownEffect(AssessmentItemFromString)(encoded);

      expect(again).toStrictEqual(value);
    }),
  );

  it.effect("encodes a tree canonically equal to the input tree", () =>
    Effect.gen(function* canonicallyEqual() {
      const input = yield* decodeTree(xml);
      const value = yield* Schema.decodeUnknownEffect(AssessmentItemFromString)(xml);
      const output = yield* Schema.encodeEffect(AssessmentItem)(value);

      // Encode writes `elements` children in declared slot order, so a slot order that differs
      // from the document's child order still re-decodes to a deep-equal value. Only comparing the
      // encoded tree with the input tree catches that order mismatch.
      expect(equivalent(output, input)).toBe(true);
    }),
  );
});

describe("QTI vocabulary as an ordinary Schema.Codec on bg007-true-false.xml", () => {
  it.effect("encodes to a qti-assessment-item element that decodes back to the value", () =>
    Effect.gen(function* bareSchemaRoundTrip() {
      const value = yield* Schema.decodeUnknownEffect(AssessmentItemFromString)(
        readFixture("bg007-true-false.xml"),
      );

      // The printed value is the owner's manual check of the decoded shape.
      console.log(value);

      const element = yield* Schema.encodeEffect(AssessmentItem)(value);

      expect(element.name).toBe("{http://www.imsglobal.org/xsd/imsqtiasi_v3p0}qti-assessment-item");

      const decoded = yield* Schema.decodeUnknownEffect(AssessmentItem)(element);

      expect(decoded).toStrictEqual(value);
    }),
  );
});
