/**
 * The QTI corpus inputs: every `spikes/fixtures/qti/*.xml` document, and the four item fixtures.
 */
import { readdirSync, readFileSync } from "node:fs";

import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Number from "effect/Number";
import * as Option from "effect/Option";
import * as Order from "effect/Order";

import type { BenchDocument, BenchInput } from "../types.ts";
import { chunk } from "./chunk.ts";
import { countElements } from "./reference.ts";

/**
 * The input ids this module owns.
 */
export const inputIds: readonly string[] = ["corpus-all", "corpus-items"];

/**
 * The directory holding the QTI corpus, read by path because `bench/` never imports `spikes/`.
 */
const fixtureDirectory = new URL("../../spikes/fixtures/qti/", import.meta.url);

/**
 * The four fixtures the typed-decode class decodes, the acceptance set of
 * `test/qti/vocabulary.test.ts`, in that file's order.
 */
const itemNames: readonly string[] = [
  "bg007-true-false.xml",
  "bpig-hotspot.xml",
  "bg010-missing-word.xml",
  "extended-text-postcard.xml",
];

// Native: `effect/FileSystem` has no implementation here; its layers live in platform packages that are not dependencies.
/**
 * List every `.xml` file of the corpus directory, sorted by name.
 *
 * The list is read from the directory on every load, so the corpus is never a hand-written list.
 * A failing read means a broken checkout, so it is a defect, not a typed failure.
 */
const corpusNames: Effect.Effect<readonly string[]> = Effect.sync(() =>
  Arr.sort(
    readdirSync(fixtureDirectory).filter((name) => name.endsWith(".xml")),
    Order.String,
  ),
);

// Native: `effect/FileSystem` has no implementation here; its layers live in platform packages that are not dependencies.
/**
 * Read one corpus fixture into a benchmark document.
 *
 * A failing read means a broken checkout, so it is a defect, not a typed failure.
 *
 * @param name - The fixture's file name inside the corpus directory.
 * @returns The document with its text and its stream-class chunks.
 */
const readDocument = (name: string): Effect.Effect<BenchDocument> =>
  Effect.sync(() => {
    const text = readFileSync(new URL(name, fixtureDirectory), "utf-8");

    return { chunks: chunk(text), name, text };
  });

/**
 * Build a corpus input from fixture names.
 *
 * The element reference comes from the upstream tokenizer; a fixture it rejects makes every case's
 * expected count meaningless, so the rejection is a defect, not a typed failure.
 *
 * @param id - The input id.
 * @param names - The fixture file names, in document order.
 * @returns The input with its UTF-8 size and its element and record references.
 */
const buildInput = Effect.fnUntraced(function* build(id: string, names: readonly string[]) {
  const documents = yield* Effect.all(names.map((name) => readDocument(name)));

  const counts = yield* Effect.all(documents.map((document) => countElements(document.text))).pipe(
    Effect.orDie,
  );

  const input: BenchInput = {
    bytes: Number.sumAll(documents.map((document) => Buffer.byteLength(document.text))),
    documents,
    family: "corpus",
    id,
    reference: { elements: Number.sumAll(counts), records: documents.length },
  };

  return input;
});

/**
 * Load one input this module owns.
 *
 * @param id - The input id to load: `corpus-all` is every corpus fixture sorted by name,
 *   `corpus-items` the four typed-decode fixtures.
 * @returns The loaded input, or `None` when this module does not provide `id`.
 */
export const loadInput = (id: string): Effect.Effect<Option.Option<BenchInput>> => {
  if (id === "corpus-all") {
    return corpusNames.pipe(
      Effect.flatMap((names) => buildInput(id, names)),
      Effect.map(Option.some),
    );
  }

  if (id === "corpus-items") {
    return buildInput(id, itemNames).pipe(Effect.map(Option.some));
  }

  return Effect.succeed(Option.none());
};
