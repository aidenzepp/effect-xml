import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { decodeSchema, decodeSchemaString } from "../../src/channel.ts";
import { findDecodeErrorOption, fromString } from "../../src/document.ts";
import { namespaces } from "../../src/dsl.ts";
import { elements, many, text } from "../../src/plan.ts";
import { Tokenizer } from "../../src/tokenizer.ts";
import { conformance } from "./conformance.ts";
import { honestNativeTokenizer, shiftedNativeTokenizer } from "./fakes.ts";

conformance("honest native", honestNativeTokenizer);

/**
 * The QTI 3.0 namespace every element of the fixture documents belongs to.
 */
const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

/**
 * The element constructor that binds unprefixed names to {@link QTI}.
 */
const { Element } = namespaces({ "": QTI });

/**
 * The codec of one choice, which requires an `identifier` attribute.
 */
const SimpleChoice = Element("qti-simple-choice", {
  attributes: { identifier: Schema.String },
  content: text(Schema.String),
});

/**
 * The codec of a bank of choices, the root of the whole-document decode.
 */
const Bank = Element("bank", { content: elements({ choices: many(SimpleChoice) }) });

/**
 * A short bank whose second choice lacks the required `identifier`, so every route fails on a
 * line far below the 1000 lines the shifted tokenizer adds.
 */
const badSecondChoice = `<bank xmlns="${QTI}">
  <qti-simple-choice identifier="A">First</qti-simple-choice>
  <qti-simple-choice>Second</qti-simple-choice>
</bank>`;

/**
 * The record path of every `qti-simple-choice` directly under the QTI `bank` root.
 */
const choicePath = [`{${QTI}}bank`, `{${QTI}}qti-simple-choice`];

/**
 * The line offset `shiftedNativeTokenizer` adds to each start tag; a failure at or below it read
 * the native position instead of scanning the input.
 */
const shift = 1000;

describe("a native-position Tokenizer", () => {
  it.effect("positions a fromString failure at the native start-tag line", () =>
    Effect.gen(function* positionsDocument() {
      const error = yield* Effect.flip(
        Schema.decodeUnknownEffect(fromString(Bank))(badSecondChoice),
      );

      const found = Option.getOrUndefined(findDecodeErrorOption(error.issue));

      expect(found?.position?.line).toBeGreaterThanOrEqual(shift);
    }).pipe(Effect.provideService(Tokenizer, shiftedNativeTokenizer)),
  );

  it.effect("positions a decodeSchemaString failure at the native start-tag line", () =>
    Effect.gen(function* positionsText() {
      const error = yield* Stream.make(badSecondChoice).pipe(
        Stream.pipeThroughChannel(
          decodeSchemaString(SimpleChoice, choicePath)({ positions: true }),
        ),
        Stream.runCollect,
        Effect.flip,
      );

      expect(error.position?.line).toBeGreaterThanOrEqual(shift);
    }).pipe(Effect.provideService(Tokenizer, shiftedNativeTokenizer)),
  );

  it.effect("positions a decodeSchema failure at the native start-tag line", () =>
    Effect.gen(function* positionsBytes() {
      const error = yield* Stream.make(new TextEncoder().encode(badSecondChoice)).pipe(
        Stream.pipeThroughChannel(decodeSchema(SimpleChoice, choicePath)({ positions: true })),
        Stream.runCollect,
        Effect.flip,
      );

      expect(error.position?.line).toBeGreaterThanOrEqual(shift);
    }).pipe(Effect.provideService(Tokenizer, shiftedNativeTokenizer)),
  );
});
