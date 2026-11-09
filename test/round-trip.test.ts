/**
 * Raw-tree round trip over the QTI corpus: resolve, `toEvents`, encode, resolve again.
 *
 * The comparator is `canonicalize` with an empty normalized set: a raw tree has no definition and
 * encodes verbatim, so every element compares strictly, in document order with its whitespace.
 * It still excludes, by design: attribute order, quote style, entity form, self-closing form, the
 * XML declaration, comments, processing instructions, and whitespace runs in attribute values and
 * text (the D1 list in the `canonicalize` doc comment). Each case also asserts that a
 * second encode of the second tree is text-identical to the first encode. The typed round trip
 * through definitions is the C1 test in `test/qti/vocabulary.test.ts`.
 */
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Xml } from "effect/encoding";

import { canonicalize } from "../src/canonical.ts";
import type { ResolvedElement } from "../src/element.ts";
import { collect, resolveEvents, toEvents } from "../src/resolve.ts";

/**
 * The directory holding the QTI corpus fixtures.
 */
const fixtureDirectory = new URL("../spikes/fixtures/qti/", import.meta.url);

/**
 * The corpus file names, enumerated at load time so the count is never written into a test.
 */
const fixtureNames: readonly string[] = readdirSync(fixtureDirectory).filter((name) =>
  name.endsWith(".xml"),
);

/**
 * The number of per-file cases registered below, checked against the enumeration in the final test.
 */
let registered = 0;

/**
 * Decodes XML text into its single resolved root element, with no `Plan` involved.
 *
 * @param text - The XML text to decode.
 * @returns An effect yielding the root, failing with the decode error.
 */
const decodeRoot = (text: string) =>
  Stream.make(text).pipe(
    Stream.pipeThroughChannel(Xml.decodeString()),
    Stream.pipeThroughChannel(resolveEvents()),
    Stream.pipeThroughChannel(collect(["*"])),
    Stream.runCollect,
    Effect.map((roots): ResolvedElement | undefined => roots[0]),
    Effect.flatMap((root) =>
      root === undefined ? Effect.die("no root element") : Effect.succeed(root),
    ),
  );

/**
 * Builds a prefix map from the `xmlns` declarations a document's text contains.
 *
 * A raw tree carries no `Plan`, so the map comes from the text; a later declaration of the same
 * prefix replaces an earlier one.
 *
 * @param text - The XML text to scan.
 * @returns The map from prefix (`""` for the default namespace) to namespace URI.
 */
const prefixesOf = (text: string) =>
  Object.fromEntries(
    Array.from(
      text.matchAll(/xmlns(?::(?<prefix>[\w.-]+))?="(?<uri>[^"]*)"/gu),
      (match) => [match.groups?.prefix ?? "", match.groups?.uri ?? ""] as const,
    ),
  );

/**
 * Encodes a resolved root to XML text through `toEvents` and the upstream encoder.
 *
 * @param root - The resolved root element.
 * @param prefixes - The prefix map used to spell the root's names.
 * @returns An effect yielding the XML text.
 */
const encodeRoot = (root: ResolvedElement, prefixes: Readonly<Record<string, string>>) =>
  toEvents(root, { prefixes }).pipe(
    Effect.flatMap((events) =>
      Stream.fromIterable(events).pipe(
        Stream.pipeThroughChannel(Xml.encodeString()),
        Stream.mkString,
      ),
    ),
  );

describe("raw-tree round trip over the QTI corpus", () => {
  for (const name of fixtureNames) {
    registered += 1;
    it.effect(`${name} survives resolve, toEvents, encode, resolve`, () =>
      Effect.gen(function* roundTrips() {
        const text = readFileSync(new URL(name, fixtureDirectory), "utf-8");
        const first = yield* decodeRoot(text);
        const encoded = yield* encodeRoot(first, prefixesOf(text));

        const second = yield* decodeRoot(encoded);
        const reencoded = yield* encodeRoot(second, prefixesOf(encoded));

        const options = { normalize: new Set<string>() };

        expect(canonicalize(second, options)).toBe(canonicalize(first, options));
        expect(reencoded).toBe(encoded);
      }),
    );
  }

  it("registers one case per enumerated fixture", () => {
    expect(fixtureNames.length).toBeGreaterThan(0);
    expect(registered).toBe(fixtureNames.length);
  });
});
