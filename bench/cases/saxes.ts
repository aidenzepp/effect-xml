/**
 * The benchmark cases and capability profile for saxes: start-tag events over every input, and
 * namespace-qualified record extraction over the item bank with time to first record.
 */
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import { SaxesParser } from "saxes";
import type { SaxesTagNS } from "saxes";

import { QTI } from "../../test/streaming/vocabulary.ts";
import type { BenchCase, BenchDocument, LibraryProfile } from "../types.ts";
import { acceptsBank, acceptsValid } from "./accepts.ts";

/**
 * The npm package this module measures.
 */
const library = "saxes";

/**
 * One extracted `qti-assessment-item-ref` record: its attributes by local name and the local names
 * of its child elements, in document order.
 */
interface ItemRecord {
  readonly attributes: Record<string, string>;
  readonly children: string[];
}

/**
 * Feed a document to a parser chunk by chunk, then end it.
 *
 * @param parser - The parser with its handlers registered.
 * @param document - The document whose chunks are written.
 */
const feed = (parser: SaxesParser<{ xmlns?: boolean }>, document: BenchDocument): void => {
  for (const piece of document.chunks) {
    parser.write(piece);
  }

  parser.close();
};

/**
 * Count the start tags saxes reports for one document.
 *
 * @param document - The document to parse.
 * @returns The number of `opentag` events.
 */
const countDocumentStartTags = (document: BenchDocument): number => {
  let count = 0;
  // A fresh parser per document, as a caller parsing independent documents builds one; saxes re-initializes on `close()`, so reuse would also work.
  const parser = new SaxesParser();

  parser.on("opentag", () => {
    count += 1;
  });
  feed(parser, document);

  return count;
};

/**
 * Collect a namespace-aware tag's attributes by local name.
 *
 * @param tag - A tag from a parser built with `xmlns: true`.
 * @returns Each attribute's value keyed by its local name.
 */
const attributesOf = (tag: SaxesTagNS) => {
  const attributes: ItemRecord["attributes"] = {};

  for (const attribute of Object.values(tag.attributes)) {
    attributes[attribute.local] = attribute.value;
  }

  return attributes;
};

// Native: `XmlSchema.decodeSchemaString` extracts records through effect-xml, which `effect-xml/stream` measures; this case measures saxes's own event API, so the extractor is plain saxes handlers.
/**
 * Extract every `qti-assessment-item-ref` in the QTI namespace of one document as a plain record.
 *
 * @param document - The document to parse.
 * @param onRecord - Receives each record when its `closetag` arrives.
 */
const extractDocumentRecords = (
  document: BenchDocument,
  onRecord: (record: ItemRecord) => void,
): void => {
  // A fresh parser per document, as a caller parsing independent documents builds one.
  const parser = new SaxesParser({ xmlns: true });
  let depth = 0;
  let recordDepth = 0;
  let current: ItemRecord | undefined;

  parser.on("opentag", (tag) => {
    depth += 1;

    if (current !== undefined) {
      if (depth === recordDepth + 1) {
        current.children.push(tag.local);
      }
    } else if (tag.uri === QTI && tag.local === "qti-assessment-item-ref") {
      current = { attributes: attributesOf(tag), children: [] };
      recordDepth = depth;
    }
  });

  parser.on("closetag", () => {
    if (current !== undefined && depth === recordDepth) {
      onRecord(current);
      current = undefined;
    }

    depth -= 1;
  });

  feed(parser, document);
};

/**
 * Extract every record of the documents, marking the first one.
 *
 * @param documents - The documents to parse.
 * @param mark - Called once, when the first record's `closetag` arrives.
 * @returns The record count and the last record, which keeps the extracted values observable.
 */
const extractRecords = (documents: readonly BenchDocument[], mark: () => void) => {
  let count = 0;
  let last: ItemRecord | undefined;

  const onRecord = (record: ItemRecord): void => {
    count += 1;
    last = record;

    if (count === 1) {
      mark();
    }
  };

  for (const document of documents) {
    extractDocumentRecords(document, onRecord);
  }

  return { count, last };
};

/**
 * The cases this module registers.
 */
export const cases: readonly BenchCase[] = [
  {
    accepts: acceptsValid,
    class: "events",
    id: "saxes/events",
    library,
    prepare: (input) =>
      Effect.succeed({
        check: (output) => (Predicate.isNumber(output) ? output : 0),
        expected: input.reference.elements,
        run: () =>
          input.documents.reduce((total, document) => total + countDocumentStartTags(document), 0),
      }),
  },
  {
    accepts: acceptsBank,
    class: "stream",
    id: "saxes/stream",
    library,
    prepare: (input) =>
      Effect.succeed({
        check: (output) =>
          Predicate.hasProperty(output, "count") && Predicate.isNumber(output.count)
            ? output.count
            : 0,
        expected: input.reference.records,
        run: (mark) => extractRecords(input.documents, mark),
      }),
  },
];

/**
 * The capability profiles this module registers, each flag checked by the probes in
 * `test/bench/saxes.test.ts`.
 */
export const libraries: readonly LibraryProfile[] = [
  {
    decodesEntities: true,
    expandsDoctypeEntities: false,
    library,
    notes: [
      "resolvesNamespaces with `xmlns: true` (non-default), which `saxes/stream` uses because its record path is namespace-qualified, as effect-xml's is; `saxes/events` keeps the default `xmlns: false`, which reports names as written, like the upstream tokenizer.",
      "expandsDoctypeEntities: saxes does not read the internal DTD subset, so `&e;` fails as an undefined entity.",
      "reportsPositions: `SaxesParser.line`, `column`, and `position`, tracked unless the `position` option is `false`.",
      "streams: `SaxesParser.write(chunk)` accepts input chunk by chunk; `close()` ends the document.",
      "typed: no schema or typed-decode API; events carry names and string attribute values.",
    ],
    rejectsMalformed: true,
    reportsPositions: true,
    resolvesNamespaces: true,
    streams: true,
    typed: false,
  },
];
