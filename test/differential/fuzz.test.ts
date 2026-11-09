/**
 * Compares the `src` fast path with the `src` standard path over fuzzed documents: mutants of the
 * QTI corpus, the streaming fixture, and the feature roots' encoded texts, drawn by
 * `effect/Arbitrary` with a fixed seed.
 *
 * Each mutant runs under four variants (no options, `errors: "all"`, small record budgets, small
 * parser limits). Per variant, each side decodes the text with `ElementFromString`, with
 * `fromString` of the seed's root, directly with `Schema.decodeUnknownExit` of that root over its
 * own raw tree when the tree decodes, and through `decodeSchemaString` over the drawn pieces with
 * `positions` off and on. A property check with the same seed draws fresh mutants and shrinks a
 * disagreement to its smallest draw. The suite counts outcomes by kind and asserts each of a
 * decoded value, `SchemaFailure`, `WellFormedness`, `UndeclaredPrefix`, and every `Limit` occurs,
 * so it cannot pass on a generator that produces only valid or only malformed input.
 *
 * Each surface runs once over the `src` root and record definition and once over their
 * `standardOf` copies, and every observation compares strictly equal. The `fromString` decode and
 * both `decodeSchemaString` runs take the fast path on the `src` side, so they compare the fast
 * path with the standard path; a failed fast-path attempt returns the standard path's result, so
 * their failing outcomes guard against false accepts only. The `ElementFromString` raw-tree decode
 * and the direct `Schema.decodeUnknownExit` never take the fast path, so they run the standard path
 * on both sides and stay as smoke coverage of it (accepted loss L1,
 * `docs/goals/performance/phase-3.slices.md`). The suite counts the inputs whose `src` root and
 * record definition take the structural fast path, so its fast-path surfaces cannot pass by
 * comparing the standard path with itself.
 */
import { isDeepStrictEqual } from "node:util";

import { describe, expect, it } from "@effect/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { XmlSchema as SrcXml } from "../../src/index.ts";
import { structuralPlan } from "../../src/structural-slot.ts";
import { textChunks } from "./corpus.cases.ts";
import {
  DrawSchema,
  fuzzInputs,
  inputsOf,
  operators,
  runs,
  seed,
  seedOf,
  seeds,
  size,
  variants,
} from "./fuzz.cases.ts";
import type { Draw, FuzzInput } from "./fuzz.cases.ts";
import {
  channelDecode,
  directOutcome,
  documentDecode,
  src,
  standard,
  standardOf,
} from "./harness.ts";
import type {
  ChannelOutcome,
  DecodeOutcome,
  DecodeReasonSummary,
  DirectOutcome,
  Side,
} from "./harness.ts";

/**
 * A direct decode that did not run because the raw-tree decode before it failed.
 */
type NoTree = "no tree";

/**
 * Every caller-visible outcome of one fuzzed input on one side.
 */
interface Observation {
  readonly tree: DecodeOutcome;
  readonly typed: DecodeOutcome;
  readonly direct: DirectOutcome | NoTree;
  readonly channel: ChannelOutcome;
  readonly channelPositions: ChannelOutcome;
}

/**
 * One side's codecs for an input, every one built by `src`'s entry point over that side's roots.
 */
interface Built {
  readonly side: Side;
  readonly tree: Schema.Codec<unknown, string>;
  readonly typed: Schema.Codec<unknown, string>;
  readonly root: Schema.Codec<unknown, unknown>;
  readonly channel: (positions: boolean) => Effect.Effect<ChannelOutcome>;
}

/**
 * Build the `src` side's codecs and channel for an input.
 *
 * @param input - The fuzzed input.
 * @returns The `src` side's builders.
 */
const srcBuilt = (input: FuzzInput): Built => ({
  channel: (positions) =>
    channelDecode(
      SrcXml.decodeSchemaString(input.record.src, input.path),
      Stream.fromIterable(textChunks(input)),
      { ...input.options, positions },
      input.parseOptions,
    ),
  root: input.roots.src,
  side: src,
  tree: SrcXml.ElementFromString(input.prefixes, input.options),
  typed: SrcXml.fromString(input.roots.src, input.options),
});

/**
 * Build the standard side's codecs and channel for an input, as {@link srcBuilt} does, over the
 * `standardOf` copies of the roots and of the raw-tree codec.
 *
 * @param input - The fuzzed input.
 * @returns The standard side's builders.
 */
const standardBuilt = (input: FuzzInput): Built => ({
  channel: (positions) =>
    channelDecode(
      SrcXml.decodeSchemaString(input.record.standard, input.path),
      Stream.fromIterable(textChunks(input)),
      { ...input.options, positions },
      input.parseOptions,
    ),
  root: input.roots.standard,
  side: standard,
  tree: standardOf(SrcXml.ElementFromString(input.prefixes, input.options)),
  typed: SrcXml.fromString(input.roots.standard, input.options),
});

/**
 * Observe every surface of one input on one side.
 *
 * @param built - The side's builders for the input.
 * @param input - The fuzzed input.
 * @returns The side's observation.
 */
const observe = Effect.fnUntraced(function* observe(built: Built, input: FuzzInput) {
  const tree = yield* documentDecode(built.side, built.tree, input.text, input.parseOptions);

  const observation: Observation = {
    channel: yield* built.channel(false),
    channelPositions: yield* built.channel(true),
    direct:
      "value" in tree
        ? directOutcome(Schema.decodeUnknownExit(built.root)(tree.value, input.parseOptions))
        : "no tree",
    tree,
    typed: yield* documentDecode(built.side, built.typed, input.text, input.parseOptions),
  };

  return observation;
});

/**
 * Tell whether a decode outcome is a failure: neither a value nor a defect.
 *
 * @param outcome - The `src` side's typed decode outcome.
 * @returns `true` for a failure with an outer Schema error.
 */
const isFailure = (outcome: DecodeOutcome): boolean => "schema" in outcome;

/**
 * Name the kind of a decode reason: its `_tag`, and for a `Limit` its limit, as `Limit:maxDepth`.
 *
 * @param reason - The reason's summary.
 * @returns The reason's kind.
 */
const reasonKind = (reason: DecodeReasonSummary): string =>
  reason._tag === "Limit" ? `Limit:${reason.limit}` : reason._tag;

/**
 * Name the kind of one document or channel outcome.
 *
 * @param outcome - One side's outcome.
 * @returns `"value"` for a decoded value or a channel run that ended `"done"`, the library
 *   reason's kind, `"schema only"` for a failure with no library error, or `"defect"`.
 */
const kindOf = (outcome: DecodeOutcome | ChannelOutcome): string => {
  if ("end" in outcome) {
    if (outcome.end === "done") {
      return "value";
    }

    return "defect" in outcome.end ? "defect" : reasonKind(outcome.end.reason);
  }

  if ("value" in outcome) {
    return "value";
  }

  if ("defect" in outcome) {
    return "defect";
  }

  return outcome.xml === "none" ? "schema only" : reasonKind(outcome.xml.reason);
};

/**
 * The outcome kinds the suite must observe on the `src` side at least once.
 */
const requiredKinds: readonly string[] = [
  "value",
  "SchemaFailure",
  "WellFormedness",
  "UndeclaredPrefix",
  "Limit:maxElementNodes",
  "Limit:maxElementSize",
  "Limit:maxDepth",
  "Limit:maxTokenSize",
];

/**
 * The per-test timeout for the two comparison tests. Each runs in about 2 s on an idle machine,
 * under Vitest's 5 s default, so a heavily loaded machine can exceed the default; 60 s leaves room
 * for that load without masking a hang.
 */
const timeout = 60_000;

/**
 * The counts the suite accumulates, checked by the final test: compared inputs, outcomes by kind,
 * inputs by operator and variant, the property check's typed failures, and the compared inputs
 * whose `src` root and `src` record definition each have a structural plan.
 */
const tally = {
  compared: 0,
  kinds: new Map<string, number>(),
  operators: new Map<string, number>(),
  propertyFailures: 0,
  structural: { records: 0, roots: 0 },
  variants: new Map<string, number>(),
};

/**
 * Add one to a count.
 *
 * @param counts - The counts.
 * @param key - The counted key.
 */
const bump = (counts: Map<string, number>, key: string): void => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

/**
 * Compare every surface of one drawn mutant on both sides inside the property check.
 *
 * @param draw - The drawn mutant description.
 * @returns An effect that succeeds with `true` when both sides agree on every variant.
 */
const agrees = Effect.fnUntraced(function* agrees(draw: Draw) {
  for (const input of inputsOf(draw, 0, seedOf(draw))) {
    const left = yield* observe(srcBuilt(input), input);
    const right = yield* observe(standardBuilt(input), input);

    tally.propertyFailures += isFailure(left.typed) ? 1 : 0;

    if (!isDeepStrictEqual(left, right)) {
      return false;
    }
  }

  return true;
});

describe("differential: fuzzed documents' errors, limits, and positions", () => {
  it.effect(
    `every surface agrees over ${runs} drawn mutants (seed ${seed})`,
    () =>
      Effect.gen(function* compares() {
        let failures = 0;

        for (const input of fuzzInputs) {
          const left = yield* observe(srcBuilt(input), input);
          const right = yield* observe(standardBuilt(input), input);

          expect.soft([input.id, left]).toStrictEqual([input.id, right]);
          failures += isFailure(left.typed) ? 1 : 0;
          tally.compared += 1;
          tally.structural.roots += structuralPlan(input.roots.src) === undefined ? 0 : 1;
          tally.structural.records += structuralPlan(input.record.src) === undefined ? 0 : 1;
          bump(tally.operators, input.operator);
          bump(tally.variants, input.variant);

          for (const outcome of [left.tree, left.typed, left.channel, left.channelPositions]) {
            bump(tally.kinds, kindOf(outcome));
          }
        }

        expect(fuzzInputs).toHaveLength(runs * variants.length);
        expect(failures).toBeGreaterThan(0);
      }),
    timeout,
  );

  it.effect(
    `every surface agrees over fresh mutants (seed ${seed})`,
    () =>
      Effect.gen(function* holds() {
        const result = yield* Arbitrary.checkEffect(Arbitrary.schema(DrawSchema), agrees, {
          runs,
          seed,
          size,
        });

        expect(Arbitrary.formatCheckFailure(result)).toBeUndefined();
        expect(result._tag === "Passed" ? result.runs : 0).toBe(runs);
        expect(tally.propertyFailures).toBeGreaterThan(0);
      }),
    timeout,
  );

  it("compared inputs, structural roots, every outcome kind, operator, and variant", () => {
    expect(seeds.length).toBeGreaterThan(0);
    expect(tally.compared).toBe(runs * variants.length);
    expect(tally.structural.roots).toBeGreaterThan(0);
    expect(tally.structural.records).toBeGreaterThan(0);

    for (const kind of requiredKinds) {
      expect([kind, (tally.kinds.get(kind) ?? 0) > 0]).toStrictEqual([kind, true]);
    }

    for (const operator of operators) {
      expect([operator, (tally.operators.get(operator) ?? 0) > 0]).toStrictEqual([operator, true]);
    }

    for (const variant of variants) {
      expect([variant, tally.variants.get(variant) ?? 0]).toStrictEqual([variant, runs]);
    }
  });
});
