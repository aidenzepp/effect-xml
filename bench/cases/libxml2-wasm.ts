/**
 * The benchmark cases and capability profile for libxml2-wasm: a DOM parse of every document, and
 * a serialization of documents parsed once beforehand.
 */
import { XmlDocument, XmlElement } from "libxml2-wasm";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Number from "effect/Number";
import * as Predicate from "effect/Predicate";

import { countElements } from "../inputs/reference.ts";
import { CaseError } from "../types.ts";
import type { BenchCase, LibraryProfile, PreparedCase } from "../types.ts";
import { acceptsValid } from "./accepts.ts";

/**
 * The npm package every case and the profile of this module name.
 */
const library = "libxml2-wasm";

/**
 * The serialization options of the encode-tree case.
 *
 * `XmlDocument.toString` formats its output when called without options, which indents every
 * element onto its own line; `format: false` keeps the text as parsed, like the other encode-tree
 * cases.
 *
 * @see https://github.com/jameslan/libxml2-wasm/blob/v0.7.2/src/libxml2.mts
 */
const saveOptions = { format: false };

/**
 * Count an element and every element below it in a libxml2 tree.
 *
 * @param element - The root of the subtree.
 * @returns The element itself plus every element descendant; text, comment, CDATA, and entity
 *   reference nodes are not counted.
 */
const countTree = (element: XmlElement): number => {
  let count = 1;

  for (let child = element.firstChild; child !== null; child = child.next) {
    if (child instanceof XmlElement) {
      count += countTree(child);
    }
  }

  return count;
};

/**
 * Count the elements of every document a tree run returned.
 *
 * @param output - The value `run` returned: the parsed documents, still undisposed.
 * @returns The elements of all documents together, or `-1` when the output is not a list of
 *   documents.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the opaque output of this module's own `run`, typed `unknown` by the `PreparedCase` contract.
const checkDocuments = (output: unknown): number =>
  Arr.isArray(output) && output.every((document) => document instanceof XmlDocument)
    ? Number.sumAll(output.map((document) => countTree(document.root)))
    : -1;

/**
 * Count the elements of every text an encode run returned, as the upstream tokenizer sees them.
 *
 * @param output - The value `run` returned: one serialized text per document.
 * @returns The elements of all texts together, or `-1` when the output is not a list of strings or
 *   a text does not tokenize.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the opaque output of this module's own `run`, typed `unknown` by the `PreparedCase` contract.
const checkTexts = (output: unknown): number =>
  Arr.isArray(output) && output.every(Predicate.isString)
    ? Effect.all(output.map((text) => countElements(text))).pipe(
        Effect.map(Number.sumAll),
        Effect.orElseSucceed(() => -1),
        Effect.runSync,
      )
    : -1;

/**
 * The tree case: `XmlDocument.fromString` on every document of the input.
 *
 * The library's README requires `dispose()` on every document to free its WebAssembly memory, so
 * each `run` first disposes the documents the previous run returned, inside the timed region
 * because a caller pays that cost too, then parses. The documents of the last run are freed at
 * process exit; the harness runs each case in its own process.
 *
 * @see https://github.com/jameslan/libxml2-wasm/blob/v0.7.2/README.md
 */
const treeCase: BenchCase = {
  accepts: acceptsValid,
  class: "tree",
  id: `${library}/tree`,
  library,
  prepare: (input) =>
    Effect.sync(() => {
      const texts = input.documents.map((document) => document.text);
      let previous: readonly XmlDocument[] = [];

      const prepared: PreparedCase = {
        check: checkDocuments,
        expected: input.reference.elements,
        run: () => {
          for (const document of previous) {
            document.dispose();
          }

          previous = texts.map((text) => XmlDocument.fromString(text));

          return previous;
        },
      };

      return prepared;
    }),
};

/**
 * The encode-tree case: `XmlDocument.toString` with `format: false` on every document, each
 * parsed once in `prepare`.
 *
 * `prepare` returns an effect with no `Scope`, so it cannot register a finalizer with the batch;
 * the parsed documents are freed at process exit instead, since the harness runs each case in its
 * own process.
 */
const encodeTreeCase: BenchCase = {
  accepts: acceptsValid,
  class: "encode-tree",
  id: `${library}/encode-tree`,
  library,
  prepare: (input) =>
    Effect.try({
      catch: (cause) =>
        new CaseError({
          caseId: `${library}/encode-tree`,
          reason: `libxml2-wasm could not parse a document of input ${input.id}, so there is no tree to serialize: ${String(cause)}`,
        }),
      try: () => input.documents.map((document) => XmlDocument.fromString(document.text)),
    }).pipe(
      Effect.map((documents): PreparedCase => ({
        check: checkTexts,
        expected: input.reference.elements,
        run: () => documents.map((document) => document.toString(saveOptions)),
      })),
    ),
};

/**
 * The cases this module registers: the DOM parse and the DOM serialization.
 */
export const cases: readonly BenchCase[] = [treeCase, encodeTreeCase];

/**
 * The capability profiles this module registers; each flag is asserted against a probe of the
 * library in `test/bench/libxml2-wasm.test.ts`.
 */
export const libraries: readonly LibraryProfile[] = [
  {
    decodesEntities: true,
    expandsDoctypeEntities: true,
    library,
    notes: [
      "reportsPositions: a failed parse throws XmlParseError, whose details carry the line and col of each libxml2 diagnostic, and XmlNode.line gives a parsed node's line.",
      "streams: false; the public API parses a whole string or buffer (XmlDocument.fromString, XmlDocument.fromBuffer) and exposes no push parser.",
      "typed: false; the output is a libxml2 DOM, with no schema-typed decode.",
      "expandsDoctypeEntities: with the default parse options (XML_PARSE_NOENT unset) the tree keeps an XmlEntityReference node, and XmlNode.content resolves it to the declared text.",
      "tree: each run disposes the previous run's documents before parsing, inside the timed region, because the README requires dispose() to free a document's WebAssembly memory.",
      "encode-tree: XmlDocument.toString({ format: false }), a non-default option; toString formats its output when called without options.",
      "Memory: documents live on the WebAssembly heap, outside the JavaScript heap, so heapUsedBytes understates the library's memory; peak RSS is the comparable figure.",
    ],
    rejectsMalformed: true,
    reportsPositions: true,
    resolvesNamespaces: true,
    streams: false,
    typed: false,
  },
];
