/**
 * The benchmark cases and capability profile for @aidenzepp/effect-xml record streaming.
 */
import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Stream from "effect/Stream";

import { XmlSchema } from "../../src/index.ts";
import { ItemRef } from "../../test/streaming/vocabulary.ts";
import { CaseError } from "../types.ts";
import type { BenchCase, LibraryProfile, PreparedCase } from "../types.ts";
import { bankPath } from "../vocabulary.ts";
import { acceptsBank } from "./accepts.ts";

// Native: Stream.tap runs for every element and Stream has no first-element hook, so a run-local flag limits `mark` to the first record.
/**
 * Construct the case that streams a bank's 64 KiB chunks through `XmlSchema.decodeSchemaString`
 * and counts the decoded `qti-assessment-item-ref` records.
 *
 * `run` calls `mark` once, when the first record leaves the channel, so the harness reads time to
 * first record from the same run it times.
 *
 * @param id - The case id.
 * @param positions - Whether the channel stamps each record's events with source positions.
 * @returns The stream case for the four bank sizes.
 */
const streamCase = (id: string, positions: boolean): BenchCase => ({
  accepts: acceptsBank,
  class: "stream",
  id,
  library: "@aidenzepp/effect-xml",
  prepare: (input, tokenizer) =>
    input.documents.length === 1
      ? Effect.sync(() => {
          const chunks = input.documents[0]?.chunks ?? [];
          const channel = XmlSchema.decodeSchemaString(ItemRef, bankPath);

          const prepared: PreparedCase = {
            check: (output) => (Predicate.isNumber(output) ? output : -1),
            expected: input.reference.records,
            run: (mark) => {
              let marked = false;

              return Stream.fromIterable(chunks).pipe(
                Stream.pipeThroughChannel(channel({ positions })),
                Stream.tap(() => {
                  if (marked) {
                    return Effect.void;
                  }

                  marked = true;

                  return Effect.sync(mark);
                }),
                Stream.runCount,
                Effect.provideService(XmlSchema.Tokenizer, tokenizer),
                Effect.runSync,
              );
            },
          };

          return prepared;
        })
      : Effect.fail(
          new CaseError({
            caseId: id,
            reason: `Input ${input.id} has ${input.documents.length} documents; a stream case reads exactly one bank document.`,
          }),
        ),
});

/**
 * The cases this module registers: the record stream without and with source positions.
 */
export const cases: readonly BenchCase[] = [
  streamCase("effect-xml/stream", false),
  streamCase("effect-xml/stream/positions", true),
];

/**
 * The capability profiles this module registers; the effect-xml profile is registered once, by
 * the parse case module.
 */
export const libraries: readonly LibraryProfile[] = [];
