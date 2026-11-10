/* oxlint-disable sort-keys -- slot order is encode order; QTI writes the prompt before the choices. */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Xml } from "effect/encoding";

import { decodeSchema, decodeSchemaString } from "../../src/channel.ts";
import { ElementFromString, findDecodeErrorOption, fromString } from "../../src/document.ts";
import { namespaces } from "../../src/dsl.ts";
import { equivalence } from "../../src/equivalence.ts";
import { elements, many, optional, text as textContent } from "../../src/plan.ts";
import type { ElementPath, ElementStep } from "../../src/positions.ts";
import { locate } from "../../src/positions.ts";
import { Tokenizer } from "../../src/tokenizer.ts";
import { AssessmentItem, QTI, XSI } from "../qti/vocabulary.ts";

/**
 * Encodes literal text as UTF-8 bytes.
 *
 * @param text - The text to encode.
 * @returns The UTF-8 bytes of `text`.
 */
const bytes = (text: string) => new TextEncoder().encode(text);

/**
 * The README's choice definitions bind the default namespace to QTI, so every element they
 * declare has a Clark name in that namespace.
 */
const readme = namespaces({ "": QTI });

/**
 * The README's `qti-simple-choice`: an `identifier` attribute and a text content.
 */
const SimpleChoice = readme.Element("qti-simple-choice", {
  attributes: { identifier: Schema.String },
  content: textContent(Schema.String),
});

/**
 * The README's `qti-prompt`: a text content.
 */
const Prompt = readme.Element("qti-prompt", { content: textContent(Schema.String) });

/**
 * The README's `qti-choice-interaction`: an optional prompt before one or more choices.
 */
const ChoiceInteraction = readme.Element("qti-choice-interaction", {
  attributes: { "max-choices": Schema.Int, "response-identifier": Schema.String },
  content: elements({ prompt: optional(Prompt), choices: many(SimpleChoice) }),
});

/**
 * The README document, which {@link ChoiceInteraction} decodes.
 */
const readmeXml = `<qti-choice-interaction xmlns="${QTI}" response-identifier="RESPONSE" max-choices="1">
  <qti-prompt>Pick one</qti-prompt>
  <qti-simple-choice identifier="A">First</qti-simple-choice>
  <qti-simple-choice identifier="B">Second</qti-simple-choice>
</qti-choice-interaction>`;

/**
 * The QTI true-false fixture, which `AssessmentItem` decodes.
 */
const qtiXml = readFileSync(
  new URL("../../spikes/fixtures/qti/bg007-true-false.xml", import.meta.url),
  "utf-8",
);

/**
 * The record path of every `qti-simple-choice` directly under a QTI `bank` root.
 */
const choicePath = [`{${QTI}}bank`, `{${QTI}}qti-simple-choice`];

/**
 * A multi-line bank of three choice records whose third lacks the required `identifier`.
 */
const badThirdRecord = `<bank xmlns="${QTI}">
  <qti-simple-choice identifier="A">First</qti-simple-choice>
  <qti-simple-choice identifier="B">Second</qti-simple-choice>
  <qti-simple-choice>Third</qti-simple-choice>
</bank>`;

/**
 * A multi-line document with a declaration, a comment, a prefixed element, whitespace text, and
 * repeated sibling names, so every `ElementPath` step's local part and index are exercised.
 */
const positionedXml = `<?xml version="1.0"?>
<!-- conformance -->
<root xmlns:m="urn:m">
  <a>one</a>
  <m:b x="1">
    <c/>
    <c>two</c>
  </m:b>
  <a/>
</root>`;

/**
 * Pair every start tag of an event sequence with its positional `ElementPath`: the as-written
 * local part (the text after the first `:`) and the zero-based index among element siblings.
 *
 * @param events - The decoded events, in document order.
 * @returns Each `StartElement` event with the path of the element it opens.
 */
const startPaths = (events: readonly Xml.Event[]) => {
  const open: ElementStep[] = [];
  const started: number[] = [0];
  const starts: { readonly event: Xml.Event; readonly path: ElementPath }[] = [];

  for (const event of events) {
    if (event._tag === "StartElement") {
      const index = started.at(-1) ?? 0;

      started[started.length - 1] = index + 1;
      open.push({ local: event.name.slice(event.name.indexOf(":") + 1), index });
      started.push(0);
      starts.push({ event, path: [...open] });
    } else if (event._tag === "EndElement") {
      open.pop();
      started.pop();
    }
  }

  return starts;
};

/**
 * Registers the tokenizer conformance suite for one `Tokenizer`.
 *
 * The cases pin the upstream `effect/encoding/Xml` behaviour the library relies on, run through the
 * given tokenizer's channels, so a replacement tokenizer proves the same contract the default
 * keeps. The one-output-chunk-per-input-chunk case applies only to a tokenizer without native
 * positions, because position tracking relies on that correspondence only then.
 *
 * @param name - The label that names the tokenizer in the suite title.
 * @param tokenizer - The tokenizer whose channels every case decodes and encodes through.
 */
export const conformance = (name: string, tokenizer: Tokenizer): void => {
  /**
   * Decodes a literal document into its event stream through the tokenizer.
   *
   * @param text - The XML text to decode.
   * @returns An effect yielding the decoded events, failing with `XmlError`.
   */
  const decode = (text: string) =>
    Stream.make(text).pipe(Stream.pipeThroughChannel(tokenizer.decodeString()), Stream.runCollect);

  /**
   * Encodes an event list into XML text through the tokenizer.
   *
   * @param events - The events to write.
   * @returns An effect yielding the encoded text, failing with `XmlError`.
   */
  const encode = (events: readonly Xml.Event[]) =>
    Stream.fromIterable(events).pipe(
      Stream.pipeThroughChannel(tokenizer.encodeString()),
      Stream.mkString,
    );

  describe(`tokenizer conformance: ${name}`, () => {
    it.effect("decodes a document into start, text, and end events", () =>
      Effect.gen(function* decodesFeed() {
        const events = yield* decode('<feed lang="en"><title>Hi</title></feed>');

        expect(events.map((event) => event._tag)).toEqual([
          "StartElement",
          "StartElement",
          "Text",
          "EndElement",
          "EndElement",
        ]);
      }),
    );

    it.effect("emits whitespace-only text between elements inside the root", () =>
      Effect.gen(function* keepsWhitespace() {
        const events = yield* decode("<a>\n  <b/>\n</a>");

        expect(events.map((event) => event._tag)).toEqual([
          "StartElement",
          "Text",
          "StartElement",
          "EndElement",
          "Text",
          "EndElement",
        ]);
        expect(events.filter((event) => event._tag === "Text").map((event) => event.text)).toEqual([
          "\n  ",
          "\n",
        ]);
      }),
    );

    it.effect("reports prefixed names as written and xmlns declarations as attributes", () =>
      Effect.gen(function* keepsPrefixes() {
        const events = yield* decode('<a xmlns="u" xmlns:m="v" m:x="1"><m:b/></a>');

        expect(events[0]).toEqual({
          _tag: "StartElement",
          attributes: { "m:x": "1", xmlns: "u", "xmlns:m": "v" },
          name: "a",
        });
        expect(events[1]).toMatchObject({ _tag: "StartElement", name: "m:b" });
      }),
    );

    it.effect("interleaves text and child events in document order", () =>
      Effect.gen(function* keepsOrder() {
        const events = yield* decode("<p>one<b>two</b>three</p>");

        expect(
          events.map((event) =>
            event._tag === "Text"
              ? `text:${event.text}`
              : `${event._tag}:${event._tag === "StartElement" || event._tag === "EndElement" ? event.name : ""}`,
          ),
        ).toEqual([
          "StartElement:p",
          "text:one",
          "StartElement:b",
          "text:two",
          "EndElement:b",
          "text:three",
          "EndElement:p",
        ]);
      }),
    );

    it.effect("encodes an empty element with an explicit end tag", () =>
      Effect.gen(function* writesEndTag() {
        const text = yield* encode([
          { _tag: "StartElement", attributes: {}, name: "e" },
          { _tag: "EndElement", name: "e" },
        ]);

        expect(text).toBe("<e></e>");
      }),
    );

    it.effect("encodes a stream that starts with a Declaration event", () =>
      Effect.gen(function* acceptsDeclaration() {
        const text = yield* encode([
          { _tag: "Declaration", version: "1.0" },
          { _tag: "StartElement", attributes: {}, name: "e" },
          { _tag: "EndElement", name: "e" },
        ]);

        expect(text).toContain("<e></e>");
        expect(text.startsWith("<?xml")).toBe(true);
      }),
    );

    it.effect("fails on the &nbsp; entity with an XmlError", () =>
      Effect.gen(function* rejectsNbsp() {
        const error = yield* Effect.flip(decode("<a>x&nbsp;y</a>"));

        expect(Xml.isXmlError(error)).toBe(true);
        expect(error._tag).toBe("XmlError");
      }),
    );

    it.effect.skipIf(tokenizer.positions === "native")(
      "emits one output chunk per input chunk",
      () =>
        Effect.gen(function* keepsChunks() {
          const chunks = yield* Stream.fromIterable(["<a>", "<b/>", "</a>"]).pipe(
            Stream.rechunk(1),
            Stream.pipeThroughChannel(tokenizer.decodeString()),
            Stream.chunks,
            Stream.runCollect,
          );

          expect(
            chunks.map((chunk) =>
              chunk.map((event) =>
                event._tag === "StartElement" || event._tag === "EndElement"
                  ? `${event._tag}:${event.name}`
                  : event._tag,
              ),
            ),
          ).toEqual([["StartElement:a"], ["StartElement:b", "EndElement:b"], ["EndElement:a"]]);
        }),
    );

    it.effect(
      "fails a malformed document with a numeric position matching the message suffix",
      () =>
        Effect.gen(function* reportsPosition() {
          const error = yield* Effect.flip(decode("<a><b></a>"));

          expect(Number.isInteger(error.line)).toBe(true);
          expect(Number.isInteger(error.column)).toBe(true);

          const match = / at line (?<line>\d+), column (?<column>\d+)$/u.exec(error.message);

          expect(match).not.toBeNull();
          expect(Number(match?.groups?.line)).toBe(error.line);
          expect(Number(match?.groups?.column)).toBe(error.column);
        }),
    );

    it.effect("counts a CRLF line end as one line in error positions", () =>
      Effect.gen(function* countsCrlf() {
        const error = yield* Effect.flip(decode("<a>\r\n<b></a>"));

        expect(error.line).toBe(2);
      }),
    );

    it.effect("decodes a UTF-8 sequence split across byte chunks like one chunk", () =>
      Effect.gen(function* decodesSplitBytes() {
        const split = yield* Stream.fromIterable([
          bytes("<a>"),
          Uint8Array.of(0xc3),
          Uint8Array.of(0xa9),
          bytes("</a>"),
        ]).pipe(
          Stream.rechunk(1),
          Stream.pipeThroughChannel(tokenizer.decode()),
          Stream.runCollect,
        );

        const whole = yield* Stream.make(bytes("<a>é</a>")).pipe(
          Stream.pipeThroughChannel(tokenizer.decode()),
          Stream.runCollect,
        );

        expect(split).toEqual(whole);
      }),
    );

    it.effect("rejects a non-UTF-8 encoding declaration from bytes but not from text", () =>
      Effect.gen(function* rejectsDeclaredEncoding() {
        const text = '<?xml version="1.0" encoding="ISO-8859-1"?><a/>';

        const error = yield* Stream.make(bytes(text)).pipe(
          Stream.pipeThroughChannel(tokenizer.decode()),
          Stream.runCollect,
          Effect.flip,
        );

        const events = yield* decode(text);

        expect(error.kind).toBe("Unsupported");
        expect(events[0]).toMatchObject({ _tag: "Declaration", encoding: "ISO-8859-1" });
      }),
    );

    it.effect("fails invalid UTF-8 bytes with a Syntax error", () =>
      Effect.gen(function* rejectsInvalidUtf8() {
        const error = yield* Stream.make(Uint8Array.of(0xff)).pipe(
          Stream.pipeThroughChannel(tokenizer.decode()),
          Stream.runCollect,
          Effect.flip,
        );

        expect(error.kind).toBe("Syntax");
      }),
    );

    it.effect("enforces maxDepth and maxTokenSize with a Limit error naming the limit", () =>
      Effect.gen(function* enforcesTokenizerLimits() {
        const limits: readonly Required<Xml.DecodeOptions>[] = [
          { maxDepth: 2, maxTokenSize: Infinity },
          { maxDepth: Infinity, maxTokenSize: 8 },
        ];

        const text = "<a><b><c>deep enough</c></b></a>";

        yield* Stream.make(text).pipe(
          Stream.pipeThroughChannel(tokenizer.decodeString()),
          Stream.runDrain,
        );

        for (const limit of limits) {
          const error = yield* Stream.make(text).pipe(
            Stream.pipeThroughChannel(tokenizer.decodeString(limit)),
            Stream.runDrain,
            Effect.flip,
          );

          const named = Number.isFinite(limit.maxDepth) ? "maxDepth" : "maxTokenSize";

          const match = /\b(?<limit>maxDepth|maxTokenSize) of (?<max>\d+)\b/u.exec(error.message);

          expect(error.kind, JSON.stringify(limit)).toBe("Limit");
          expect(match?.groups?.limit).toBe(named);
          expect(Number(match?.groups?.max)).toBe(limit[named]);
        }
      }),
    );

    it.effect("writes prefixed element and xmlns attribute names as given", () =>
      Effect.gen(function* writesNamesAsGiven() {
        const text = yield* encode([
          { _tag: "StartElement", attributes: { "m:x": "1", "xmlns:m": "v" }, name: "m:b" },
          { _tag: "EndElement", name: "m:b" },
        ]);

        expect(text).toBe('<m:b m:x="1" xmlns:m="v"></m:b>');
      }),
    );

    const roundTripCases = [
      {
        def: ChoiceInteraction,
        label: "the README definitions",
        prefixes: { "": QTI },
        xml: readmeXml,
      },
      {
        def: AssessmentItem,
        label: "the QTI true-false item",
        prefixes: { "": QTI, xsi: XSI },
        xml: qtiXml,
      },
    ] as const;

    for (const { def, label, prefixes, xml } of roundTripCases) {
      it.effect(`round-trips ${label} through fromString and ElementFromString`, () =>
        Effect.gen(function* roundTrips() {
          const codec = fromString(def);
          const tree = ElementFromString(prefixes);

          const value = yield* Schema.decodeUnknownEffect(codec)(xml);
          const encoded = yield* Schema.encodeEffect(codec)(value);
          const again = yield* Schema.decodeUnknownEffect(codec)(encoded);

          const input = yield* Schema.decodeUnknownEffect(tree)(xml);
          const output = yield* Schema.decodeUnknownEffect(tree)(encoded);

          expect(again).toStrictEqual(value);
          expect(equivalence(def)(input, output)).toBe(true);
        }).pipe(Effect.provideService(Tokenizer, tokenizer)),
      );
    }

    it.effect("reports malformed text as WellFormedness with a position", () =>
      Effect.gen(function* reportsWellFormedness() {
        const error = yield* Effect.flip(
          Schema.decodeUnknownEffect(fromString(ChoiceInteraction))(
            readmeXml.replace("</qti-prompt>", ""),
          ),
        );

        const found = Option.getOrUndefined(findDecodeErrorOption(error.issue));

        expect(found?.reason._tag).toBe("WellFormedness");
        expect(Number.isInteger(found?.position?.line)).toBe(true);
        expect(Number.isInteger(found?.position?.column)).toBe(true);
      }).pipe(Effect.provideService(Tokenizer, tokenizer)),
    );

    it.effect("reports a document deeper than maxDepth as a Limit naming maxDepth", () =>
      Effect.gen(function* reportsDepthLimit() {
        const error = yield* Effect.flip(
          Schema.decodeUnknownEffect(fromString(ChoiceInteraction, { maxDepth: 1 }))(readmeXml),
        );

        const found = Option.getOrUndefined(findDecodeErrorOption(error.issue));

        expect(found?.reason).toMatchObject({ _tag: "Limit", limit: "maxDepth", max: 1 });
      }).pipe(Effect.provideService(Tokenizer, tokenizer)),
    );

    it.effect("reports a byte document declaring ISO-8859-1 as Unsupported", () =>
      Effect.gen(function* reportsUnsupported() {
        const error = yield* Stream.make(
          bytes(`<?xml version="1.0" encoding="ISO-8859-1"?>${badThirdRecord}`),
        ).pipe(
          Stream.pipeThroughChannel(decodeSchema(SimpleChoice, choicePath)()),
          Stream.runCollect,
          Effect.flip,
        );

        expect(error.reason._tag).toBe("Unsupported");
      }).pipe(Effect.provideService(Tokenizer, tokenizer)),
    );

    it.effect(
      "reports a rejected third record as SchemaFailure with record 3 and its position",
      () =>
        Effect.gen(function* reportsThirdRecord() {
          const error = yield* Stream.make(badThirdRecord).pipe(
            Stream.pipeThroughChannel(
              decodeSchemaString(SimpleChoice, choicePath)({ positions: true }),
            ),
            Stream.runCollect,
            Effect.flip,
          );

          const third = locate(badThirdRecord, [
            { local: "bank", index: 0 },
            { local: "qti-simple-choice", index: 2 },
          ]);

          expect(error.reason._tag).toBe("SchemaFailure");
          expect(error.record).toBe(3);
          expect(Option.some(error.position)).toEqual(third);
        }).pipe(Effect.provideService(Tokenizer, tokenizer)),
    );

    it.effect.skipIf(tokenizer.positions !== "native")(
      "reports every start tag at the line and column locate finds for its element path",
      () =>
        Effect.gen(function* reportsNativePositions() {
          const events = yield* Stream.make(positionedXml).pipe(
            Stream.pipeThroughChannel(tokenizer.decodeString({ positions: true })),
            Stream.runCollect,
          );

          const starts = startPaths(events);

          expect(starts.length).toBeGreaterThan(1);
          expect(starts.map(({ event }) => event)).toMatchObject(
            starts.map(({ path }) => Option.getOrUndefined(locate(positionedXml, path))),
          );
        }),
    );
  });
};
