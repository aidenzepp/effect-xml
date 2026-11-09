/**
 * The corpus inputs: every QTI fixture as `corpus-all`, the four typed-decode fixtures as
 * `corpus-items`, and their sizes and reference counts measured here from the files themselves.
 */
import { readdirSync, readFileSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { loadInput } from "../../bench/inputs/corpus.ts";
import { countElements } from "../../bench/inputs/reference.ts";

/**
 * The directory holding the QTI corpus fixtures, read by path because `test/` never imports
 * from `spikes/`.
 */
const fixtureDirectory = new URL("../../spikes/fixtures/qti/", import.meta.url);

/**
 * The four fixtures the typed-decode class reads, as `test/qti/vocabulary.test.ts` names them.
 */
const itemNames = [
  "bg007-true-false.xml",
  "bpig-hotspot.xml",
  "bg010-missing-word.xml",
  "extended-text-postcard.xml",
];

/**
 * Read one corpus fixture by file name.
 *
 * @param name - The fixture's file name.
 * @returns The fixture's text.
 */
const readFixture = (name: string): string =>
  readFileSync(new URL(name, fixtureDirectory), "utf-8");

describe("corpus inputs", () => {
  it.effect("corpus-all holds every .xml fixture in the directory", () =>
    Effect.gen(function* holdsEveryFixture() {
      const listed = readdirSync(fixtureDirectory).filter((name) => name.endsWith(".xml"));
      const input = yield* loadInput("corpus-all");
      const count = input.pipe(Option.map((value) => value.documents.length));

      expect(count).toStrictEqual(Option.some(listed.length));
    }),
  );

  it.effect("corpus-items holds the four typed-decode fixtures by name", () =>
    Effect.gen(function* holdsItemFixtures() {
      const input = yield* loadInput("corpus-items");

      const names = input.pipe(
        Option.map((value) => value.documents.map((document) => document.name)),
      );

      expect(names).toStrictEqual(Option.some(itemNames));
    }),
  );

  it.effect("corpus-items counts its elements, records, and bytes from the files", () =>
    Effect.gen(function* countsItemReferences() {
      const texts = itemNames.map((name) => readFixture(name));
      const counts = yield* Effect.all(texts.map((text) => countElements(text)));
      const elements = counts.reduce((sum, count) => sum + count, 0);
      const bytes = texts.reduce((sum, text) => sum + Buffer.byteLength(text), 0);
      const input = yield* loadInput("corpus-items");

      const measured = input.pipe(
        Option.map((value) => ({
          bytes: value.bytes,
          family: value.family,
          reference: value.reference,
        })),
      );

      expect(measured).toStrictEqual(
        Option.some({ bytes, family: "corpus", reference: { elements, records: 4 } }),
      );
    }),
  );

  it.effect("each document's chunks join back to its text", () =>
    Effect.gen(function* chunksJoinBack() {
      const input = yield* loadInput("corpus-items");

      const joined = input.pipe(
        Option.map((value) =>
          value.documents.every((document) => document.chunks.join("") === document.text),
        ),
      );

      expect(joined).toStrictEqual(Option.some(true));
    }),
  );

  it.effect("an id this module does not own is None", () =>
    Effect.gen(function* rejectsForeignId() {
      const input = yield* loadInput("bank-16k");

      expect(Option.isNone(input)).toBe(true);
    }),
  );
});
