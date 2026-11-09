/**
 * Compares the `src` fast path with the `src` standard path over wrapped element codecs: `leaf`
 * under `.check`, `Schema.decodeTo`, `.annotate`, and `Schema.brand`, beside the bare element, at
 * a child slot, a `mixed` member, and the root, on every surface a caller reaches. Each surface
 * runs once over the `src` root and once over its `standardOf` copy, and every outcome compares
 * strictly equal.
 *
 * The `fromString` decodes and encodes and both `decodeSchemaString` runs take the fast path on the
 * `src` side, so they compare the fast path with the standard path; a failed fast-path attempt
 * returns the standard path's result, so their failing outcomes guard against false accepts only.
 * The `ElementFromString` resolve (`resolved`) and the direct decode and encodes through `Schema`
 * (`direct`, `directEncode`, `directEncodeBare`) never take the fast path, so they run the standard
 * path on both sides and stay as smoke coverage of it (accepted loss L1,
 * `docs/goals/performance/phase-3.slices.md`).
 *
 * Every wrapper must keep its meaning through the plan, so the suite also asserts on each side
 * that the check rejects at every placement and the transformation changes the value at every
 * placement; it cannot pass if a side ignores the wrapper. The `src` side must hold at least one
 * structural root and the standard side none, so the fast-path surfaces cannot compare the standard
 * path with itself. The `Schema.decodeTo` roots are opaque on both sides, so their `fromString`
 * surfaces run the standard path on both sides too.
 */
import { isDeepStrictEqual } from "node:util";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { XmlSchema as SrcXml } from "../../src/index.ts";
import { structuralPlan } from "../../src/structural-slot.ts";
import {
  channelDecode,
  directOutcome,
  documentDecode,
  documentEncode,
  src,
  standard,
} from "./harness.ts";
import type {
  ChannelOutcome,
  DecodeOutcome,
  DirectOutcome,
  EncodeOutcome,
  Side,
  Sides,
} from "./harness.ts";
import { placements, variants, wrappedInputs } from "./wrapped.cases.ts";
import type { Placement, Variant, WrappedInput, Wrapper } from "./wrapped.cases.ts";

/**
 * A surface that did not run because the run it reads from produced no value.
 */
type Skipped = "not decoded" | "not resolved";

/**
 * Every caller-visible outcome of one wrapped input on one side.
 *
 * `resolved` is the input's resolved element tree, the direct codec's input. `resolved` and the
 * `direct` surfaces run the standard path on both sides. The encode surfaces write back the value
 * the same surface decoded, and the `Bare` surfaces write the bare `leaf` document's value through
 * the wrapped codec, so an encode-side check is compared too.
 */
interface Observation {
  readonly resolved: DirectOutcome;
  readonly decode: DecodeOutcome;
  readonly decodeAll: DecodeOutcome;
  readonly encode: EncodeOutcome | Skipped;
  readonly encodeBare: EncodeOutcome | Skipped;
  readonly direct: DirectOutcome | Skipped;
  readonly directEncode: DirectOutcome | Skipped;
  readonly directEncodeBare: DirectOutcome | Skipped;
  readonly channel: ChannelOutcome;
  readonly channelPositions: ChannelOutcome;
}

/**
 * The codecs and channel runs one side builds for one input, every one from `src`'s entry point
 * over that side's root.
 */
interface Built {
  readonly side: Side;
  readonly resolve: Schema.Codec<unknown, string>;
  readonly document: Schema.Codec<unknown, string>;
  readonly bareDocument: Schema.Codec<unknown, string>;
  readonly root: Schema.Codec<unknown, unknown>;
  readonly bareRoot: Schema.Codec<unknown, unknown>;
  readonly channel: (positions: boolean) => Effect.Effect<ChannelOutcome>;
}

/**
 * Find the bare-`leaf` input at an input's placement holding its variant.
 *
 * @param input - The wrapped input.
 * @returns The bare input it is measured against.
 * @throws {Error} When the cases hold no such input.
 */
const bareOf = (input: WrappedInput): WrappedInput => {
  const found = wrappedInputs.find(
    ({ placement, variant, wrapper }) =>
      wrapper === "bare" && placement === input.placement && variant === input.variant,
  );

  if (found === undefined) {
    throw new Error(`no bare input for ${input.id}`);
  }

  return found;
};

/**
 * The harness side each key of an input's {@link Sides} runs as.
 */
const sideOf: Readonly<Record<keyof Sides<unknown>, Side>> = { src, standard };

/**
 * Make the builder of one side's codecs and channel runs for an input.
 *
 * @param key - The side whose root and record definition the builds use.
 * @returns A function that builds that side's codecs and channel runs for an input.
 */
const builtOn =
  (key: keyof Sides<unknown>) =>
  (input: WrappedInput): Built => ({
    bareDocument: SrcXml.fromString(bareOf(input).roots[key]),
    bareRoot: bareOf(input).roots[key],
    channel: (positions) =>
      channelDecode(
        SrcXml.decodeSchemaString(input.record[key], input.path),
        Stream.make(input.text),
        { positions },
      ),
    document: SrcXml.fromString(input.roots[key]),
    resolve: SrcXml.ElementFromString({}),
    root: input.roots[key],
    side: sideOf[key],
  });

/**
 * Observe every surface of one input on one side.
 *
 * @param built - The side's codecs and channel runs for the input.
 * @param text - The input's document text.
 * @returns The side's observation.
 */
const observe = Effect.fnUntraced(function* observe(built: Built, text: string) {
  const decode = yield* documentDecode(built.side, built.document, text);
  const bareDecode = yield* documentDecode(built.side, built.bareDocument, text);
  const resolvedExit = Schema.decodeUnknownExit(built.resolve)(text);

  const directExit = Exit.isSuccess(resolvedExit)
    ? Schema.decodeUnknownExit(built.root)(resolvedExit.value)
    : undefined;

  const bareDirectExit = Exit.isSuccess(resolvedExit)
    ? Schema.decodeUnknownExit(built.bareRoot)(resolvedExit.value)
    : undefined;

  const observation: Observation = {
    channel: yield* built.channel(false),
    channelPositions: yield* built.channel(true),
    decode,
    decodeAll: yield* documentDecode(built.side, built.document, text, { errors: "all" }),
    direct: directExit === undefined ? "not resolved" : directOutcome(directExit),
    directEncode:
      directExit !== undefined && Exit.isSuccess(directExit)
        ? directOutcome(Schema.encodeUnknownExit(built.root)(directExit.value))
        : "not decoded",
    directEncodeBare:
      bareDirectExit !== undefined && Exit.isSuccess(bareDirectExit)
        ? directOutcome(Schema.encodeUnknownExit(built.root)(bareDirectExit.value))
        : "not decoded",
    encode:
      "value" in decode
        ? yield* documentEncode(built.side, built.document, decode.value)
        : "not decoded",
    encodeBare:
      "value" in bareDecode
        ? yield* documentEncode(built.side, built.document, bareDecode.value)
        : "not decoded",
    resolved: directOutcome(resolvedExit),
  };

  return observation;
});

/**
 * Count the surfaces of an observation that ran, so a comparison of skipped surfaces only cannot
 * pass as a comparison.
 *
 * @param observation - One side's observation.
 * @returns The number of surfaces with an outcome.
 */
const ranSurfaces = (observation: Observation): number =>
  Object.values(observation).filter(Predicate.isObject).length;

/**
 * The number of surfaces the suite compares across all inputs, pinned so a change to the matrix
 * is deliberate.
 */
const expectedSurfaces = 384;

/**
 * Observe every input on one side, keyed by input id.
 *
 * @param build - Builds the side's codecs and channel runs for an input.
 * @returns Each input's observation on that side.
 */
const observeAll = Effect.fnUntraced(function* observeAll(build: (input: WrappedInput) => Built) {
  const observations = new Map<string, Observation>();

  for (const input of wrappedInputs) {
    observations.set(input.id, yield* observe(build(input), input.text));
  }

  return observations;
});

/**
 * Read the observation of the input with a wrapper, placement, and variant.
 *
 * @param observations - One side's observations by input id.
 * @param wrapper - The wrapper.
 * @param placement - The placement.
 * @param variant - The variant.
 * @returns The observation.
 * @throws {Error} When the cases hold no such input.
 */
const observationOf = (
  observations: ReadonlyMap<string, Observation>,
  wrapper: Wrapper,
  placement: Placement,
  variant: Variant,
): Observation => {
  const found = observations.get(`${wrapper}/${placement}/${variant}`);

  if (found === undefined) {
    throw new Error(`no observation for ${wrapper}/${placement}/${variant}`);
  }

  return found;
};

describe("differential: wrapped element codecs", () => {
  for (const input of wrappedInputs) {
    it.effect(`compares every surface of ${input.id}`, () =>
      Effect.gen(function* compares() {
        const left = yield* observe(builtOn("src")(input), input.text);
        const right = yield* observe(builtOn("standard")(input), input.text);

        expect(ranSurfaces(left)).toBeGreaterThan(0);
        expect(left).toStrictEqual(right);
      }),
    );
  }

  for (const key of ["src", "standard"] as const) {
    it.effect(`applies every wrapper at every placement on the ${key} side`, () =>
      Effect.gen(function* applies() {
        const build = builtOn(key);
        const observations = yield* observeAll(build);

        const compared = [...observations.values()].reduce(
          (total, observation) => total + ranSurfaces(observation),
          0,
        );

        const structural = wrappedInputs.filter(
          (input) => structuralPlan(build(input).root) !== undefined,
        ).length;

        expect(compared).toBeGreaterThan(0);
        expect(compared).toBe(expectedSurfaces);
        expect([key, structural > 0]).toStrictEqual([key, key === "src"]);

        for (const placement of placements) {
          const bareRefused = observationOf(observations, "bare", placement, "refused");
          const checkRefused = observationOf(observations, "check", placement, "refused");
          const bareOk = observationOf(observations, "bare", placement, "ok");
          const transformed = observationOf(observations, "decodeTo", placement, "ok");

          expect("value" in bareRefused.decode).toBe(true);
          expect(
            "xml" in checkRefused.decode && checkRefused.decode.xml !== "none"
              ? checkRefused.decode.xml.reason._tag
              : "accepted",
          ).toBe("SchemaFailure");

          expect("value" in bareOk.decode && "value" in transformed.decode).toBe(true);
          expect(isDeepStrictEqual(bareOk.decode, transformed.decode)).toBe(false);

          for (const variant of variants) {
            const bare = observationOf(observations, "bare", placement, variant);

            expect(
              observationOf(observations, "annotate", placement, variant).decode,
            ).toStrictEqual(bare.decode);
            expect(observationOf(observations, "brand", placement, variant).decode).toStrictEqual(
              bare.decode,
            );
          }
        }
      }),
    );
  }
});
