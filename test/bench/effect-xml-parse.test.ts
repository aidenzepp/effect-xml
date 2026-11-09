/**
 * The effect-xml `events`, `tree`, and `encode-tree` cases and the library's capability profile.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { cases, libraries } from "../../bench/cases/effect-xml-parse.ts";
import { chunk } from "../../bench/inputs/chunk.ts";
import type { BenchDocument, BenchInput } from "../../bench/types.ts";
import { XmlSchema } from "../../src/index.ts";
import { defaultTokenizer } from "../../src/tokenizer.ts";
import { spyTokenizer } from "../tokenizer/fakes.ts";

/**
 * Build a document whose text is split into eight-character chunks, so the `events` case reads
 * more than one chunk.
 *
 * @param name - The document's name.
 * @param text - The document's XML text.
 * @returns The document.
 */
const documentOf = (name: string, text: string): BenchDocument => ({
  chunks: chunk(text, 8),
  name,
  text,
});

/**
 * The documents of the inline input: three elements under a default namespace and two under a
 * prefix.
 */
const documents = [
  documentOf("default", '<a xmlns="urn:a"><b/><c>t &amp; u</c></a>'),
  documentOf("prefixed", '<p:r xmlns:p="urn:p"><p:s k="v"/></p:r>'),
];

/**
 * A two-document input with five elements.
 */
const input: BenchInput = {
  bytes: new TextEncoder().encode(documents.map((document) => document.text).join("")).length,
  documents,
  family: "corpus",
  id: "corpus-items",
  reference: { elements: 5, records: 0 },
};

/**
 * Decode a document into its resolved root through the tree codec.
 *
 * @param text - The XML text.
 * @returns The resolved root, failing with the schema error on rejected text.
 */
const decodeRoot = (text: string) =>
  Schema.decodeUnknownEffect(XmlSchema.ElementFromString({ p: "urn:x" }))(text);

/**
 * Join the text children of a resolved element.
 *
 * @param element - The element.
 * @returns Its direct text content.
 */
const textOf = (element: XmlSchema.ResolvedElement): string =>
  element.children.filter(Predicate.isString).join("");

/**
 * A record whose text content must be `ok`, for the typed, streaming, and position probes.
 */
const Item = XmlSchema.Element("item", { content: XmlSchema.text(Schema.Literal("ok")) });

/**
 * Decode XML text chunk by chunk into records of {@link Item}.
 *
 * @param chunks - The text chunks.
 * @returns The records, failing with the decode error.
 */
const streamItems = (chunks: readonly string[]) =>
  Stream.fromIterable(chunks).pipe(
    Stream.pipeThroughChannel(XmlSchema.decodeSchemaString(Item, ["item"])({ positions: true })),
    Stream.runCollect,
  );

describe("effect-xml parse cases", () => {
  it("registers the events, tree, and encode-tree cases", () => {
    expect(cases.map((benchCase) => [benchCase.id, benchCase.class])).toStrictEqual([
      ["effect-xml/events", "events"],
      ["effect-xml/tree", "tree"],
      ["effect-xml/encode-tree", "encode-tree"],
    ]);
  });

  it("accepts every input except the bad-last ones", () => {
    for (const benchCase of cases) {
      expect(benchCase.accepts({ family: "synthetic", id: "bank-4m" })).toBe(true);
      expect(benchCase.accepts({ family: "corpus", id: "corpus-all" })).toBe(true);
      expect(benchCase.accepts({ family: "synthetic", id: "bank-4m-bad-last" })).toBe(false);
    }
  });

  for (const benchCase of cases) {
    it.effect(`${benchCase.id} counts the input's elements`, () =>
      Effect.gen(function* countsElements() {
        const prepared = yield* benchCase.prepare(input, defaultTokenizer);

        expect(prepared.expected).toBe(5);
        expect(prepared.check(prepared.run(() => {}))).toBe(prepared.expected);
      }),
    );

    it.effect(`${benchCase.id} runs through the tokenizer passed to prepare`, () =>
      Effect.gen(function* runsThroughTokenizer() {
        const spy = spyTokenizer();
        const prepared = yield* benchCase.prepare(input, spy.tokenizer);
        const before = spy.calls.length;

        prepared.run(() => {});

        expect(spy.calls.length).toBeGreaterThan(before);
      }),
    );
  }
});

describe("effect-xml profile", () => {
  it.effect("matches every probe", () =>
    Effect.gen(function* matchesProbes() {
      const malformed = yield* Effect.exit(decodeRoot("<a><b></a>"));
      const prefixed = yield* decodeRoot('<p:a xmlns:p="urn:x"/>');
      const entity = yield* decodeRoot("<a>&amp;</a>");
      const doctype = yield* Effect.exit(decodeRoot('<!DOCTYPE a [<!ENTITY e "x">]><a>&e;</a>'));
      const rejected = yield* Effect.flip(streamItems(["<item>no</item>"]));
      const streamed = yield* streamItems(["<it", "em>o", "k</item>"]);

      const typedOk = yield* Effect.exit(
        Schema.decodeUnknownEffect(XmlSchema.fromString(Item))("<item>ok</item>"),
      );

      const typedNo = yield* Effect.exit(
        Schema.decodeUnknownEffect(XmlSchema.fromString(Item))("<item>no</item>"),
      );

      const probes = {
        decodesEntities: textOf(entity) === "&",
        expandsDoctypeEntities: Exit.isSuccess(doctype) && textOf(doctype.value) === "x",
        rejectsMalformed: Exit.isFailure(malformed),
        reportsPositions: Predicate.isNotUndefined(rejected.position),
        resolvesNamespaces: prefixed.name === XmlSchema.clark(Option.some("urn:x"), "a"),
        streams: streamed.length === 1,
        typed: Exit.isSuccess(typedOk) && Exit.isFailure(typedNo),
      };

      expect(libraries.map((profile) => profile.library)).toStrictEqual(["@aidenzepp/effect-xml"]);
      expect(libraries[0]).toMatchObject(probes);
    }),
  );
});
