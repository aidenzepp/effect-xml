import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Xml } from "effect/encoding";

/**
 * Decodes a literal document into its event stream.
 *
 * @param text - The XML text to decode.
 * @returns An effect yielding the decoded events, failing with `XmlError`.
 */
const decode = (text: string) =>
  Stream.make(text).pipe(Stream.pipeThroughChannel(Xml.decodeString()), Stream.runCollect);

/**
 * Encodes an event list into XML text.
 *
 * @param events - The events to write.
 * @returns An effect yielding the encoded text, failing with `XmlError`.
 */
const encode = (events: readonly Xml.Event[]) =>
  Stream.fromIterable(events).pipe(Stream.pipeThroughChannel(Xml.encodeString()), Stream.mkString);

/**
 * Encodes literal text as UTF-8 bytes.
 *
 * @param text - The text to encode.
 * @returns The UTF-8 bytes of `text`.
 */
const bytes = (text: string) => new TextEncoder().encode(text);

// This library builds on Effect's own XML event codec. These tests pin the upstream behavior
// it relies on, so an Effect upgrade that changes it fails here first.
describe("effect/encoding/Xml", () => {
  it.effect("decodes a document into start, text, and end events", () =>
    Effect.gen(function* decodesFeed() {
      const events = yield* Stream.make('<feed lang="en"><title>Hi</title></feed>').pipe(
        Stream.pipeThroughChannel(Xml.decodeString()),
        Stream.runCollect,
      );

      expect(events.map((event) => event._tag)).toEqual([
        "StartElement",
        "StartElement",
        "Text",
        "EndElement",
        "EndElement",
      ]);
    }),
  );

  // `resolve` and `collect` keep these events so `mixed` content preserves whitespace.
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

  // `resolve` reads prefixed names and `xmlns` declarations from the raw event (`Xml.ts:301-302`).
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

  // `collect` assembles children in the order text and elements arrive.
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

  // `canonical` excludes self-closing tags from its comparison because the encoder never writes them.
  it.effect("encodes an empty element with an explicit end tag", () =>
    Effect.gen(function* writesEndTag() {
      const text = yield* encode([
        { _tag: "StartElement", attributes: {}, name: "e" },
        { _tag: "EndElement", name: "e" },
      ]);

      expect(text).toBe("<e></e>");
    }),
  );

  // `toEvents` emits a `Declaration` first, so the encoder must accept one at the head.
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

  // D9: an undeclared entity such as `&nbsp;` surfaces as an `XmlError`, not as text.
  it.effect("fails on the &nbsp; entity with an XmlError", () =>
    Effect.gen(function* rejectsNbsp() {
      const error = yield* Effect.flip(decode("<a>x&nbsp;y</a>"));

      expect(Xml.isXmlError(error)).toBe(true);
      expect(error._tag).toBe("XmlError");
    }),
  );

  // `positions` builds its channel on this: one output chunk per input chunk (`Xml.ts:281-282`).
  it.effect("emits one output chunk per input chunk", () =>
    Effect.gen(function* keepsChunks() {
      const chunks = yield* Stream.fromIterable(["<a>", "<b/>", "</a>"]).pipe(
        Stream.rechunk(1),
        Stream.pipeThroughChannel(Xml.decodeString()),
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

  // `issue` strips the ` at line N, column M` suffix and `codec` copies the numbers (`Xml.ts:51-56`, `:1044`).
  it.effect("fails a malformed document with a numeric position matching the message suffix", () =>
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

  // `positions` counts the same way: CRLF is one line end (`Xml.ts:44-45`).
  it.effect("counts a CRLF line end as one line in error positions", () =>
    Effect.gen(function* countsCrlf() {
      const error = yield* Effect.flip(decode("<a>\r\n<b></a>"));

      expect(error.line).toBe(2);
    }),
  );

  // `decodeBytes` depends on `Utf8Input` carrying a split sequence across chunks (`Xml.ts:1683-1693`).
  it.effect("decodes a UTF-8 sequence split across byte chunks like one chunk", () =>
    Effect.gen(function* decodesSplitBytes() {
      const split = yield* Stream.fromIterable([
        bytes("<a>"),
        Uint8Array.of(0xc3),
        Uint8Array.of(0xa9),
        bytes("</a>"),
      ]).pipe(Stream.rechunk(1), Stream.pipeThroughChannel(Xml.decode()), Stream.runCollect);

      const whole = yield* Stream.make(bytes("<a>é</a>")).pipe(
        Stream.pipeThroughChannel(Xml.decode()),
        Stream.runCollect,
      );

      expect(split).toEqual(whole);
    }),
  );

  // `decodeBytes` depends on the byte decoder refusing a non-UTF-8 declaration (`Xml.ts:1475-1480`) that the text decoder accepts (`Xml.ts:285-286`).
  it.effect("rejects a non-UTF-8 encoding declaration from bytes but not from text", () =>
    Effect.gen(function* rejectsDeclaredEncoding() {
      const text = '<?xml version="1.0" encoding="ISO-8859-1"?><a/>';

      const error = yield* Stream.make(bytes(text)).pipe(
        Stream.pipeThroughChannel(Xml.decode()),
        Stream.runCollect,
        Effect.flip,
      );

      const events = yield* decode(text);

      expect(error.kind).toBe("Unsupported");
      expect(events[0]).toMatchObject({ _tag: "Declaration", encoding: "ISO-8859-1" });
    }),
  );

  // `decodeBytes` depends on invalid UTF-8 failing as a syntax error (`Xml.ts:1697-1700`).
  it.effect("fails invalid UTF-8 bytes with a Syntax error", () =>
    Effect.gen(function* rejectsInvalidUtf8() {
      const error = yield* Stream.make(Uint8Array.of(0xff)).pipe(
        Stream.pipeThroughChannel(Xml.decode()),
        Stream.runCollect,
        Effect.flip,
      );

      expect(error.kind).toBe("Syntax");
    }),
  );

  // `collect` (in `resolve`) mirrors `elements` emitting one output chunk per input chunk that completes a record (`Xml.ts:281-282`).
  it.effect("emits elements records one output chunk per input chunk", () =>
    Effect.gen(function* chunksElements() {
      const chunks = yield* Stream.fromIterable([
        "<d><r>1</r><r>2</r><r>3</r>",
        "<r>4",
        "</r></d>",
      ]).pipe(
        Stream.rechunk(1),
        Stream.pipeThroughChannel(Xml.decodeString()),
        Stream.pipeThroughChannel(Xml.elements(["d", "r"])),
        Stream.chunks,
        Stream.runCollect,
      );

      expect(chunks.map((chunk) => chunk.length)).toEqual([3, 1]);
    }),
  );

  // `collect` (in `resolve`) mirrors `elements` emitting the records completed before a `Limit` failure, which has no position (`Xml.ts:1783-1788`).
  it.effect("emits completed records before failing a record with Limit", () =>
    Effect.gen(function* failsAfterRecords() {
      const seen: unknown[] = [];

      const error = yield* Stream.fromIterable(["<d><r>ab</r>", "<r>abcdef</r></d>"]).pipe(
        Stream.rechunk(1),
        Stream.pipeThroughChannel(Xml.decodeString()),
        Stream.pipeThroughChannel(Xml.elements(["d", "r"], { maxElementSize: 4 })),
        Stream.tap((record) => Effect.sync(() => seen.push(record))),
        Stream.runDrain,
        Effect.flip,
      );

      expect(error.kind).toBe("Limit");
      expect(error.line).toBeUndefined();
      expect(error.column).toBeUndefined();
      expect(seen).toHaveLength(1);
    }),
  );

  // `decode` forwards exactly these two `Xml.DecodeOptions` fields and declares them itself in
  // `DecodeStreamOptions`, so their names and their `Limit` failures are pinned here.
  it.effect("enforces maxDepth and maxTokenSize with a Limit error", () =>
    Effect.gen(function* enforcesTokenizerLimits() {
      const limits: readonly Required<Xml.DecodeOptions>[] = [
        { maxDepth: 2, maxTokenSize: Infinity },
        { maxDepth: Infinity, maxTokenSize: 8 },
      ];

      const text = "<a><b><c>deep enough</c></b></a>";

      yield* Stream.make(text).pipe(Stream.pipeThroughChannel(Xml.decodeString()), Stream.runDrain);

      for (const limit of limits) {
        const error = yield* Stream.make(text).pipe(
          Stream.pipeThroughChannel(Xml.decodeString(limit)),
          Stream.runDrain,
          Effect.flip,
        );

        expect(error.kind, JSON.stringify(limit)).toBe("Limit");
      }
    }),
  );

  // `parserError` (in `issue`) reads the limit name and maximum from these messages (`Xml.ts:1077`, `:1365`, `:1368`).
  it.effect("names the limit and its maximum in a tokenizer Limit message", () =>
    Effect.gen(function* namesTokenizerLimit() {
      const depth = yield* Stream.make("<r><i/></r>").pipe(
        Stream.pipeThroughChannel(Xml.decodeString({ maxDepth: 1 })),
        Stream.runDrain,
        Effect.flip,
      );

      const token = yield* Stream.make("<r>a longer text</r>").pipe(
        Stream.pipeThroughChannel(Xml.decodeString({ maxTokenSize: 4 })),
        Stream.runDrain,
        Effect.flip,
      );

      expect(depth.kind).toBe("Limit");
      expect(depth.message).toMatch(/maxDepth of 1/u);
      expect(token.kind).toBe("Limit");
      expect(token.message).toMatch(/maxTokenSize of 4/u);
    }),
  );

  // `collect` (in `resolve`) mirrors `elements` throwing at construction for programming errors (`Xml.ts:449-451`, `:552-558`).
  it("throws at construction for an empty path or a non-positive budget", () => {
    expect(() => Xml.elements([])).toThrow();
    expect(() => Xml.elements(["r"], { maxElementSize: 0 })).toThrow();
  });

  // `resolve` writes names as given: the encoder knows nothing of namespaces (`Xml.ts:1869`).
  it.effect("writes prefixed element and xmlns attribute names as given", () =>
    Effect.gen(function* writesNamesAsGiven() {
      const text = yield* encode([
        { _tag: "StartElement", attributes: { "m:x": "1", "xmlns:m": "v" }, name: "m:b" },
        { _tag: "EndElement", name: "m:b" },
      ]);

      expect(text).toBe('<m:b m:x="1" xmlns:m="v"></m:b>');
    }),
  );

  // `resolve` and `issue` construct and carry an `XmlError` by `kind` and `message` alone, admitted by `isXmlError`.
  it("constructs an XmlError from kind and message without a position", () => {
    const error = new Xml.XmlError({ kind: "Syntax", message: "boom" });

    expect(Xml.isXmlError(error)).toBe(true);
    expect(error._tag).toBe("XmlError");
    expect(error.kind).toBe("Syntax");
    expect(error.message).toBe("boom");
    expect(error.line).toBeUndefined();
  });
});
