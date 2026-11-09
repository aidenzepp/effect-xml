/* oxlint-disable sort-keys -- slot order is encode order; QTI writes the prompt before the choices. */
import { describe, expect, it } from "@effect/vitest";
import type * as Channel from "effect/Channel";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { expectTypeOf } from "vitest";

import { decodeSchema, decodeSchemaString } from "../../src/channel.ts";
import { ElementFromString, fromString } from "../../src/document.ts";
import { namespaces } from "../../src/dsl.ts";
import { elements, many, optional, text } from "../../src/plan.ts";
import { Tokenizer } from "../../src/tokenizer.ts";
import { spyTokenizer } from "./fakes.ts";
import type { TokenizerCall, TokenizerSpy } from "./fakes.ts";

/**
 * The QTI 3.0 namespace every element of the fixture document belongs to.
 */
const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

/**
 * The element constructor that binds unprefixed names to {@link QTI}.
 */
const { Element } = namespaces({ "": QTI });

/**
 * The codec of one choice, the record every channel run decodes.
 */
const SimpleChoice = Element("qti-simple-choice", {
  attributes: { identifier: Schema.String },
  content: text(Schema.String),
});

/**
 * The codec of the interaction's optional prompt.
 */
const Prompt = Element("qti-prompt", { content: text(Schema.String) });

/**
 * The service-free codec of the document root.
 */
const ChoiceInteraction = Element("qti-choice-interaction", {
  attributes: { "max-choices": Schema.Int, "response-identifier": Schema.String },
  content: elements({ prompt: optional(Prompt), choices: many(SimpleChoice) }),
});

/**
 * The fixture document: one interaction holding a prompt and two choices.
 */
const xml = `<qti-choice-interaction xmlns="${QTI}" response-identifier="RESPONSE" max-choices="1">
  <qti-prompt>Pick one</qti-prompt>
  <qti-simple-choice identifier="A">First</qti-simple-choice>
  <qti-simple-choice identifier="B">Second</qti-simple-choice>
</qti-choice-interaction>`;

/**
 * The root-anchored record path of every choice in {@link xml}.
 */
const choicePath = [`{${QTI}}qti-choice-interaction`, `{${QTI}}qti-simple-choice`];

/**
 * The namespace each prefix of an encoded resolved element binds; the default prefix binds
 * {@link QTI}.
 */
const prefixes = { "": QTI };

/**
 * Split `source` into pieces of at most `size` characters, so a channel sees several chunks.
 *
 * @param source - The text to split.
 * @param size - The largest piece length.
 * @returns The pieces in order; their concatenation is `source`.
 */
const splitEvery = (source: string, size: number): string[] =>
  Array.from({ length: Math.ceil(source.length / size) }, (_, index) =>
    source.slice(index * size, (index + 1) * size),
  );

/**
 * Stream {@link xml} as text chunks of seven characters.
 */
const textChunks = (): Stream.Stream<string> => Stream.fromIterable(splitEvery(xml, 7));

/**
 * Stream {@link xml} as UTF-8 byte chunks, one per seven-character text chunk.
 */
const byteChunks = (): Stream.Stream<Uint8Array> =>
  textChunks().pipe(Stream.map((chunk) => new TextEncoder().encode(chunk)));

/**
 * Read the distinct factory names a spy recorded, in first-call order.
 *
 * @param spy - The spy whose calls are read.
 * @returns Each recorded factory name once.
 */
const factoriesOf = (spy: TokenizerSpy): TokenizerCall["factory"][] => [
  ...new Set(spy.calls.map((call) => call.factory)),
];

/**
 * Read the identifiers of decoded choices, in record order.
 *
 * @param choices - The decoded choice records.
 * @returns Their `identifier` attributes.
 */
const identifiersOf = (choices: Iterable<(typeof SimpleChoice)["Type"]>): string[] =>
  Array.from(choices, (choice) => choice.identifier);

/**
 * The identifiers of the choices in {@link xml}, read from the fixture once.
 */
const expectedIdentifiers = Array.from(
  xml.matchAll(/\sidentifier="(?<identifier>[^"]+)"/gu),
  (match) => match.groups?.identifier,
);

/**
 * Read the environment a channel requires.
 */
type ChannelServices<C> =
  C extends Channel.Channel<
    infer _OutElem,
    infer _OutErr,
    infer _OutDone,
    infer _InElem,
    infer _InErr,
    infer _InDone,
    infer Env
  >
    ? Env
    : never;

describe("an overriding Tokenizer", () => {
  it.effect("decodes fromString through the provided decodeString", () =>
    Effect.gen(function* decodeThroughSpy() {
      const spy = spyTokenizer();

      const value = yield* Schema.decodeUnknownEffect(fromString(ChoiceInteraction))(xml).pipe(
        Effect.provideService(Tokenizer, spy.tokenizer),
      );

      expect(identifiersOf(value.choices)).toStrictEqual(expectedIdentifiers);
      expect(factoriesOf(spy)).toStrictEqual(["decodeString"]);
    }),
  );

  it.effect("encodes fromString and ElementFromString through the provided encodeString", () =>
    Effect.gen(function* encodeThroughSpy() {
      const value = yield* Schema.decodeUnknownEffect(fromString(ChoiceInteraction))(xml);
      const tree = yield* Schema.decodeUnknownEffect(ElementFromString(prefixes))(xml);

      const valueSpy = spyTokenizer();
      const treeSpy = spyTokenizer();

      const valueText = yield* Schema.encodeEffect(fromString(ChoiceInteraction))(value).pipe(
        Effect.provideService(Tokenizer, valueSpy.tokenizer),
      );

      const treeText = yield* Schema.encodeEffect(ElementFromString(prefixes))(tree).pipe(
        Effect.provideService(Tokenizer, treeSpy.tokenizer),
      );

      expect(valueText).toMatch(/<qti-choice-interaction\b/u);
      expect(treeText).toMatch(/<qti-choice-interaction\b/u);
      expect(factoriesOf(valueSpy)).toStrictEqual(["encodeString"]);
      expect(factoriesOf(treeSpy)).toStrictEqual(["encodeString"]);
    }),
  );

  it.effect(
    "decodes decodeSchemaString through the provided decodeString with and without positions",
    () =>
      Effect.gen(function* decodeTextThroughSpy() {
        for (const positions of [false, true]) {
          const spy = spyTokenizer();

          const choices = yield* Stream.runCollect(
            textChunks().pipe(
              Stream.pipeThroughChannel(
                decodeSchemaString(SimpleChoice, choicePath)({ positions }),
              ),
            ),
          ).pipe(Effect.provideService(Tokenizer, spy.tokenizer));

          expect(identifiersOf(choices)).toStrictEqual(expectedIdentifiers);
          expect(factoriesOf(spy)).toStrictEqual(["decodeString"]);
        }
      }),
  );

  it.effect(
    "decodes decodeSchema through decode without positions and decodeString with them",
    () =>
      Effect.gen(function* decodeBytesThroughSpy() {
        const plainSpy = spyTokenizer();
        const positionedSpy = spyTokenizer();

        const plain = yield* Stream.runCollect(
          byteChunks().pipe(Stream.pipeThroughChannel(decodeSchema(SimpleChoice, choicePath)())),
        ).pipe(Effect.provideService(Tokenizer, plainSpy.tokenizer));

        const positioned = yield* Stream.runCollect(
          byteChunks().pipe(
            Stream.pipeThroughChannel(decodeSchema(SimpleChoice, choicePath)({ positions: true })),
          ),
        ).pipe(Effect.provideService(Tokenizer, positionedSpy.tokenizer));

        expect(identifiersOf(plain)).toStrictEqual(expectedIdentifiers);
        expect(identifiersOf(positioned)).toStrictEqual(expectedIdentifiers);
        expect(factoriesOf(plainSpy)).toStrictEqual(["decode"]);
        expect(factoriesOf(positionedSpy)).toStrictEqual(["decodeString"]);
      }),
  );

  it.effect("leaves an unprovided spy unread while every route still succeeds", () =>
    Effect.gen(function* decodeWithoutSpy() {
      const spy = spyTokenizer();

      const value = yield* Schema.decodeUnknownEffect(fromString(ChoiceInteraction))(xml);
      const tree = yield* Schema.decodeUnknownEffect(ElementFromString(prefixes))(xml);
      const valueText = yield* Schema.encodeEffect(fromString(ChoiceInteraction))(value);
      const treeText = yield* Schema.encodeEffect(ElementFromString(prefixes))(tree);

      const routes = [
        textChunks().pipe(
          Stream.pipeThroughChannel(decodeSchemaString(SimpleChoice, choicePath)()),
        ),
        textChunks().pipe(
          Stream.pipeThroughChannel(
            decodeSchemaString(SimpleChoice, choicePath)({ positions: true }),
          ),
        ),
        byteChunks().pipe(Stream.pipeThroughChannel(decodeSchema(SimpleChoice, choicePath)())),
        byteChunks().pipe(
          Stream.pipeThroughChannel(decodeSchema(SimpleChoice, choicePath)({ positions: true })),
        ),
      ];

      for (const route of routes) {
        expect(identifiersOf(yield* Stream.runCollect(route))).toStrictEqual(expectedIdentifiers);
      }

      expect(identifiersOf(value.choices)).toStrictEqual(expectedIdentifiers);
      expect(valueText).toMatch(/<qti-choice-interaction\b/u);
      expect(treeText).toMatch(/<qti-choice-interaction\b/u);
      expect(spy.calls).toHaveLength(0);
    }),
  );

  it("adds nothing to the requirements of a service-free codec", () => {
    const decoded = Schema.decodeUnknownEffect(fromString(ChoiceInteraction))(xml);

    expectTypeOf<Effect.Services<typeof decoded>>().toEqualTypeOf<never>();
    expectTypeOf<
      ChannelServices<ReturnType<ReturnType<typeof decodeSchemaString<typeof SimpleChoice>>>>
    >().toEqualTypeOf<never>();
    expectTypeOf<
      ChannelServices<ReturnType<ReturnType<typeof decodeSchema<typeof SimpleChoice>>>>
    >().toEqualTypeOf<never>();
  });
});
