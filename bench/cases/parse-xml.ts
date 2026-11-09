/**
 * The benchmark case and capability profile for @rgrove/parse-xml, which builds a document tree
 * from a whole string and has no serializer, so it enters the tree class only.
 */
import { parseXml, XmlElement } from "@rgrove/parse-xml";
import type { XmlDocument } from "@rgrove/parse-xml";
import * as Effect from "effect/Effect";

import type { BenchCase, LibraryProfile, PreparedCase } from "../types.ts";
import { acceptsValid } from "./accepts.ts";

/**
 * The npm package this module measures.
 */
const library = "@rgrove/parse-xml";

// Native: Effect has no walker for a third-party DOM; the count reads parse-xml's own `XmlElement` nodes.
/**
 * Count the elements under one parse-xml node.
 *
 * @param element - The element to count from.
 * @returns The element plus every `XmlElement` descendant; text, CDATA, comment, and processing
 *   instruction children are not counted.
 */
const countElements = (element: XmlElement): number => {
  let count = 1;

  for (const child of element.children) {
    if (child instanceof XmlElement) {
      count += countElements(child);
    }
  }

  return count;
};

/**
 * Count the elements of every document a `parse-xml/tree` run returned.
 *
 * @param documents - The documents `run` returned.
 * @returns The summed element count of their root elements.
 */
const countDocuments = (documents: readonly XmlDocument[]): number =>
  documents.reduce(
    (total, document) => total + (document.root === null ? 0 : countElements(document.root)),
    0,
  );

/**
 * The tree case: `parseXml` with default options over each document of every input except the
 * `-bad-last` error-path banks.
 */
const treeCase: BenchCase = {
  accepts: acceptsValid,
  class: "tree",
  id: "parse-xml/tree",
  library,
  prepare: (input) =>
    Effect.sync(() => {
      const texts = input.documents.map((document) => document.text);

      const prepared: PreparedCase = {
        check: (output) => (Array.isArray(output) ? countDocuments(output) : -1),
        expected: input.reference.elements,
        // `parseXml` builds a new `Parser` per call; the library exposes no reusable parser.
        run: () => texts.map((text) => parseXml(text)),
      };

      return prepared;
    }),
};

/**
 * The cases this module registers: the tree class only, since parse-xml has no serializer.
 */
export const cases: readonly BenchCase[] = [treeCase];

/**
 * The capability profile of @rgrove/parse-xml, each flag set from the probes its test runs.
 */
export const libraries: readonly LibraryProfile[] = [
  {
    decodesEntities: true,
    expandsDoctypeEntities: false,
    library,
    notes: [
      "Default options: `parseXml(text)` with no `ParserOptions`.",
      "Positions: `includeOffsets: true` sets `start` and `end` character offsets on each node (off in the case); `XmlError` carries `line`, `column`, and `pos`.",
      "Not streaming: `parseXml` takes the whole document as one string.",
      "Not typed: the output is an untyped `XmlDocument` tree.",
      "Namespaces: prefixed names stay as written (`p:a`) and `xmlns:*` stays an attribute; no URI is resolved.",
      "Doctype entities: an internal-subset `<!ENTITY>` is not expanded; a reference to it fails as undefined.",
      "No serializer: the library cannot write XML, so it enters no encode class.",
    ],
    rejectsMalformed: true,
    reportsPositions: true,
    resolvesNamespaces: false,
    streams: false,
    typed: false,
  },
];
