/**
 * The bank fingerprint: run the bank differential suite's surfaces (`bank-differential.test.ts`)
 * over every bank input it compares, on the `src` fast path and on the `src` standard path
 * (`standardOf`) through the harness, and print one JSON line with each input's fingerprint and
 * the `globalThis.Function` constructions made while the surfaces ran.
 *
 * The surfaces are `fromString(ItemBank, { maxElementNodes: Infinity, maxElementSize: Infinity })`
 * decode and the encode of its value, and `decodeSchemaString` over `documents[0].chunks` and
 * `decodeSchema` over their UTF-8 bytes, with `positions` off and on. Run it as
 * `test/differential/fingerprint.ts` describes, once interpreted and once with the global JIT
 * import preloaded. It lives in `test/bench/` because only that directory may import `bench/`,
 * which owns the bank generator and `ItemBank`.
 */
import * as Array from "effect/Array";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { loadInput } from "../../bench/inputs/synthetic.ts";
import { ItemBank, bankPath } from "../../bench/vocabulary.ts";
import { XmlSchema } from "../../src/index.ts";
import { countConstructions, ledger, printFingerprint } from "../differential/fingerprint.ts";
import type { Fingerprint, SuiteFingerprint } from "../differential/fingerprint.ts";
import {
  channelDecode,
  documentDecode,
  documentEncode,
  src,
  standard,
  standardOf,
} from "../differential/harness.ts";
import { ItemRef } from "../streaming/vocabulary.ts";

/**
 * The bank inputs the bank differential suite compares, valid sizes first and then the bad-last
 * variants; `bank-64m` is left out there and here.
 */
export const bankIds: readonly string[] = [
  "bank-16k",
  "bank-256k",
  "bank-4m",
  "bank-256k-bad-last",
  "bank-4m-bad-last",
];

/**
 * The parser limits of the bench typed case, so the bank root, which spans the whole document,
 * decodes at every size.
 */
const unlimited = { maxElementNodes: Infinity, maxElementSize: Infinity };

/**
 * The surfaces of the bank differential suite, in the order each input runs them.
 */
const bankSurfaces: readonly string[] = [
  "fromString decode",
  "fromString encode of the decoded value",
  "decodeSchemaString positions off",
  "decodeSchema positions off",
  "decodeSchemaString positions on",
  "decodeSchema positions on",
];

/**
 * The UTF-8 encoder that turns each text chunk into the byte chunk `decodeSchema` reads.
 */
const utf8 = new TextEncoder();

/**
 * Fingerprint the bank surfaces over one bank input.
 *
 * The encode runs only when the `src` decode produced a value, and both sides encode that value, as
 * the suite does. The standard side's roots are `standardOf(ItemBank)` and `standardOf(ItemRef)`.
 *
 * @param id - The bank input id.
 * @returns The input's fingerprint, failing when the id is not provided or holds no document.
 */
const bankFingerprintOf = Effect.fnUntraced(function* bankFingerprintOf(id: string) {
  const input = yield* Effect.fromOption(yield* loadInput(id));
  const document = yield* Effect.fromOption(Array.head(input.documents));
  const bytes = document.chunks.map((chunk) => utf8.encode(chunk));
  const srcCodec = XmlSchema.fromString(ItemBank, unlimited);
  const standardCodec = XmlSchema.fromString(standardOf(ItemBank), unlimited);
  const standardRef = standardOf(ItemRef);
  const suite = ledger(bankSurfaces);
  const left = yield* documentDecode(src, srcCodec, document.text);

  suite.add(`${id} decode`, left, yield* documentDecode(standard, standardCodec, document.text));

  if ("value" in left) {
    suite.add(
      `${id} encode`,
      yield* documentEncode(src, srcCodec, left.value),
      yield* documentEncode(standard, standardCodec, left.value),
    );
  }

  for (const positions of [false, true]) {
    const label = `positions ${positions ? "on" : "off"}`;

    suite.add(
      `${id} decodeSchemaString ${label}`,
      yield* channelDecode(
        XmlSchema.decodeSchemaString(ItemRef, bankPath),
        Stream.fromIterable(document.chunks),
        { positions },
      ),
      yield* channelDecode(
        XmlSchema.decodeSchemaString(standardRef, bankPath),
        Stream.fromIterable(document.chunks),
        { positions },
      ),
    );

    suite.add(
      `${id} decodeSchema ${label}`,
      yield* channelDecode(XmlSchema.decodeSchema(ItemRef, bankPath), Stream.fromIterable(bytes), {
        positions,
      }),
      yield* channelDecode(
        XmlSchema.decodeSchema(standardRef, bankPath),
        Stream.fromIterable(bytes),
        { positions },
      ),
    );
  }

  return suite.done();
});

/**
 * Fingerprint every bank input, counting `Function` constructions from the first surface to the
 * last.
 */
const bankFingerprint = countConstructions(
  Effect.gen(function* bankFingerprints() {
    const suites: Record<string, SuiteFingerprint> = {};

    for (const id of bankIds) {
      suites[id] = yield* bankFingerprintOf(id);
    }

    return suites;
  }),
).pipe(
  Effect.map(({ constructions, value }): Fingerprint => ({
    compiled: constructions.compiled,
    probes: constructions.probes,
    suites: value,
  })),
);

if (import.meta.main || process.argv[1] === import.meta.filename) {
  void Effect.runPromise(
    bankFingerprint.pipe(
      Effect.flatMap(printFingerprint),
      Effect.matchEffect({
        onFailure: (error) =>
          Console.error(`bank fingerprint: ${String(error)}`).pipe(
            Effect.andThen(
              Effect.sync(() => {
                process.exitCode = 1;
              }),
            ),
          ),
        onSuccess: () => Effect.void,
      }),
    ),
  );
}
