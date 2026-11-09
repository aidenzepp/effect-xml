/**
 * The benchmark cases and capability profile for sax.
 */
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import sax from "sax";

import type { BenchCase, BenchDocument, LibraryProfile } from "../types.ts";
import { acceptsValid } from "./accepts.ts";

/**
 * The npm package this module measures.
 */
const library = "sax";

/**
 * Count the start tags of one document with a strict sax parser fed chunk by chunk.
 *
 * Strict mode is non-default: sax's default non-strict mode accepts malformed input, and every
 * other entry is strict. A malformed document throws from `write` or `close`, which the harness
 * catches once around the batch.
 *
 * @param document - The document whose chunks are written in order.
 * @returns The number of `onopentag` events the parser emitted.
 */
const countStartTags = (document: BenchDocument): number => {
  // A sax parser is spent once closed, so each document builds its own; a user pays that cost too.
  const parser = sax.parser(true);
  let count = 0;

  parser.onopentag = () => {
    count += 1;
  };

  for (const text of document.chunks) {
    parser.write(text);
  }

  parser.close();

  return count;
};

/**
 * The `sax/events` case: strict start-tag counting over every document of every valid input.
 */
const events: BenchCase = {
  accepts: acceptsValid,
  class: "events",
  id: "sax/events",
  library,
  prepare: (input) =>
    Effect.succeed({
      check: (output) => (Predicate.isNumber(output) ? output : Number.NaN),
      expected: input.reference.elements,
      run: () => input.documents.reduce((sum, document) => sum + countStartTags(document), 0),
    }),
};

/**
 * The cases this module registers.
 */
export const cases: readonly BenchCase[] = [events];

/**
 * The capability profiles this module registers, each flag set from the probes in
 * `test/bench/sax.test.ts` run against `sax.parser(true)`.
 */
export const libraries: readonly LibraryProfile[] = [
  {
    decodesEntities: true,
    expandsDoctypeEntities: false,
    library,
    notes: [
      "strict mode (`sax.parser(true)`) is non-default: non-strict mode accepts malformed input, and every other entry is strict",
      "reportsPositions: `SAXParser.line`, `SAXParser.column`, and `SAXParser.position`",
      "streams: `SAXParser.write` accepts input chunk by chunk",
      "typed: no schema or typed decode API",
    ],
    rejectsMalformed: true,
    reportsPositions: true,
    resolvesNamespaces: false,
    streams: true,
    typed: false,
  },
];
