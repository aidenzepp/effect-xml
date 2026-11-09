import { describe, expect, it } from "@effect/vitest";
import type * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Channel from "effect/Channel";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as Stream from "effect/Stream";
import * as Tracer from "effect/Tracer";
import { expectTypeOf } from "vitest";

import { ItemRef, QTI, Upper, expectFailedSpan, fixtureText, issueCount } from "../test/support.ts";
import { honestNativeTokenizer, shiftedNativeTokenizer } from "../test/tokenizer/fakes.ts";
import { decodeSchema, decodeSchemaString } from "./channel.ts";
import { Element, namespaces } from "./dsl.ts";
import { clark } from "./element.ts";
import type { XmlDecodeError } from "./issue.ts";
import { defaultMaxElementNodes } from "./resolve.ts";
import { Tokenizer, defaultTokenizer } from "./tokenizer.ts";
import type { TokenizerDecodeOptions } from "./tokenizer.ts";

/**
 * The root-anchored path from the fixture's test root to its item refs, in Clark names.
 */
const recordPath = [
  clark(Option.some(QTI), "qti-assessment-test"),
  clark(Option.some(QTI), "qti-test-part"),
  clark(Option.some(QTI), "qti-assessment-section"),
  clark(Option.some(QTI), "qti-assessment-item-ref"),
];

/**
 * The fixture with the third item ref's weight value made non-numeric, so that record fails with
 * reason `SchemaFailure` at its weight's `value` attribute.
 */
const failingThirdText = fixtureText.replace('value="1.5"', 'value="x"');

/**
 * A one-record item-ref document whose XML declaration names `ISO-8859-1`, an encoding the byte
 * parser rejects and the text parser ignores.
 */
const latin1Text = `<?xml version="1.0" encoding="ISO-8859-1"?><qti-assessment-item-ref xmlns="${QTI}" identifier="x" href="x"/>`;

/**
 * The root-anchored path to the item ref that is the root of {@link latin1Text}.
 */
const itemRefRoot = [clark(Option.some(QTI), "qti-assessment-item-ref")];

/**
 * Cut `source` into consecutive pieces of `size` characters, the last one shorter when `size` does
 * not divide the length.
 *
 * @param source - The text to cut.
 * @param size - The length of every piece but the last.
 * @returns The pieces in order.
 */
const splitEvery = (source: string, size: number): string[] => {
  const chunks: string[] = [];

  for (let offset = 0; offset < source.length; offset += size) {
    chunks.push(source.slice(offset, offset + size));
  }

  return chunks;
};

/**
 * Cut `bytes` into consecutive pieces of `size` bytes, the last one shorter when `size` does not
 * divide the length.
 *
 * @param bytes - The bytes to cut.
 * @param size - The length of every piece but the last.
 * @returns The pieces in order.
 */
const splitBytesEvery = (bytes: Uint8Array, size: number): Uint8Array[] => {
  const chunks: Uint8Array[] = [];

  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(bytes.subarray(offset, offset + size));
  }

  return chunks;
};

/**
 * The text of `source` as a stream of 7-character chunks.
 *
 * @param source - The document text.
 * @returns The text stream.
 */
const textOf = (source: string): Stream.Stream<string> =>
  Stream.fromIterable(splitEvery(source, 7));

/**
 * The UTF-8 bytes of `source` as a stream of 7-byte chunks.
 *
 * @param source - The document text.
 * @returns The byte stream.
 */
const bytesOf = (source: string): Stream.Stream<Uint8Array> =>
  Stream.fromIterable(splitBytesEvery(new TextEncoder().encode(source), 7));

/**
 * Compute the one-based line and column of the third item ref's `<qti-weight` start tag in
 * `source`, the position a positioned decode reports for that record's rejected weight value.
 *
 * @param source - The document text holding the item ref with identifier `sea-stars`.
 * @returns The start tag's line and column.
 */
const thirdWeightPosition = (source: string) => {
  const at = source.indexOf("<qti-weight", source.indexOf('identifier="sea-stars"'));
  const line = source.slice(0, at).split("\n").length;
  const column = at - source.lastIndexOf("\n", at - 1);

  return { column, line };
};

/**
 * Run `effect` under a recording tracer and return each span's name with the attributes it ended
 * with.
 *
 * @param effect - The effect to run; its success and failure are both discarded.
 * @returns One entry per span the tracer created, in creation order.
 */
const spanAttributes = (effect: Effect.Effect<unknown, unknown>) =>
  Effect.gen(function* recordAttributes() {
    const recorded: { readonly name: string; readonly attributes: Map<string, unknown> }[] = [];

    const tracer = Tracer.make({
      span: (options) => {
        const attributes = new Map<string, unknown>();

        recorded.push({ attributes, name: options.name });

        const span = new Tracer.NativeSpan(options);
        const attribute = span.attribute.bind(span);

        span.attribute = (key, value) => {
          attributes.set(key, value);
          attribute(key, value);
        };

        return span;
      },
    });

    yield* effect.pipe(Effect.exit, Effect.withTracer(tracer));

    return recorded;
  });

/**
 * Assert that `stream` fails, never dies, with reason `WellFormedness` caused by an `Xml.XmlError`
 * of kind `Syntax`, and with neither a `position` nor a `record`, as malformed UTF-8 fails.
 *
 * @param stream - The decoded stream of a byte input holding malformed UTF-8.
 * @returns An effect that succeeds once the assertions hold.
 */
const expectInvalidUtf8 = (stream: Stream.Stream<unknown, XmlDecodeError>) =>
  Effect.gen(function* invalidUtf8() {
    const exit = yield* Effect.exit(Stream.runDrain(stream));

    expect(Exit.isFailure(exit)).toBe(true);

    if (!Exit.isFailure(exit)) {
      return;
    }

    expect(Cause.hasDies(exit.cause)).toBe(false);

    const error = Option.getOrUndefined(Cause.findErrorOption(exit.cause));

    expect(error?.reason).toMatchObject({ _tag: "WellFormedness", cause: { kind: "Syntax" } });
    expect(error?.position).toBeUndefined();
    expect(error !== undefined && Object.hasOwn(error, "record")).toBe(false);
  });

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

/**
 * Eight pieces of one item-ref document, each holding one complete item ref: the first also opens
 * the test, test part, and section, and the last also closes them.
 */
const recordPieces: readonly string[] = Array.from({ length: 8 }, (_, index) => {
  const ref = `<qti-assessment-item-ref identifier="r${index}" href="r${index}.xml"/>`;

  if (index === 0) {
    return `<qti-assessment-test xmlns="${QTI}"><qti-test-part><qti-assessment-section>${ref}`;
  }

  return index === 7
    ? `${ref}</qti-assessment-section></qti-test-part></qti-assessment-test>`
    : ref;
});

/**
 * A tokenizer that counts the input elements its decoders receive, with the live count.
 */
interface CountingTokenizer {
  readonly tokenizer: Tokenizer;
  readonly received: { count: number };
}

/**
 * Construct a tokenizer that delegates to {@link defaultTokenizer} and counts the input elements
 * its `decodeString` and `decode` channels receive, so a test can tell how much input the parser
 * had pulled when a record left the channel.
 *
 * @returns The counting tokenizer and the live count of input elements it has received.
 */
const countingTokenizer = (): CountingTokenizer => {
  const received = { count: 0 };

  const tokenizer: Tokenizer = {
    decode: <IE = never, Done = unknown>(options?: TokenizerDecodeOptions) =>
      Channel.identity<Arr.NonEmptyReadonlyArray<Uint8Array>, IE, Done>().pipe(
        Channel.map((chunk) => {
          received.count += chunk.length;

          return chunk;
        }),
        Channel.pipeTo(defaultTokenizer.decode<IE, Done>(options)),
      ),
    decodeString: <IE = never, Done = unknown>(options?: TokenizerDecodeOptions) =>
      Channel.identity<Arr.NonEmptyReadonlyArray<string>, IE, Done>().pipe(
        Channel.map((chunk) => {
          received.count += chunk.length;

          return chunk;
        }),
        Channel.pipeTo(defaultTokenizer.decodeString<IE, Done>(options)),
      ),
    encode: defaultTokenizer.encode,
    encodeString: defaultTokenizer.encodeString,
    positions: defaultTokenizer.positions,
  };

  const counting: CountingTokenizer = { received, tokenizer };

  return counting;
};

/**
 * Run a stream of decoded item refs under a {@link countingTokenizer} and report how many input
 * elements the parser had received when the first record was emitted.
 *
 * @param refs - The decoded item-ref stream, read with the provided `Tokenizer` when it runs.
 * @returns The input count at the first record and the identifier of every record, in order.
 */
const countAtFirstRecord = (refs: Stream.Stream<{ readonly identifier: string }, XmlDecodeError>) =>
  Effect.gen(function* countsFirstRecord() {
    const { received, tokenizer } = countingTokenizer();
    const seen: number[] = [];

    const decoded = yield* refs.pipe(
      Stream.tap(() => Effect.sync(() => seen.push(received.count))),
      Stream.runCollect,
      Effect.provideService(Tokenizer, tokenizer),
    );

    return { atFirst: seen[0], identifiers: decoded.map((ref) => ref.identifier) };
  });

describe("decodeSchemaString and decodeSchema", () => {
  it.effect("decode every item ref of a text stream and a byte stream alike, in order", () =>
    Effect.gen(function* decodesBothKinds() {
      const fromText = yield* Stream.runCollect(
        textOf(fixtureText).pipe(
          Stream.pipeThroughChannel(decodeSchemaString(ItemRef, recordPath)()),
        ),
      );

      const fromBytes = yield* Stream.runCollect(
        bytesOf(fixtureText).pipe(Stream.pipeThroughChannel(decodeSchema(ItemRef, recordPath)())),
      );

      expect(fromText).toHaveLength(6);
      expect(fromBytes).toStrictEqual(fromText);
      expect(fromText.map((ref) => ref.identifier)).toStrictEqual([
        "barnacles",
        "anemones",
        "sea-stars",
        "flood",
        "tide-range",
        "moon",
      ]);
      expect(fromText[1]?.fixed).toBe(true);
      expect(fromText[2]?.required).toBe(true);
      expect(fromText[3]?.rules).toHaveLength(1);
      expect(fromText[3]?.rules[0]?.target).toBe("moon");
    }),
  );

  it.effect("decode the same item refs through a wildcard path", () =>
    Effect.gen(function* decodesWildcard() {
      const refs = yield* Stream.runCollect(
        textOf(fixtureText).pipe(
          Stream.pipeThroughChannel(
            decodeSchemaString(ItemRef, [
              "*",
              "*",
              "*",
              clark(Option.some(QTI), "qti-assessment-item-ref"),
            ])(),
          ),
        ),
      );

      expect(refs.map((ref) => ref.identifier)).toStrictEqual([
        "barnacles",
        "anemones",
        "sea-stars",
        "flood",
        "tide-range",
        "moon",
      ]);
    }),
  );

  it.effect("fail a rejected record with reason SchemaFailure on its record ordinal", () =>
    Effect.gen(function* failsRecord() {
      const seen: string[] = [];

      const error = yield* textOf(failingThirdText).pipe(
        Stream.pipeThroughChannel(decodeSchemaString(ItemRef, recordPath)()),
        Stream.tap((ref) => Effect.sync(() => seen.push(ref.identifier))),
        Stream.runDrain,
        Effect.flip,
      );

      expect(error.reason._tag).toBe("SchemaFailure");
      expect(error.path).toBe("/qti-assessment-item-ref/qti-weight/@value");
      expect(error.record).toBe(3);
      expect(Object.hasOwn(error, "position")).toBe(false);
      expect(error.message).toMatch(/of record 3/u);
      expect(seen).toStrictEqual(["barnacles", "anemones"]);
    }),
  );

  it.effect("fail malformed text with reason WellFormedness at the parser's position", () =>
    Effect.gen(function* failsMalformed() {
      const error = yield* Stream.fromIterable([...splitEvery(fixtureText, 7), "</oops>"]).pipe(
        Stream.pipeThroughChannel(decodeSchemaString(ItemRef, recordPath)()),
        Stream.runDrain,
        Effect.flip,
      );

      const { reason } = error;

      expect(reason._tag).toBe("WellFormedness");
      expect(Object.hasOwn(error, "record")).toBe(false);

      if (reason._tag !== "WellFormedness") {
        return;
      }

      const { column, line } = reason.cause;

      expect(error.position).toStrictEqual({ column, line });
    }),
  );

  it.effect("parse each string of one input chunk on its own pull, so a record leaves early", () =>
    Effect.gen(function* streamsWithinChunk() {
      const expected = recordPieces.map((_, index) => `r${index}`);

      const text = yield* countAtFirstRecord(
        Stream.fromIterable(recordPieces).pipe(
          Stream.pipeThroughChannel(decodeSchemaString(ItemRef, recordPath)()),
        ),
      );

      const bytes = yield* countAtFirstRecord(
        Stream.fromIterable(recordPieces.map((piece) => new TextEncoder().encode(piece))).pipe(
          Stream.pipeThroughChannel(decodeSchema(ItemRef, recordPath)()),
        ),
      );

      for (const [label, run] of Object.entries({ bytes, text })) {
        expect(run.atFirst, label).toBeLessThan(recordPieces.length);
        expect(run.identifiers, label).toStrictEqual(expected);
      }
    }),
  );

  it.live(
    "release a positioned record before waiting on upstream when its string ends in markup with <",
    () =>
      Effect.gen(function* positionedTail() {
        const Item = Element("x", { attributes: { id: Schema.String } });

        for (const tail of ["<!-- a < b -->", "<![CDATA[a<b]]>", "<?pi a<b?>"]) {
          const first = yield* Stream.make(`<r><x id="1"/>${tail}`).pipe(
            Stream.concat(Stream.never),
            Stream.pipeThroughChannel(decodeSchemaString(Item, ["r", "x"])({ positions: true })),
            Stream.take(1),
            Stream.runCollect,
            Effect.timeoutOption("1 second"),
          );

          expect(
            Option.match(first, { onNone: () => 0, onSome: (records) => records.length }),
            tail,
          ).toBe(1);
        }
      }),
  );

  it.live(
    "release a positioned record before waiting on upstream after a DOCTYPE subset comment or trailing text",
    () =>
      Effect.gen(function* positionedHolds() {
        const Item = Element("x", { attributes: { id: Schema.String } });

        const inputs = [
          `<!DOCTYPE r [<!-- it's -->]><r><x id="1"/><!-- don't ] > <b <c`,
          `<!DOCTYPE r [<!-- [ -->]><r><x id="1"/><!-- a ] > <b <c`,
          `<!DOCTYPE r [<?p [ ?>]><r><x id="1"/><?q ] > <b <c`,
          `<r><x id="1"/>`,
          `<r><x id="1"/>\n`,
        ];

        for (const input of inputs) {
          const text = yield* Stream.make(input).pipe(
            Stream.concat(Stream.never),
            Stream.pipeThroughChannel(decodeSchemaString(Item, ["r", "x"])({ positions: true })),
            Stream.take(1),
            Stream.runCollect,
            Effect.timeoutOption("1 second"),
          );

          const bytes = yield* Stream.make(new TextEncoder().encode(input)).pipe(
            Stream.concat(Stream.never),
            Stream.pipeThroughChannel(decodeSchema(Item, ["r", "x"])({ positions: true })),
            Stream.take(1),
            Stream.runCollect,
            Effect.timeoutOption("1 second"),
          );

          for (const [label, first] of Object.entries({ bytes, text })) {
            expect(
              Option.match(first, { onNone: () => 0, onSome: (records) => records.length }),
              `${label} ${input}`,
            ).toBe(1);
          }
        }
      }),
  );

  it.effect(
    "fail a malformed tag that ends a string before an upstream failure, with positions as without",
    () =>
      Effect.gen(function* malformedBeforeUpstream() {
        const Item = Element("x", { attributes: { id: Schema.String } });
        const input = "<r><x b>";

        const failure = (positions: boolean) =>
          Effect.all({
            bytes: Stream.make(new TextEncoder().encode(input)).pipe(
              Stream.concat(Stream.fail("upstream" as const)),
              Stream.pipeThroughChannel(decodeSchema(Item, ["r", "x"])({ positions })),
              Stream.runDrain,
              Effect.flip,
            ),
            text: Stream.make(input).pipe(
              Stream.concat(Stream.fail("upstream" as const)),
              Stream.pipeThroughChannel(decodeSchemaString(Item, ["r", "x"])({ positions })),
              Stream.runDrain,
              Effect.flip,
            ),
          });

        const off = yield* failure(false);
        const on = yield* failure(true);

        for (const [label, error] of Object.entries(off)) {
          expect(error === "upstream" ? error : error.reason._tag, label).toBe("WellFormedness");
        }

        expect(on).toStrictEqual(off);
      }),
  );

  it("throw on an empty path at the factory and on a non-positive budget at construction", () => {
    expect(() => decodeSchemaString(ItemRef, [])).toThrow(/record path is empty/u);
    expect(() => decodeSchema(ItemRef, [])).toThrow(/record path is empty/u);
    expect(() => decodeSchemaString(ItemRef, recordPath)({ maxElementNodes: 0 })).toThrow(
      /maxElementNodes must be a positive number/u,
    );
    expect(() => decodeSchema(ItemRef, recordPath)({ maxElementSize: -1 })).toThrow(
      /maxElementSize must be a positive number/u,
    );
  });

  it("type the input kind into the channel, so a text stream does not reach decodeSchema", () => {
    const text: Stream.Stream<string> = textOf(fixtureText);

    // @ts-expect-error -- decodeSchema reads byte chunks only; a text stream needs decodeSchemaString.
    expect(text.pipe(Stream.pipeThroughChannel(decodeSchema(ItemRef, recordPath)()))).toBeDefined();
  });

  it.effect("open one span per channel with its attributes and the record count", () =>
    Effect.gen(function* spanOnSuccess() {
      const runs = [
        {
          name: "xml.decodeSchemaString",
          run: Stream.runDrain(
            textOf(fixtureText).pipe(
              Stream.pipeThroughChannel(decodeSchemaString(ItemRef, recordPath)()),
            ),
          ),
        },
        {
          name: "xml.decodeSchema",
          run: Stream.runDrain(
            bytesOf(fixtureText).pipe(
              Stream.pipeThroughChannel(decodeSchema(ItemRef, recordPath)()),
            ),
          ),
        },
      ];

      for (const { name, run } of runs) {
        const spans = yield* spanAttributes(run);

        expect(spans.map((span) => span.name)).toStrictEqual([name]);

        const attributes = spans[0]?.attributes;

        expect(attributes?.get("xml.path")).toMatch(/^\//u);
        expect(attributes?.get("xml.maxElementSize")).toBe(16_777_216);
        expect(attributes?.get("xml.maxElementNodes")).toBe(defaultMaxElementNodes);
        expect(attributes?.get("xml.positions")).toBe(false);
        expect(attributes?.get("xml.records")).toBe(6);
      }
    }),
  );

  it.effect("leave the count of records emitted on the span when the third record fails", () =>
    Effect.gen(function* spanOnFailure() {
      const spans = yield* spanAttributes(
        Stream.runDrain(
          textOf(failingThirdText).pipe(
            Stream.pipeThroughChannel(decodeSchemaString(ItemRef, recordPath)()),
          ),
        ),
      );

      expect(spans.map((span) => span.name)).toStrictEqual(["xml.decodeSchemaString"]);
      expect(spans[0]?.attributes.get("xml.records")).toBe(2);
    }),
  );

  it.effect("end the xml.decodeSchemaString span in failure when a record fails", () =>
    expectFailedSpan(
      "xml.decodeSchemaString",
      Stream.runDrain(
        textOf(failingThirdText).pipe(
          Stream.pipeThroughChannel(decodeSchemaString(ItemRef, recordPath)()),
        ),
      ),
    ),
  );

  it.effect("end the xml.decodeSchema span in failure when a record fails", () =>
    expectFailedSpan(
      "xml.decodeSchema",
      Stream.runDrain(
        bytesOf(failingThirdText).pipe(
          Stream.pipeThroughChannel(decodeSchema(ItemRef, recordPath)()),
        ),
      ),
    ),
  );

  it.effect("position a rejected record at its element's start tag with positions true", () =>
    Effect.gen(function* positionsText() {
      const error = yield* textOf(failingThirdText).pipe(
        Stream.pipeThroughChannel(decodeSchemaString(ItemRef, recordPath)({ positions: true })),
        Stream.runDrain,
        Effect.flip,
      );

      expect(error.reason._tag).toBe("SchemaFailure");
      expect(error.record).toBe(3);
      expect(error.path).toBe("/qti-assessment-item-ref/qti-weight/@value");
      expect(error.position).toStrictEqual(thirdWeightPosition(failingThirdText));
    }),
  );

  it.effect("position the same rejected record from a byte stream with positions true", () =>
    Effect.gen(function* positionsBytes() {
      const error = yield* bytesOf(failingThirdText).pipe(
        Stream.pipeThroughChannel(decodeSchema(ItemRef, recordPath)({ positions: true })),
        Stream.runDrain,
        Effect.flip,
      );

      expect(error.reason._tag).toBe("SchemaFailure");
      expect(error.record).toBe(3);
      expect(error.position).toStrictEqual(thirdWeightPosition(failingThirdText));
    }),
  );

  it.effect("fail invalid UTF-8 with reason WellFormedness under positions true", () =>
    expectInvalidUtf8(
      Stream.make(Uint8Array.of(0xff)).pipe(
        Stream.pipeThroughChannel(decodeSchema(ItemRef, recordPath)({ positions: true })),
      ),
    ),
  );

  it.effect("fail a byte stream ending inside a multi-byte sequence from the flush", () =>
    expectInvalidUtf8(
      Stream.fromIterable([new TextEncoder().encode("<a>"), Uint8Array.of(0xc3)]).pipe(
        Stream.pipeThroughChannel(decodeSchema(ItemRef, recordPath)({ positions: true })),
      ),
    ),
  );

  it.effect(
    "fail a byte stream declaring ISO-8859-1 with reason Unsupported with and without positions",
    () =>
      Effect.gen(function* failsLatin1Bytes() {
        for (const positions of [false, true]) {
          const error = yield* Stream.make(new TextEncoder().encode(latin1Text)).pipe(
            Stream.pipeThroughChannel(decodeSchema(ItemRef, itemRefRoot)({ positions })),
            Stream.runDrain,
            Effect.flip,
          );

          const { reason } = error;
          const cause = reason._tag === "Unsupported" ? reason.cause : undefined;

          expect({ kind: cause?.kind, positions, tag: reason._tag }).toStrictEqual({
            kind: "Unsupported",
            positions,
            tag: "Unsupported",
          });
          expect(cause?.message).toMatch(/^encoding ISO-8859-1 is not supported for byte input/u);
          expect(Object.hasOwn(error, "record")).toBe(false);
        }
      }),
  );

  it.effect("position the unsupported declaration at its start under positions true", () =>
    Effect.gen(function* positionsLatin1Bytes() {
      const error = yield* bytesOf(latin1Text).pipe(
        Stream.pipeThroughChannel(decodeSchema(ItemRef, itemRefRoot)({ positions: true })),
        Stream.runDrain,
        Effect.flip,
      );

      expect(error.reason).toMatchObject({ cause: { column: 1, line: 1 } });
      expect(error.position).toStrictEqual({ column: 1, line: 1 });
    }),
  );

  it.effect("decode the same document as text with and without positions", () =>
    Effect.gen(function* decodesLatin1Text() {
      const unpositioned = yield* Stream.runCollect(
        textOf(latin1Text).pipe(
          Stream.pipeThroughChannel(decodeSchemaString(ItemRef, itemRefRoot)()),
        ),
      );

      const positioned = yield* Stream.runCollect(
        Stream.make(latin1Text).pipe(
          Stream.pipeThroughChannel(decodeSchemaString(ItemRef, itemRefRoot)({ positions: true })),
        ),
      );

      expect(unpositioned.map((ref) => ref.identifier)).toStrictEqual(["x"]);
      expect(unpositioned).toStrictEqual(positioned);
    }),
  );

  it.effect(
    "open one xml.decodeSchemaString span with xml.positions true for a positioned run",
    () =>
      Effect.gen(function* spanWithPositions() {
        const spans = yield* spanAttributes(
          Stream.runDrain(
            textOf(fixtureText).pipe(
              Stream.pipeThroughChannel(
                decodeSchemaString(ItemRef, recordPath)({ positions: true }),
              ),
            ),
          ),
        );

        expect(spans.map((span) => span.name)).toStrictEqual(["xml.decodeSchemaString"]);
        expect(spans[0]?.attributes.get("xml.positions")).toBe(true);
        expect(spans[0]?.attributes.get("xml.records")).toBe(6);
      }),
  );

  it.effect("forward maxDepth and maxTokenSize to the tokenizer as reason Limit", () =>
    Effect.gen(function* forwardsTokenizerLimits() {
      const limits = [{ maxDepth: 2 }, { maxTokenSize: 8 }] as const;

      for (const limit of limits) {
        const runs = [
          {
            label: "text",
            run: textOf(fixtureText).pipe(
              Stream.pipeThroughChannel(decodeSchemaString(ItemRef, recordPath)(limit)),
            ),
          },
          {
            label: "text with positions",
            run: textOf(fixtureText).pipe(
              Stream.pipeThroughChannel(
                decodeSchemaString(ItemRef, recordPath)({ ...limit, positions: true }),
              ),
            ),
          },
          {
            label: "bytes",
            run: bytesOf(fixtureText).pipe(
              Stream.pipeThroughChannel(decodeSchema(ItemRef, recordPath)(limit)),
            ),
          },
        ];

        for (const { label, run } of runs) {
          const error = yield* run.pipe(Stream.runDrain, Effect.flip);
          const { reason } = error;
          const [name] = Object.keys(limit);

          expect(reason._tag, JSON.stringify({ label, limit })).toBe("Limit");
          expect(reason._tag === "Limit" && reason.limit).toBe(name);
          expect(error.position).toBeDefined();
        }
      }
    }),
  );
});

describe("record path checks", () => {
  const bank = '<bank xmlns:q="urn:qti"><item xmlns="urn:qti" id="1"/><q:item id="2"/></bank>';

  const Item = namespaces({ "": "urn:qti" }).Element("item", {
    attributes: { id: Schema.String },
  });

  it("throw at the factory for a path that cannot match, naming the step", () => {
    const rejected = [
      { path: ["bank", "item"], step: /step 2 "item"/u },
      { path: ["bank", "q:item"], step: /step 2 "q:item"/u },
      { path: ["bank", "{x"], step: /step 2 "\{x"/u },
      { path: ["bank", "{urn:qti}other"], step: /step 2 "\{urn:qti\}other"/u },
    ];

    for (const { path, step } of rejected) {
      expect(() => decodeSchemaString(Item, path), JSON.stringify(path)).toThrow(step);
      expect(() => decodeSchema(Item, path), JSON.stringify(path)).toThrow(step);
    }
  });

  it.effect("decode both records under a Clark-named path", () =>
    Effect.gen(function* decodesClarkPath() {
      const items = yield* Stream.runCollect(
        Stream.make(bank).pipe(
          Stream.pipeThroughChannel(decodeSchemaString(Item, ["bank", "{urn:qti}item"])()),
        ),
      );

      expect(items.map((item) => item.id)).toStrictEqual(["1", "2"]);
    }),
  );
});

describe("schema parse options and services", () => {
  it.effect("pass errors all to each record's decode", () =>
    Effect.gen(function* reportsAllIssues() {
      const Pair = Element("r", { attributes: { a: Schema.Int, b: Schema.Int } });
      const xml = '<s><r a="1" b="2"/><r a="x" b="x"/></s>';
      const channel = decodeSchemaString(Pair, ["s", "r"]);

      const all = yield* Stream.make(xml).pipe(
        Stream.pipeThroughChannel(channel(undefined, { errors: "all" })),
        Stream.runDrain,
        Effect.flip,
      );

      const first = yield* Stream.make(xml).pipe(
        Stream.pipeThroughChannel(channel()),
        Stream.runDrain,
        Effect.flip,
      );

      expect(all.record).toBe(2);
      expect(all.path).toBe("/r/@a");
      expect(issueCount(all)).toBeGreaterThanOrEqual(2);
      expect(issueCount(first)).toBe(1);
    }),
  );

  it("carry the record codec's decoding services in the channel's environment", () => {
    const Svc = Schema.String.pipe(
      Schema.decodeTo(Schema.String, {
        decode: SchemaGetter.transformEffect((s: string) =>
          Effect.gen(function* readUpper() {
            const upper = yield* Upper;

            return upper.f(s);
          }),
        ),
        encode: SchemaGetter.passthrough(),
      }),
    );

    // SAFETY: `element` fixes the decoding services to `never`; the attribute schema reads
    // `Upper`, so the cast states the services the codec actually requires.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- services exist only at the type level.
    const P = Element("p", { attributes: { a: Svc } }) as Element<
      "p",
      { readonly a: string },
      Upper
    >;

    expectTypeOf<
      ChannelServices<ReturnType<ReturnType<typeof decodeSchemaString<typeof P>>>>
    >().toEqualTypeOf<Upper>();
    expectTypeOf<
      ChannelServices<ReturnType<ReturnType<typeof decodeSchema<typeof P>>>>
    >().toEqualTypeOf<Upper>();
  });
});

/**
 * Run the positioned text channel and the positioned byte channel over {@link failingThirdText},
 * each under `tokenizer`, and return both failures labelled by channel.
 *
 * @param tokenizer - The tokenizer provided to both runs.
 * @returns The `text` and `bytes` failures.
 */
const positionedFailures = (tokenizer: Tokenizer) =>
  Effect.all({
    bytes: bytesOf(failingThirdText).pipe(
      Stream.pipeThroughChannel(decodeSchema(ItemRef, recordPath)({ positions: true })),
      Stream.runDrain,
      Effect.flip,
    ),
    text: textOf(failingThirdText).pipe(
      Stream.pipeThroughChannel(decodeSchemaString(ItemRef, recordPath)({ positions: true })),
      Stream.runDrain,
      Effect.flip,
    ),
  }).pipe(Effect.provideService(Tokenizer, tokenizer));

describe("native-position tokenizers", () => {
  it.effect("position a rejected record from the tokenizer's own start-tag lines", () =>
    Effect.gen(function* shiftedNative() {
      const shifted = yield* positionedFailures(shiftedNativeTokenizer);

      for (const [label, error] of Object.entries(shifted)) {
        expect(error.reason._tag, label).toBe("SchemaFailure");
        expect(error.record, label).toBe(3);
        expect(error.position?.line, label).toBeGreaterThanOrEqual(1000);
      }
    }),
  );

  it.effect("position a rejected record where the scan does under an honest tokenizer", () =>
    Effect.gen(function* honestNative() {
      const honest = yield* positionedFailures(honestNativeTokenizer);
      const expected = thirdWeightPosition(failingThirdText);

      for (const [label, error] of Object.entries(honest)) {
        expect(error.reason._tag, label).toBe("SchemaFailure");
        expect(error.record, label).toBe(3);
        expect(error.position, label).toStrictEqual(expected);
      }
    }),
  );
});
