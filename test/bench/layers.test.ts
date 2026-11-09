/**
 * The differential layer ladder: every rung's pipeline counts what its table row claims on a small
 * bank, and the rungs keep the table's ids and order.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { constVoid } from "effect/Function";
import * as Option from "effect/Option";

import { loadInput } from "../../bench/inputs/synthetic.ts";
import { rungs } from "../../bench/profile/layers.ts";
import { defaultTokenizer } from "../../src/tokenizer.ts";

/**
 * The rung ids in the order the ladder table lists them: the differential rungs, the
 * whole-document rungs, the re-chunked tokenizer rungs, then the typed decode and encode ladders.
 */
const tableOrder = [
  "transport",
  "tokenizer",
  "resolver",
  "collector",
  "schema",
  "positions",
  "tree-document",
  "typed-document",
  "error-document",
  "chunk-4k",
  "chunk-1m",
  "typed/tokenizer",
  "typed/resolver",
  "typed/collector",
  "typed/builder",
  "typed/structural",
  "typed/decode-string",
  "typed/to-type",
  "typed/resolve-fused",
  "typed/encode-structural",
  "typed/encode-writer",
  "typed/encode-tokenizer",
  "typed/encode-string",
  "typed/encode-to-type",
];

describe("layers", () => {
  it("keeps the table's rung ids, unique and in order", () => {
    const ids = rungs.map((rung) => rung.id);

    expect(ids).toEqual(tableOrder);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.effect("counts each rung's expected value on bank-16k", () =>
    Effect.gen(function* countsOnBank() {
      const input = Option.getOrThrow(yield* loadInput("bank-16k"));

      const observed = yield* Effect.all(
        rungs.map((rung) =>
          rung.prepare(input, defaultTokenizer).pipe(
            Effect.map((prepared) => ({
              expected: prepared.expected,
              id: rung.id,
              observed: prepared.check(prepared.run(constVoid)),
            })),
          ),
        ),
      );

      expect(observed.map(({ id, observed: count }) => ({ count, id }))).toEqual(
        observed.map(({ expected, id }) => ({ count: expected, id })),
      );
    }),
  );
});
