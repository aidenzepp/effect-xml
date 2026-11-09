import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Channel from "effect/Channel";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import * as Order from "effect/Order";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import type * as Pull from "effect/Pull";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { Xml } from "effect/encoding";
import { Xml as XmlRuntime } from "effect/encoding";

import { honestNativeTokenizer, spyTokenizer } from "../test/tokenizer/fakes.ts";
import { decodeStringWithPositions, locate, nativePositions, positionAt } from "./positions.ts";
import type { ElementPath, Position, PositionTree, PositionedEvent } from "./positions.ts";
import { Tokenizer, defaultTokenizer } from "./tokenizer.ts";
import type { TokenizerDecodeOptions } from "./tokenizer.ts";

const path = (...steps: readonly (readonly [string, number])[]): ElementPath =>
  steps.map(([local, index]) => ({ index, local }));

const TEXT = '<root>\n  <a/><b/><c attr="a > b"/><d>\n    <e/></d>\n</root>';

const found: readonly (readonly [ElementPath, number, number])[] = [
  [path(["root", 0]), 1, 1],
  [path(["root", 0], ["a", 0]), 2, 3],
  [path(["root", 0], ["b", 1]), 2, 7],
  [path(["root", 0], ["c", 2]), 2, 11],
  [path(["root", 0], ["d", 3]), 2, 28],
  [path(["root", 0], ["d", 3], ["e", 0]), 3, 5],
];

describe("locate", () => {
  it("returns the start tag position over plain tags", () => {
    for (const [p, line, column] of found) {
      expect(locate(TEXT, p)).toEqual(Option.some({ column, line }));
    }
  });

  it("returns the same position over CRLF line ends", () => {
    const crlf = TEXT.replaceAll("\n", "\r\n");

    for (const [p, line, column] of found) {
      expect(locate(crlf, p)).toEqual(Option.some({ column, line }));
    }
  });

  it("uses the as-written local part of a prefixed name", () => {
    expect(locate('<r xmlns:p="u"><p:q/></r>', path(["r", 0], ["q", 0]))).toEqual(
      Option.some({ column: 16, line: 1 }),
    );
  });

  it("returns none when no start tag matches", () => {
    expect(locate(TEXT, path(["root", 0], ["x", 2]))).toEqual(Option.none());
    expect(locate(TEXT, path(["root", 0], ["e", 0]))).toEqual(Option.none());
    expect(locate(TEXT, path(["root", 0], ["a", 4]))).toEqual(Option.none());
    expect(locate(TEXT, [])).toEqual(Option.none());
    expect(locate("<root><a", path(["root", 0], ["a", 0]))).toEqual(Option.none());
  });
});

const EDGE = readFileSync(new URL("../test/fixtures/edge-cases.xml", import.meta.url), "utf-8");

const edgeFound: readonly (readonly [ElementPath, number, number])[] = [
  [path(["root", 0]), 7, 1],
  [path(["root", 0], ["a", 0]), 9, 3],
  [path(["root", 0], ["b", 4]), 12, 5],
  [path(["root", 0], ["c", 5]), 14, 3],
  [path(["root", 0], ["d", 6], ["e", 0]), 15, 16],
];

describe("locate markup skips", () => {
  it("skips declarations, comments, CDATA, doctype, and processing instructions", () => {
    for (const [p, line, column] of edgeFound) {
      expect(locate(EDGE, p)).toEqual(Option.some({ column, line }));
    }
  });

  it("returns the same positions over CRLF line ends", () => {
    const crlf = EDGE.replaceAll("\n", "\r\n");

    for (const [p, line, column] of edgeFound) {
      expect(locate(crlf, p)).toEqual(Option.some({ column, line }));
    }
  });

  it("never matches text inside skipped markup or a wrong index", () => {
    expect(locate(EDGE, path(["root", 0], ["fake-tag", 0]))).toEqual(Option.none());
    expect(locate(EDGE, path(["root", 0], ["not-an-element", 0]))).toEqual(Option.none());
    expect(locate(EDGE, path(["root", 0], ["x", 6]))).toEqual(Option.none());
    expect(locate(EDGE, path(["root", 0], ["b", 7]))).toEqual(Option.none());
  });

  it("returns none for an unterminated construct", () => {
    expect(locate("<!-- open <r/>", path(["r", 0]))).toEqual(Option.none());
    expect(locate("<?pi <r/>", path(["r", 0]))).toEqual(Option.none());
    expect(locate("<![CDATA[ <r/>", path(["r", 0]))).toEqual(Option.none());
    expect(locate("<!DOCTYPE r [ <r/>", path(["r", 0]))).toEqual(Option.none());
  });

  it("locates an element in a QTI item", () => {
    const qti = readFileSync(
      new URL("../spikes/fixtures/qti/bg010-missing-word.xml", import.meta.url),
      "utf-8",
    );

    expect(
      locate(
        qti,
        path(
          ["qti-assessment-item", 0],
          ["qti-item-body", 2],
          ["div", 1],
          ["blockquote", 0],
          ["p", 0],
          ["qti-text-entry-interaction", 1],
        ),
      ),
    ).toEqual(Option.some({ column: 50, line: 26 }));
  });
});

const QTI = new URL("../spikes/fixtures/qti/", import.meta.url);

const fixtures: readonly { readonly name: string; readonly text: string }[] = [
  ...pipe(
    readdirSync(QTI).filter((file) => file.endsWith(".xml")),
    Arr.sortBy(Order.String),
  ).map((file) => ({ name: file, text: readFileSync(new URL(file, QTI), "utf-8") })),
  { name: "edge-cases.xml", text: EDGE },
];

const runB = (chunks: readonly string[]) =>
  Stream.fromIterable(chunks).pipe(
    Stream.rechunk(1),
    Stream.pipeThroughChannel(decodeStringWithPositions()),
    Stream.runCollect,
  );

const runPlain = (chunks: readonly string[]) =>
  Stream.fromIterable(chunks).pipe(
    Stream.rechunk(1),
    Stream.pipeThroughChannel(XmlRuntime.decodeString()),
    Stream.runCollect,
  );

/**
 * List every start tag of a positioned event run with its positional path and position.
 *
 * @param events - The positioned events in document order.
 * @returns One entry per `StartElement`, in document order.
 */
const startTagsOf = (
  events: readonly PositionedEvent[],
): { local: string; path: ElementPath; position: Position }[] => {
  const out: { local: string; path: ElementPath; position: Position }[] = [];
  const stack: { readonly path: ElementPath; counter: number }[] = [{ counter: 0, path: [] }];

  for (const { event, position } of events) {
    if (event._tag === "StartElement") {
      const parent = stack.at(-1);

      if (parent === undefined) {
        continue;
      }

      const local = event.name.slice(event.name.indexOf(":") + 1);
      const next = [...parent.path, { index: parent.counter, local }];
      parent.counter += 1;
      out.push({ local, path: next, position });
      stack.push({ counter: 0, path: next });
    } else if (event._tag === "EndElement") {
      stack.pop();
    }
  }

  return out;
};

// R6 / C9 licence (D7): `locate` is a second tokenizer, acceptable only while it
// agrees with the decoder channel on every start tag of every corpus file and the
// edge-case shapes. Re-run on every `effect` bump: `test/upstream-xml.test.ts` is
// the canary for upstream shape; this case is the proof for `locate`.
describe("locate versus the decoder channel", () => {
  it.effect("agrees on the position of every start tag in every fixture", () =>
    Effect.gen(function* locateAgreesWithChannel() {
      const rows: string[] = [];
      const failures: unknown[] = [];

      for (const fixture of fixtures) {
        const tags = startTagsOf(yield* runB([fixture.text]));

        expect(tags.length, fixture.name).toBeGreaterThan(0);

        const disagreements = tags.filter((tag) => {
          const located = locate(fixture.text, tag.path);

          return !(
            Option.isSome(located) &&
            located.value.line === tag.position.line &&
            located.value.column === tag.position.column
          );
        });

        rows.push(`| ${fixture.name} | ${tags.length} | ${tags.length - disagreements.length} |`);

        failures.push(
          ...disagreements.map((tag) => ({
            channel: tag.position,
            fixture: fixture.name,
            locate: locate(fixture.text, tag.path),
          })),
        );
      }

      // oxlint-disable-next-line no-console -- the verify seat reads the measured totals from the log
      console.log(
        ["| fixture | start tags | agree |", "| --- | ---: | ---: |", ...rows].join("\n"),
      );
      expect(rows.length).toBe(fixtures.length);
      expect(failures).toEqual([]);
    }),
  );
});

/**
 * Build one document of `n` empty `a` elements under a `r` root, so the positioned channel splits
 * its single string into `n + 2` pieces.
 *
 * @param n - The number of empty child elements.
 * @returns The document text.
 */
const manyTags = (n: number): string => `<r>${"<a/>".repeat(n)}</r>`;

/**
 * Count the events the positioned channel emits for one stream chunk holding `text`, and time the
 * run with `performance.now()`, because `it.effect` provides a `TestClock` that does not advance.
 *
 * @param text - The document, fed as one string in one stream chunk.
 * @returns The event count and the elapsed wall time in milliseconds.
 */
const timedPositionedCount = (text: string) =>
  Effect.gen(function* timeOneRun() {
    const start = yield* Effect.sync(() => performance.now());

    const count = yield* Stream.make(text).pipe(
      Stream.pipeThroughChannel(decodeStringWithPositions()),
      Stream.runCount,
    );

    const end = yield* Effect.sync(() => performance.now());

    return { count, ms: end - start };
  });

/**
 * Time the positioned channel over `text` as the best of three runs after one warm run.
 *
 * @param text - The document, fed as one string in one stream chunk.
 * @returns The event count and the fastest of the three timed runs in milliseconds.
 */
const bestOfThree = (text: string) =>
  Effect.gen(function* timeBestOfThree() {
    const warm = yield* timedPositionedCount(text);
    let best = Number.POSITIVE_INFINITY;

    for (let run = 0; run < 3; run += 1) {
      const { ms } = yield* timedPositionedCount(text);

      best = Math.min(best, ms);
    }

    return { count: warm.count, ms: best };
  });

/**
 * The small side of the positioned scaling regression: enough pieces that a quadratic dequeue
 * dominates the large side, few enough that the large side stays a few seconds when it does.
 */
const SCALING_SMALL = 10_000;

describe("decodeStringWithPositions", () => {
  it.effect("has fixtures", () =>
    Effect.sync(() => {
      expect(fixtures.length).toBeGreaterThan(0);
    }),
  );

  it.effect("forwards exactly the events plain decodeString produces", () =>
    Effect.gen(function* forwardsEvents() {
      for (const fixture of fixtures) {
        const plain = yield* runPlain([fixture.text]);
        const tagged = yield* runB([fixture.text]);
        const events: readonly Xml.Event[] = tagged.map(({ event }) => event);

        expect(events, fixture.name).toEqual(plain);
      }
    }),
  );

  it.effect("positions start and end tags exactly", () =>
    Effect.gen(function* positionsTags() {
      const events = yield* runB(["<a>\n<b/></a>"]);

      const tags = events.flatMap(({ event, position }) =>
        event._tag === "StartElement" || event._tag === "EndElement"
          ? [[event._tag, event.name, position.line, position.column] as const]
          : [],
      );

      expect(tags).toEqual([
        ["StartElement", "a", 1, 1],
        ["StartElement", "b", 2, 1],
        ["EndElement", "b", 2, 1],
        ["EndElement", "a", 2, 5],
      ]);
      expect(startTagsOf(events).map(({ local }) => local)).toEqual(["a", "b"]);
    }),
  );

  it.effect(
    "dequeues the pieces of one large string in time linear in their count",
    () =>
      Effect.gen(function* dequeuesLinearly() {
        const smallText = manyTags(SCALING_SMALL);
        const largeText = manyTags(8 * SCALING_SMALL);
        const small = yield* bestOfThree(smallText);
        const large = yield* bestOfThree(largeText);

        const plain = yield* Stream.make(largeText).pipe(
          Stream.pipeThroughChannel(XmlRuntime.decodeString()),
          Stream.runCount,
        );

        expect(large.count).toBe(plain);
        expect(large.ms / small.ms).toBeLessThan(24);
      }),
    120_000,
  );
});

const MULTILINE =
  '<?xml version="1.0"?>\n<!-- lead -->\n<root>\n  <a x="1">text</a>\n  <b>\n    <c/>tail\n  </b>\n</root>';

const nativeEvents = (text: string) =>
  Stream.make(text).pipe(
    Stream.pipeThroughChannel(honestNativeTokenizer.decodeString({ positions: true })),
  );

const runNative = (text: string) =>
  nativeEvents(text).pipe(Stream.pipeThroughChannel(nativePositions()), Stream.runCollect);

describe("decodeStringWithPositions tokenizer", () => {
  it.effect("decodes through the provided Tokenizer", () => {
    const spy = spyTokenizer();

    return Effect.gen(function* decodesThroughTokenizer() {
      yield* runB([MULTILINE]);

      expect(spy.calls.map(({ factory }) => factory)).toEqual(["decodeString"]);
    }).pipe(Effect.provideService(Tokenizer, spy.tokenizer));
  });
});

describe("nativePositions", () => {
  it.effect("yields the scanned position of every start tag", () =>
    Effect.gen(function* nativeMatchesScanned() {
      const scanned = startTagsOf(yield* runB([MULTILINE]));
      const native = startTagsOf(yield* runNative(MULTILINE));

      expect(scanned.length).toBeGreaterThan(1);
      expect(new Set(scanned.map(({ position }) => position.line)).size).toBeGreaterThan(1);
      expect(native).toEqual(scanned);
    }),
  );

  it.effect("gives a non-start event the last start position, or line 1 column 1 before any", () =>
    Effect.gen(function* nonStartCarriesLast() {
      const raw = yield* Stream.runCollect(nativeEvents(MULTILINE));
      const events = yield* runNative(MULTILINE);
      const start: Position = { column: 1, line: 1 };

      const [, expected] = Arr.mapAccum(raw, start, (last, event) => {
        const next: Position =
          event._tag === "StartElement" &&
          Predicate.hasProperty(event, "line") &&
          Predicate.isNumber(event.line) &&
          Predicate.hasProperty(event, "column") &&
          Predicate.isNumber(event.column)
            ? { column: event.column, line: event.line }
            : last;

        return [next, next] as const;
      });

      const nonStart = events.filter(({ event }) => event._tag !== "StartElement");

      expect(nonStart.length).toBeGreaterThan(0);
      expect(events.map(({ position }) => position)).toEqual(expected);
      expect(events.findIndex(({ event }) => event._tag === "StartElement")).toBeGreaterThan(0);
      expect(events[0]?.position).toEqual({ column: 1, line: 1 });
    }),
  );
});

const splitEvery = (text: string, size: number): string[] => {
  const chunks: string[] = [];

  for (let offset = 0; offset < text.length; offset += size) {
    chunks.push(text.slice(offset, offset + size));
  }

  return chunks;
};

/**
 * The building blocks of a generated document: element markup, text holding every line end the
 * `Position` rules name plus a tab and a surrogate pair, a long text run mixing CR, LF, CRLF, and
 * surrogate pairs that ends in a lone CR, a comment and a CDATA section that each hold a `<`, and
 * a comment and a processing instruction that each hold a `<`, brackets, a `>`, and quotes.
 */
const FRAGMENTS = [
  "open",
  "close",
  "empty",
  "word",
  "lf",
  "cr",
  "crlf",
  "tab",
  "pair",
  "run",
  "comment",
  "cdata",
  "quoted",
  "pi",
] as const;

/**
 * The building blocks of a generated DOCTYPE internal subset: a comment, a processing instruction,
 * and an entity declaration that each hold brackets, a `>`, and quotes, and a CRLF line end. A
 * scan that counted the brackets or quotes inside the comment or processing instruction would
 * leave the subset at the wrong `]>`.
 */
const SUBSET_FRAGMENTS = ["comment", "pi", "entity", "crlf"] as const;

/**
 * A long text run for {@link FRAGMENTS}: every line end the `Position` rules name, back to back and
 * between ordinary characters and surrogate pairs, ending in a CR so a piece can end on one.
 */
const RUN = "ab\r\ncd\ref\n\u{1F600}g\r\r\n\n\u{1F600}\u{1F600}h\r".repeat(8);

/**
 * Build a well-formed document from fragment kinds, recording the offset of the `<` behind every
 * `StartElement` and `EndElement` event in event order. A `close` with no open element is dropped,
 * and every element still open at the end is closed. A non-empty `subset` puts a DOCTYPE whose
 * internal subset holds those fragments before the root.
 *
 * @param kinds - The fragment kinds in document order.
 * @param subset - The internal subset fragment kinds in order; empty means no DOCTYPE.
 * @returns The document text and one `<` offset per start or end tag event.
 */
const buildDocument = (
  kinds: readonly (typeof FRAGMENTS)[number][],
  subset: readonly (typeof SUBSET_FRAGMENTS)[number][] = [],
) => {
  const declarations = {
    comment: "<!-- [ ] > ' \" < ] -->",
    crlf: "\r\n",
    entity: `<!ENTITY e "a ] > ' [">`,
    pi: "<?p [ ] > ' \" < [ ?>",
  } satisfies Record<(typeof SUBSET_FRAGMENTS)[number], string>;

  const prolog =
    subset.length === 0
      ? ""
      : `<!DOCTYPE root [${subset.map((kind) => declarations[kind]).join("")}]>\n`;

  const text: string[] = [prolog, "<root>"];
  const tags: number[] = [prolog.length];
  let length = prolog.length + 6;
  let depth = 0;

  const add = (fragment: string): void => {
    text.push(fragment);
    length += fragment.length;
  };

  const literal = {
    cdata: "<![CDATA[ c < d ]]>",
    comment: "<!-- a < b -->",
    cr: "\r",
    crlf: "\r\n",
    lf: "x\n",
    pair: "\u{1F600}",
    pi: "<?p ] > ' \" [ < ?>",
    quoted: "<!-- ' ] > \" [ < -->",
    run: RUN,
    tab: "\t",
    word: "w",
  } satisfies Record<Exclude<(typeof FRAGMENTS)[number], "open" | "close" | "empty">, string>;

  for (const kind of kinds) {
    if (kind === "open") {
      tags.push(length);
      add("<n>");
      depth += 1;
    } else if (kind === "close") {
      if (depth > 0) {
        tags.push(length);
        add("</n>");
        depth -= 1;
      }
    } else if (kind === "empty") {
      tags.push(length, length);
      add("<e/>");
    } else {
      add(literal[kind]);
    }
  }

  for (; depth > 0; depth -= 1) {
    tags.push(length);
    add("</n>");
  }

  tags.push(length);
  add("</root>");

  return { tags, text: text.join("") };
};

/**
 * Count the line and column of an offset with the `Position` rules: lines end at LF, CR, or CRLF,
 * and columns count UTF-16 code units from 1.
 *
 * @param text - The document text.
 * @param offset - The UTF-16 offset to locate.
 * @returns The one-based line and column of the offset.
 */
const positionOf = (text: string, offset: number): Position => {
  let line = 1;
  let column = 1;

  for (let i = 0; i < offset; i += 1) {
    const code = text.codePointAt(i);

    if (code === 10 || (code === 13 && text.codePointAt(i + 1) !== 10)) {
      line += 1;
      column = 1;
    } else if (code !== 13) {
      column += 1;
    }
  }

  return { column, line };
};

/**
 * Cut text into strings whose lengths cycle through `sizes`, then group the strings into stream
 * chunks whose string counts cycle through `groups`.
 *
 * @param text - The document text.
 * @param sizes - The string lengths to cycle through; empty keeps the text whole.
 * @param groups - The strings per stream chunk to cycle through; empty puts every string in one
 *   chunk.
 * @returns The stream chunks, each a non-empty array of non-empty strings.
 */
const splitDocument = (
  text: string,
  sizes: readonly number[],
  groups: readonly number[],
): string[][] => {
  const strings: string[] = [];

  for (let n = 0, offset = 0; offset < text.length; n += 1) {
    const size = sizes.length === 0 ? text.length : (sizes[n % sizes.length] ?? text.length);

    strings.push(text.slice(offset, offset + size));
    offset += size;
  }

  const chunks: string[][] = [];

  for (let n = 0, offset = 0; offset < strings.length; n += 1) {
    const count = groups.length === 0 ? strings.length : (groups[n % groups.length] ?? 1);

    chunks.push(strings.slice(offset, offset + count));
    offset += count;
  }

  return chunks;
};

/**
 * Decode stream chunks of strings through the positioned channel.
 *
 * @param chunks - The stream chunks, each fed as one pull.
 * @returns The positioned events in document order.
 */
const runChunks = (chunks: readonly (readonly string[])[]) =>
  Stream.fromArrays(...chunks).pipe(
    Stream.pipeThroughChannel(decodeStringWithPositions()),
    Stream.runCollect,
  );

describe("decodeStringWithPositions chunking", () => {
  it.effect(
    "tags the same positions whether the input arrives whole or in 7-character chunks",
    () =>
      Effect.gen(function* chunkingIndependence() {
        for (const fixture of fixtures) {
          const whole = startTagsOf(yield* runB([fixture.text]));
          const chunked = startTagsOf(yield* runB(splitEvery(fixture.text, 7)));

          expect(chunked, fixture.name).toEqual(whole);
        }
      }),
  );

  it.effect.prop(
    "positions every tag exactly, however the text is split into strings and chunks",
    [
      Schema.Array(Schema.Literals(FRAGMENTS)),
      Schema.Array(Schema.Literals([1, 2, 3, 5, 8, 13])),
      Schema.Array(Schema.Literals([1, 2, 3])),
      Schema.Array(Schema.Literals(SUBSET_FRAGMENTS)),
    ],
    ([kinds, sizes, groups, subset]) =>
      Effect.gen(function* splitIndependence() {
        const { tags, text } = buildDocument(kinds, subset);
        const split = yield* runChunks(splitDocument(text, sizes, groups));
        const whole = yield* runChunks([[text]]);

        const plain = yield* Stream.make(text).pipe(
          Stream.pipeThroughChannel(XmlRuntime.decodeString()),
          Stream.runCollect,
        );

        const tagPositions = split.flatMap(({ event, position }) =>
          event._tag === "StartElement" || event._tag === "EndElement" ? [position] : [],
        );

        expect(split.map(({ event }) => event)).toEqual(plain);
        expect(tagPositions).toEqual(tags.map((offset) => positionOf(text, offset)));
        expect(split).toEqual(whole);
      }),
  );

  it.effect(
    "releases the first events of one long string before the tokenizer reads it all",
    () => {
      const records = 1000;
      let fed = 0;

      const counting: Tokenizer = {
        decode: defaultTokenizer.decode,
        decodeString: <IE = never, Done = unknown>(options?: TokenizerDecodeOptions) =>
          Channel.fromTransform(
            (upstream: Pull.Pull<Arr.NonEmptyReadonlyArray<string>, IE, Done>, scope) =>
              Channel.toTransform(defaultTokenizer.decodeString<IE, Done>(options))(
                Effect.tap(upstream, (chunk) =>
                  Effect.sync(() => {
                    fed += chunk.length;
                  }),
                ),
                scope,
              ),
          ),
        encode: defaultTokenizer.encode,
        encodeString: defaultTokenizer.encodeString,
        positions: defaultTokenizer.positions,
      };

      return Effect.gen(function* boundedBatch() {
        const fedAtFirst = yield* Stream.make(`<r>${"<x/>".repeat(records)}</r>`).pipe(
          Stream.pipeThroughChannel(decodeStringWithPositions()),
          Stream.map(() => fed),
          Stream.runHead,
        );

        expect(Option.getOrElse(fedAtFirst, () => Number.POSITIVE_INFINITY)).toBeLessThan(records);
      }).pipe(Effect.provideService(Tokenizer, counting));
    },
  );

  it.effect("feeds at most 64 pieces plus one tag before the first events leave", () => {
    let fed = 0;

    const counting: Tokenizer = {
      decode: defaultTokenizer.decode,
      decodeString: <IE = never, Done = unknown>(options?: TokenizerDecodeOptions) =>
        Channel.fromTransform(
          (upstream: Pull.Pull<Arr.NonEmptyReadonlyArray<string>, IE, Done>, scope) =>
            Channel.toTransform(defaultTokenizer.decodeString<IE, Done>(options))(
              Effect.tap(upstream, (chunk) =>
                Effect.sync(() => {
                  fed += chunk.length;
                }),
              ),
              scope,
            ),
        ),
      encode: defaultTokenizer.encode,
      encodeString: defaultTokenizer.encodeString,
      positions: defaultTokenizer.positions,
    };

    return Effect.gen(function* pinnedBatch() {
      const fedAtFirst = yield* Stream.make(`<r>${"<x/>".repeat(1000)}</r>`).pipe(
        Stream.pipeThroughChannel(decodeStringWithPositions()),
        Stream.map(() => fed),
        Stream.runHead,
      );

      expect(Option.getOrElse(fedAtFirst, () => Number.POSITIVE_INFINITY)).toBeLessThanOrEqual(
        64 + 1,
      );
    }).pipe(Effect.provideService(Tokenizer, counting));
  });

  it.effect("emits the events decoded before a tokenizer failure, then the failure", () =>
    Effect.gen(function* eventsBeforeFailure() {
      const events: PositionedEvent[] = [];

      const exit = yield* Stream.fromArrays(["<r>\n<a>", "<b/></c>"]).pipe(
        Stream.pipeThroughChannel(decodeStringWithPositions()),
        Stream.runForEach((event) => Effect.sync(() => events.push(event))),
        Effect.exit,
      );

      expect(exit._tag).toBe("Failure");
      expect(
        events.map(({ event, position }) => [event._tag, position.line, position.column]),
      ).toEqual([
        ["StartElement", 1, 1],
        ["Text", 2, 1],
        ["StartElement", 2, 1],
        ["StartElement", 2, 4],
        ["EndElement", 2, 4],
      ]);
    }),
  );
});

// Two start tags per fixture, located by hand (line from the editor, column by
// counting characters on that line). `ordinal` is the one-based position of the
// start tag in document order.
const handChecked: readonly {
  readonly fixture: string;
  readonly ordinal: number;
  readonly name: string;
  readonly line: number;
  readonly column: number;
}[] = [
  { column: 1, fixture: "bg007-true-false.xml", line: 2, name: "qti-assessment-item", ordinal: 1 },
  { column: 5, fixture: "bg007-true-false.xml", line: 22, name: "p", ordinal: 9 },
  {
    column: 1,
    fixture: "bg010-missing-word.xml",
    line: 2,
    name: "qti-assessment-item",
    ordinal: 1,
  },
  { column: 49, fixture: "bg010-missing-word.xml", line: 25, name: "br", ordinal: 14 },
  { column: 1, fixture: "bg011-media.xml", line: 2, name: "qti-assessment-item", ordinal: 1 },
  {
    column: 3,
    fixture: "bg011-media.xml",
    line: 27,
    name: "qti-extended-text-interaction",
    ordinal: 14,
  },
  { column: 1, fixture: "bpig-hotspot.xml", line: 2, name: "qti-assessment-item", ordinal: 1 },
  { column: 7, fixture: "bpig-hotspot.xml", line: 24, name: "qti-hotspot-choice", ordinal: 14 },
  { column: 1, fixture: "bpig-mathml.xml", line: 2, name: "qti-assessment-item", ordinal: 1 },
  { column: 17, fixture: "bpig-mathml.xml", line: 26, name: "mi", ordinal: 14 },
  { column: 1, fixture: "choice-feedback.xml", line: 2, name: "qti-assessment-item", ordinal: 1 },
  { column: 7, fixture: "choice-feedback.xml", line: 18, name: "qti-simple-choice", ordinal: 14 },
  {
    column: 1,
    fixture: "conformance-adaptive-absent.xml",
    line: 2,
    name: "qti-assessment-item",
    ordinal: 1,
  },
  {
    column: 9,
    fixture: "conformance-adaptive-absent.xml",
    line: 12,
    name: "qti-variable",
    ordinal: 9,
  },
  {
    column: 1,
    fixture: "conformance-read-by-a-rule.xml",
    line: 2,
    name: "qti-assessment-item",
    ordinal: 1,
  },
  {
    column: 3,
    fixture: "conformance-read-by-a-rule.xml",
    line: 6,
    name: "qti-outcome-declaration",
    ordinal: 5,
  },
  {
    column: 1,
    fixture: "extended-text-postcard.xml",
    line: 2,
    name: "qti-assessment-item",
    ordinal: 1,
  },
  { column: 111, fixture: "extended-text-postcard.xml", line: 13, name: "br", ordinal: 14 },
  { column: 1, fixture: "hottext.xml", line: 2, name: "qti-assessment-item", ordinal: 1 },
  { column: 3, fixture: "hottext.xml", line: 19, name: "qti-response-processing", ordinal: 14 },
  { column: 1, fixture: "imsmanifest.xml", line: 2, name: "manifest", ordinal: 1 },
  { column: 5, fixture: "imsmanifest.xml", line: 21, name: "resource", ordinal: 14 },
  { column: 1, fixture: "pci-shaded-grid.xml", line: 17, name: "qti-assessment-item", ordinal: 1 },
  { column: 7, fixture: "pci-shaded-grid.xml", line: 49, name: "p", ordinal: 14 },
  { column: 1, fixture: "test-features.xml", line: 2, name: "qti-assessment-test", ordinal: 1 },
  { column: 3, fixture: "test-features.xml", line: 18, name: "qti-test-part", ordinal: 14 },
  { column: 1, fixture: "text-and-media.xml", line: 2, name: "qti-assessment-item", ordinal: 1 },
  { column: 5, fixture: "text-and-media.xml", line: 22, name: "figure", ordinal: 14 },
  { column: 1, fixture: "text-entry-cloze.xml", line: 2, name: "qti-assessment-item", ordinal: 1 },
  { column: 5, fixture: "text-entry-cloze.xml", line: 21, name: "qti-default-value", ordinal: 14 },
  { column: 1, fixture: "edge-cases.xml", line: 7, name: "root", ordinal: 1 },
  { column: 5, fixture: "edge-cases.xml", line: 12, name: "b", ordinal: 6 },
  { column: 16, fixture: "edge-cases.xml", line: 15, name: "e", ordinal: 9 },
];

describe("decodeStringWithPositions hand-checked positions", () => {
  it("lists at least two entries per fixture", () => {
    for (const fixture of fixtures) {
      expect(
        handChecked.filter((entry) => entry.fixture === fixture.name).length,
        fixture.name,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it.effect("matches every hand-checked name and position", () =>
    Effect.gen(function* handCheckedPositions() {
      for (const entry of handChecked) {
        const fixture = fixtures.find((candidate) => candidate.name === entry.fixture);

        expect(fixture, entry.fixture).toBeDefined();

        const events = yield* runB([fixture?.text ?? ""]);

        const start = events.filter(({ event }) => event._tag === "StartElement")[
          entry.ordinal - 1
        ];

        expect(
          start === undefined || start.event._tag !== "StartElement"
            ? undefined
            : `${entry.fixture} #${entry.ordinal} ${start.event.name} ${start.position.line}:${start.position.column}`,
        ).toBe(`${entry.fixture} #${entry.ordinal} ${entry.name} ${entry.line}:${entry.column}`);
      }
    }),
  );
});

/**
 * Build a hand-made {@link PositionTree} node.
 *
 * @param local - The as-written local part.
 * @param line - The start tag's line.
 * @param column - The start tag's column.
 * @param children - The element children in document order.
 * @returns The node.
 */
const node = (
  local: string,
  line: number,
  column: number,
  children: readonly PositionTree[] = [],
): PositionTree => ({ children, local, position: { column, line } });

/**
 * Build the `Option.some` of a position.
 *
 * @param line - The line.
 * @param column - The column.
 * @returns The wrapped position.
 */
const some = (line: number, column: number): Option.Option<Position> =>
  Option.some({ column, line });

describe("positionAt", () => {
  const tree = node("r", 1, 1, [node("a", 2, 3), node("b", 3, 3, [node("c", 3, 6)])]);
  it("finds the node a path names", () => {
    expect(positionAt(tree, path(["r", 0], ["b", 1], ["c", 0]))).toEqual(some(3, 6));
    expect(positionAt(tree, path(["r", 0], ["a", 0]))).toEqual(some(2, 3));
    expect(positionAt(tree, path(["r", 0]))).toEqual(some(1, 1));
  });

  it("is none for a missing child, a local mismatch, a root mismatch, or an empty path", () => {
    expect(positionAt(tree, path(["r", 0], ["b", 2]))).toEqual(Option.none());
    expect(positionAt(tree, path(["r", 0], ["x", 1]))).toEqual(Option.none());
    expect(positionAt(tree, path(["q", 0]))).toEqual(Option.none());
    expect(positionAt(tree, [])).toEqual(Option.none());
  });
});
