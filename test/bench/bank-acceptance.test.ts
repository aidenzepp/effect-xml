/**
 * Checks the fast decode and encode attempts themselves against the `src` standard path over the
 * synthetic item-bank inputs (guard F7.1), as `test/differential/acceptance.test.ts` does for the
 * guardrail suites' inputs.
 *
 * Each bank document is one root case, decoded with `ItemBank`, and each `qti-assessment-item-ref`
 * at the bank path is one record case, decoded with `ItemRef`, both read by `src`'s `decodeTree`.
 * The standard decode is `Schema.decodeUnknownEffect` of the definition's `standardOf` copy over
 * the same element. A case holds `attemptDecode` to two rules: the standard decode rejects, so the
 * attempt gives `None` (R1); the attempt gives `Some`, so the standard decode accepts with the same
 * value and own-key order (R2). The value the standard decode gives for a valid bank is one encode
 * case, held to the mirrors against the encode of `fromString(standardOf(ItemBank))`: that encode
 * fails, so `attemptEncode` gives `None`; the attempt gives `Some(text)`, so that encode gives the
 * byte-identical text. Each input also counts its cases whose `src` definition is structural, so
 * the suite cannot pass on opaque roots alone. The suite lives in `test/bench/` because only that
 * directory may import `bench/`, which owns the bank generator and `ItemBank`.
 */
import { isDeepStrictEqual } from "node:util";

import { describe, expect, it } from "@effect/vitest";
import * as Array from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { loadInput } from "../../bench/inputs/synthetic.ts";
import { ItemBank, bankPath } from "../../bench/vocabulary.ts";
import { decodeTree } from "../../src/codec.ts";
import { attemptDecode } from "../../src/fast-decode.ts";
import { attemptEncode } from "../../src/fast-encode.ts";
import { XmlSchema } from "../../src/index.ts";
import { structuralPlan } from "../../src/structural-slot.ts";
import { standardOf, valueSummary } from "../differential/harness.ts";
import type { Sides } from "../differential/harness.ts";
import { ItemRef } from "../streaming/vocabulary.ts";

/**
 * The bank inputs the suite checks, valid sizes first and then the bad-last variants, as
 * `bank-differential.test.ts` compares them.
 */
const bankIds = [
  "bank-16k",
  "bank-256k",
  "bank-4m",
  "bank-256k-bad-last",
  "bank-4m-bad-last",
] as const;

/**
 * The parser limits of the bench typed case, so the bank root, which spans the whole document,
 * is read at every size.
 */
const unlimited = { maxElementNodes: Infinity, maxElementSize: Infinity };

/**
 * An element codec built on `src` whose schemas need no services, the shape of each bank
 * definition and its `standardOf` copy.
 */
type Def = Schema.Codec<unknown, XmlSchema.XmlElement<string>>;

/**
 * The bank root as an element codec with an `unknown` Type, so the encode case takes the value the
 * standard decode gave as plain data.
 */
const itemBank: Def = ItemBank;

/**
 * The standard-path copy of {@link itemBank}, which the standard decode of a root case uses.
 */
const standardItemBank: Def = standardOf(itemBank);

/**
 * The standard-path copy of `ItemRef`, which the standard decode of a record case uses.
 */
const standardItemRef: Def = standardOf(ItemRef);

/**
 * The standard whole-document codec of the bank root, whose encode the attempt's text must match.
 */
const standardDocument = XmlSchema.fromString(standardItemBank, unlimited);

/**
 * The per-test timeout: both sides read `bank-4m` and decode its root and every record on Node.
 */
const timeout = 120_000;

/**
 * The counts one bank input accumulates, reported and asserted by its test.
 *
 * `structural` counts the decode cases whose `src` definition has a structural plan, the only ones
 * the attempt can answer `Some` for.
 */
interface Tally {
  records: number;
  structural: number;
  decodeAccepts: number;
  decodeRejects: number;
  readonly falseRejects: string[];
  encodeAccepts: number;
  encodeRejects: number;
  readonly encodeFalseRejects: string[];
  readonly violations: string[];
}

// Native: `src/resolve.ts` `collect` selects records from resolved events inside a channel, not from a collected `ResolvedElement`, and a channel run stops at its first failing record.
/**
 * Select the records a record path names in a collected tree, in document order, as a channel's
 * `collect` selects them: each step is `"*"` or the Clark name of the element at its depth, from
 * the root.
 *
 * @param element - The element at `depth`, the root at depth zero.
 * @param path - The record path.
 * @param depth - The path step `element` is matched against.
 * @returns The records under `element`.
 */
const recordsAt = (
  element: XmlSchema.ResolvedElement,
  path: readonly string[],
  depth = 0,
): readonly XmlSchema.ResolvedElement[] => {
  const step = path[depth];

  if (step !== "*" && step !== element.name) {
    return [];
  }

  if (depth === path.length - 1) {
    return [element];
  }

  return element.children.flatMap((child) =>
    Predicate.isString(child) ? [] : recordsAt(child, path, depth + 1),
  );
};

/**
 * Check one decode case against R1 and R2 and count it.
 *
 * @param tally - The input's counts.
 * @param id - The case id.
 * @param defs - The definition the attempt decodes with and its `standardOf` copy.
 * @param element - The element `src`'s `decodeTree` read.
 * @returns The standard decode's value, or `None` when it rejects.
 */
const checkDecode = Effect.fnUntraced(function* checkDecode(
  tally: Tally,
  id: string,
  defs: Sides<Def>,
  element: XmlSchema.ResolvedElement,
) {
  const standardExit = yield* Effect.exit(Schema.decodeUnknownEffect(defs.standard)(element));
  const fast = yield* attemptDecode(defs.src)(element);

  tally.structural += structuralPlan(defs.src) === undefined ? 0 : 1;

  if (Exit.isSuccess(standardExit)) {
    tally.decodeAccepts += 1;

    if (Option.isNone(fast)) {
      tally.falseRejects.push(id);
    } else if (!isDeepStrictEqual(valueSummary(fast.value), valueSummary(standardExit.value))) {
      tally.violations.push(`decode ${id}: R2, the attempt's value differs from the standard's`);
    }

    return Option.some(standardExit.value);
  }

  if (Cause.hasFails(standardExit.cause)) {
    tally.decodeRejects += 1;
  } else {
    tally.violations.push(`decode ${id}: the standard decode died`);
  }

  if (Option.isSome(fast)) {
    tally.violations.push(
      `decode ${id}: R1, the standard decode rejects but the attempt gave Some`,
    );
  }

  return Option.none();
});

/**
 * Check the encode of a bank's decoded value against the encode mirrors and count it.
 *
 * @param tally - The input's counts.
 * @param id - The case id.
 * @param value - The value the standard decode gave for the bank.
 * @returns An effect that completes once the case is counted.
 */
const checkEncode = Effect.fnUntraced(function* checkEncode(
  tally: Tally,
  id: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- plain data the standard decode gave; each path's own encode is the parser under test.
  value: unknown,
) {
  const standardExit = yield* Effect.exit(Schema.encodeUnknownEffect(standardDocument)(value));
  const fast = yield* attemptEncode(itemBank)(value);

  if (Exit.isSuccess(standardExit)) {
    tally.encodeAccepts += 1;

    if (Option.isNone(fast)) {
      tally.encodeFalseRejects.push(id);
    } else if (fast.value !== standardExit.value) {
      tally.violations.push(`encode ${id}: the attempt's text differs from the standard's`);
    }

    return;
  }

  tally.encodeRejects += 1;

  if (Option.isSome(fast)) {
    tally.violations.push(`encode ${id}: the standard encode fails but the attempt gave Some`);
  }
});

/**
 * Check one bank input: its root case, each record case, and the encode of the root's value.
 *
 * @param id - The bank input id.
 * @returns The input's counts.
 */
const checkBank = Effect.fnUntraced(function* checkBank(id: string) {
  const input = yield* Effect.fromOption(yield* loadInput(id));
  const document = yield* Effect.fromOption(Array.head(input.documents));
  const root = yield* decodeTree(unlimited)(document.text);
  const records = recordsAt(root, bankPath);

  const tally: Tally = {
    decodeAccepts: 0,
    decodeRejects: 0,
    encodeAccepts: 0,
    encodeFalseRejects: [],
    encodeRejects: 0,
    falseRejects: [],
    records: records.length,
    structural: 0,
    violations: [],
  };

  const value = yield* checkDecode(
    tally,
    `${id}#root`,
    { src: itemBank, standard: standardItemBank },
    root,
  );

  for (const [index, record] of records.entries()) {
    yield* checkDecode(
      tally,
      `${id}#record-${index}`,
      { src: ItemRef, standard: standardItemRef },
      record,
    );
  }

  if (Option.isSome(value)) {
    yield* checkEncode(tally, `${id}#root-value`, value.value);
  }

  return tally;
});

describe("bank fast-path acceptance in both directions", () => {
  for (const id of bankIds) {
    it.effect(
      `${id}: every attempt the standard path rejects gives None, every Some matches it`,
      () =>
        Effect.gen(function* holds() {
          const tally = yield* checkBank(id);

          console.log(`bank acceptance ${id}: ${JSON.stringify(tally)}`);

          expect(tally.violations).toStrictEqual([]);
          expect(tally.records).toBeGreaterThan(0);
          expect(tally.structural).toBe(tally.records + 1);
          expect(tally.decodeAccepts).toBeGreaterThan(0);

          if (id.endsWith("-bad-last")) {
            expect(tally.decodeRejects).toBeGreaterThan(0);
          } else {
            expect(tally.falseRejects).toStrictEqual([]);
            expect(tally.encodeFalseRejects).toStrictEqual([]);
            expect(tally.encodeAccepts).toBe(1);
          }
        }),
      timeout,
    );
  }
});
