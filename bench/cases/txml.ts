/**
 * The benchmark cases and capability profile for txml: a whole-document tree parse and a
 * serialization of that tree back to text, both with txml's default options.
 */
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Number from "effect/Number";
import * as Predicate from "effect/Predicate";
import { parse, stringify } from "txml";
import type { TNode } from "txml";

import { countElements } from "../inputs/reference.ts";
import type { BenchCase, BenchInput, LibraryProfile, PreparedCase } from "../types.ts";
import { CaseError } from "../types.ts";
import { acceptsValid } from "./accepts.ts";

/**
 * The npm package these cases measure.
 */
const library = "txml";

// Native: `Predicate.hasProperty` and `Predicate.isString` check one level; nothing in Effect walks a foreign tree of nested arrays.
/**
 * Count the elements in txml output: a node, a node list, or a list of per-document node lists.
 *
 * A node is an element when it carries a string `tagName`; string entries are text. txml also
 * returns the `<?xml ...?>` declaration and any other processing instruction as a node whose
 * `tagName` starts with `?`; those are not elements and are not counted, so the count matches the
 * upstream tokenizer's `StartElement` events.
 *
 * @param value - The per-document trees a tree case's `run` returned, or any part of them.
 * @returns The number of elements in the value, nested ones included.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the opaque output of this module's own `run`, typed `unknown` by the `PreparedCase` contract.
const countTreeElements = (value: unknown): number => {
  if (Arr.isArray(value)) {
    return Number.sumAll(value.map(countTreeElements));
  }

  if (!Predicate.hasProperty(value, "tagName") || !Predicate.isString(value.tagName)) {
    return 0;
  }

  const self = value.tagName.startsWith("?") ? 0 : 1;

  return self + (Predicate.hasProperty(value, "children") ? countTreeElements(value.children) : 0);
};

/**
 * Count the elements of every serialized document as the upstream tokenizer sees them.
 *
 * @param output - The per-document texts an encode case's `run` returned.
 * @returns The element total across documents; a text the tokenizer rejects throws.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the opaque output of this module's own `run`, typed `unknown` by the `PreparedCase` contract.
const countTexts = (output: unknown): number =>
  Effect.runSync(
    Effect.all(
      (Arr.isArray(output) ? output.filter(Predicate.isString) : []).map(countElements),
    ).pipe(Effect.map(Number.sumAll)),
  );

/**
 * Parse every document of an input once, for a case that measures a later stage.
 *
 * @param caseId - The case the parse prepares, named in a failure.
 * @param input - The input whose documents are parsed.
 * @returns One txml node list per document, or a `CaseError` carrying the parser's message.
 */
const parseAll = (
  caseId: string,
  input: BenchInput,
): Effect.Effect<readonly (TNode | string)[][], CaseError> =>
  Effect.try({
    catch: (cause) => new CaseError({ caseId, reason: String(cause) }),
    try: () => input.documents.map((document) => parse(document.text)),
  });

/**
 * The txml cases: `txml/tree` parses each document with `parse`; `txml/encode-tree` serializes
 * a tree parsed once in `prepare` with `stringify`.
 */
export const cases: readonly BenchCase[] = [
  {
    accepts: acceptsValid,
    class: "tree",
    id: "txml/tree",
    library,
    prepare: (input) =>
      Effect.succeed<PreparedCase>({
        check: countTreeElements,
        expected: input.reference.elements,
        // `parse` is a plain function with no parser object to construct or reuse.
        run: () => input.documents.map((document) => parse(document.text)),
      }),
  },
  {
    accepts: acceptsValid,
    class: "encode-tree",
    id: "txml/encode-tree",
    library,
    prepare: (input) =>
      parseAll("txml/encode-tree", input).pipe(
        Effect.map((trees): PreparedCase => ({
          check: countTexts,
          expected: input.reference.elements,
          run: () => trees.map((tree) => stringify(tree)),
        })),
      ),
  },
];

/**
 * The capability profile of txml with its default options, each flag set from a probe run by
 * `test/bench/txml.test.ts`.
 */
export const libraries: readonly LibraryProfile[] = [
  {
    decodesEntities: false,
    expandsDoctypeEntities: false,
    library,
    notes: [
      "Default options throughout: `decodeEntities` is off, so entity references stay as written in text and attributes.",
      "reportsPositions: no node carries a source position; `parse` throws an `Error` whose message text names the line and column of an unexpected close tag, and `setPos` reports only the offset where parsing stopped.",
      "streams: `transformStream` (Node `Transform`) and `transformWebStream` accept chunked text; no case here uses them.",
      "typed: txml has no schema API; `parse` returns untyped `TNode` trees.",
      "Prefixed names stay in `tagName` (`p:a`) and `xmlns` declarations stay plain attributes.",
    ],
    rejectsMalformed: true,
    reportsPositions: false,
    resolvesNamespaces: false,
    streams: true,
    typed: false,
  },
];
