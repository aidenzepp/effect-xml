/**
 * Compares the `src` fast path with the `src` standard path over generated values: values drawn by
 * `effect/Arbitrary` for each feature root and vocabulary root, the hand-built samples, and
 * corruptions of every feature value at one leaf. Each surface runs once over the `src` root and
 * once over its `standardOf` copy, and the outcomes must be strictly equal.
 *
 * P1 encodes each value with `fromString`, P1t repeats it with a copy of `src`'s default tokenizer
 * provided per side, P2 decodes P1's text, P3 runs the element codec directly (encode, then decode
 * of the result), P4 reads P1's text through the record channel with positions off and on, and P5
 * encodes the corruptions on the `fromString` and direct surfaces. A property check with the same
 * seed draws fresh values and shrinks a disagreement to its smallest input.
 *
 * P1, P1t, P2, P4, and P5's `fromString` encodes take the fast path on the `src` side, so they
 * compare the fast path with the standard path; a failed fast-path attempt returns the standard
 * path's result, so their failing outcomes guard against false accepts only. P3 (the direct encode
 * and its round-trip decode) and P5's direct encodes never take the fast path, so they run the
 * standard path on both sides and stay as smoke coverage of it (accepted loss L1,
 * `docs/goals/performance/phase-3.slices.md`).
 *
 * The suite also counts the features its encoded values exercise, the encode reasons its
 * corruptions provoke, and the inputs whose `src` root takes the structural fast path, and it pins
 * the reason of every sample corruption, so it cannot pass by comparing nothing, and its fast-path
 * surfaces cannot pass by comparing the standard path with itself.
 */
import { isDeepStrictEqual } from "node:util";

import { describe, expect, it } from "@effect/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as Arr from "effect/Array";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Order from "effect/Order";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import * as Stream from "effect/Stream";

import { XmlSchema as SrcXml } from "../../src/index.ts";
import { structuralPlan } from "../../src/structural-slot.ts";
import { defaultTokenizer } from "../../src/tokenizer.ts";
import {
  documentInputs,
  encodeInputs,
  generatedRoots,
  messageOf,
  runs,
  seed,
  size,
} from "./generated.cases.ts";
import type {
  GeneratedDocumentInput,
  GeneratedEncodeInput,
  GeneratedRoot,
  RootId,
  SrcRoot,
} from "./generated.cases.ts";
import {
  channelDecode,
  directOutcome,
  documentDecode,
  documentEncode,
  src,
  standard,
  withTokenizer,
} from "./harness.ts";
import type {
  ChannelOutcome,
  DecodeOutcome,
  DirectOutcome,
  EncodeOutcome,
  EncodeReasonSummary,
  Side,
} from "./harness.ts";

/**
 * A direct decode that did not run because the direct encode before it failed.
 */
type NotEncoded = "not encoded";

/**
 * Every caller-visible outcome of encoding one value on one side.
 *
 * `encode` is P1 (and P5 for a corruption), `encodeTokenizer` is P1t, `direct` and `roundTrip`
 * are P3: the element codec's encode, then its decode of that encoded element.
 */
interface EncodeObservation {
  readonly encode: EncodeOutcome;
  readonly encodeTokenizer: EncodeOutcome;
  readonly direct: DirectOutcome;
  readonly roundTrip: DirectOutcome | NotEncoded;
}

/**
 * Every caller-visible outcome of reading one encoded text on one side: P2 through the
 * whole-document codec and P4 through the record channel at the root's path.
 */
interface DocumentObservation {
  readonly decode: DecodeOutcome;
  readonly channel: ChannelOutcome;
  readonly channelPositions: ChannelOutcome;
}

/**
 * One side's builders for a root: its whole-document codec, its element codec, its record channel,
 * and the tokenizer its P1t encode provides.
 */
interface Built {
  readonly side: Side;
  readonly document: Schema.Codec<unknown, string>;
  readonly root: Schema.Codec<unknown, unknown>;
  readonly tokenizer: SrcXml.Tokenizer;
  readonly channel: (
    path: readonly string[],
    text: string,
    positions: boolean,
  ) => Effect.Effect<ChannelOutcome>;
}

/**
 * Build one side's codecs and channel for a root.
 *
 * The provided tokenizer is a fresh spread copy of `src`'s default, so each side's P1t encode
 * provides its own value that is not the default reference yet behaves the same.
 *
 * @param side - The side the root belongs to.
 * @param root - The `src` root, or its standard-path copy for the standard side.
 * @returns The side's builders.
 */
const builtOf = (side: Side, root: SrcRoot): Built => ({
  channel: (path, text, positions) =>
    channelDecode(SrcXml.decodeSchemaString(root, path), Stream.make(text), { positions }),
  document: SrcXml.fromString(root),
  root,
  side,
  // oxlint-disable-next-line typescript/no-misused-spread -- `defaultTokenizer` is a plain object literal (`src/tokenizer.ts:114`); a spread copy is the provided value P1t needs.
  tokenizer: { ...defaultTokenizer },
});

/**
 * Observe every encode surface of one value on one side.
 *
 * @param built - The side's builders for the value's root.
 * @param value - The value, possibly a corruption.
 * @param parseOptions - The Schema parse options of every run.
 * @returns The side's observation.
 */
const observeEncode = Effect.fnUntraced(function* observeEncode(
  built: Built,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- plain data, possibly a deliberate corruption; each side's codec is the parser under test.
  value: unknown,
  parseOptions?: SchemaAST.ParseOptions,
) {
  const directExit = Schema.encodeUnknownExit(built.root)(value, parseOptions);

  const observation: EncodeObservation = {
    direct: directOutcome(directExit),
    encode: yield* documentEncode(built.side, built.document, value, parseOptions),
    encodeTokenizer: yield* withTokenizer(
      built.side,
      documentEncode(built.side, built.document, value, parseOptions),
      built.tokenizer,
    ),
    roundTrip: Exit.isSuccess(directExit)
      ? directOutcome(Schema.decodeUnknownExit(built.root)(directExit.value, parseOptions))
      : "not encoded",
  };

  return observation;
});

/**
 * Observe every decode surface of one text on one side.
 *
 * @param built - The side's builders for the text's root.
 * @param input - The text input.
 * @returns The side's observation.
 */
const observeDocument = Effect.fnUntraced(function* observeDocument(
  built: Built,
  input: GeneratedDocumentInput,
) {
  const observation: DocumentObservation = {
    channel: yield* built.channel(input.path, input.text, false),
    channelPositions: yield* built.channel(input.path, input.text, true),
    decode: yield* documentDecode(built.side, built.document, input.text),
  };

  return observation;
});

/**
 * Derive an `Arbitrary` for a root's decoded type and report how it went.
 *
 * @param root - One side's root definition.
 * @returns `"derived"`, or the derivation's error message.
 */
const derivationOf = (root: Schema.Top): Effect.Effect<string> =>
  Effect.try({
    catch: messageOf,
    try: () => Arbitrary.schema(Schema.toType(root)),
  }).pipe(Effect.match({ onFailure: (message) => message, onSuccess: () => "derived" }));

/**
 * The value inputs of one root.
 *
 * @param id - The root id.
 * @returns The root's value inputs, in cases order.
 */
const encodeInputsOf = (id: RootId): readonly GeneratedEncodeInput[] =>
  encodeInputs.filter(({ root }) => root === id);

/**
 * The text inputs of one root.
 *
 * @param id - The root id.
 * @returns The root's text inputs, in cases order.
 */
const documentInputsOf = (id: RootId): readonly GeneratedDocumentInput[] =>
  documentInputs.filter(({ root }) => root === id);

/**
 * A Plan feature an encoded value can exercise.
 */
type Feature =
  | "Array empty"
  | "Array non-empty"
  | "attributes"
  | "data-*"
  | "mixed closed"
  | "mixed open"
  | "open elements"
  | "optionalKey absent"
  | "optionalKey present"
  | "plain slot"
  | "prefixed attribute"
  | "second-namespace child"
  | "suspend"
  | "text";

/**
 * Every feature the suite counts, each of which must be exercised by at least one encoded value.
 */
const features: readonly Feature[] = [
  "attributes",
  "prefixed attribute",
  "data-*",
  "text",
  "plain slot",
  "optionalKey present",
  "optionalKey absent",
  "Array empty",
  "Array non-empty",
  "open elements",
  "mixed closed",
  "mixed open",
  "suspend",
  "second-namespace child",
];

/**
 * The roots whose top-level declaration has attributes: every root but `Para`.
 */
const attributed: ReadonlySet<RootId> = new Set<RootId>([
  "Catalog",
  "Node",
  "Bag",
  "Doc",
  "ItemRef",
  "AssessmentTest",
  "AssessmentItem",
]);

/**
 * Collect every own key and its field at every depth of a value.
 *
 * @param value - The decoded value.
 * @returns Each key with its field, depth first.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a generated or hand-built value of any root, walked as plain data.
const entriesOf = (value: unknown): readonly (readonly [string, unknown])[] => {
  if (Array.isArray(value)) {
    return value.flatMap(entriesOf);
  }

  if (Predicate.isObject(value)) {
    return Object.entries(value).flatMap(([key, field]) => [
      [key, field] as const,
      ...entriesOf(field),
    ]);
  }

  return [];
};

/**
 * Name the features one encoded value exercises.
 *
 * The feature roots fix where each feature sits: `Catalog` holds the plain, `optionalKey`, and
 * `Array` slots and the second-namespace `extra` child, `node.child` is the `suspend` recursion,
 * `Bag`'s `*` slot is open `elements`, and `Para` and `Doc` are `mixed` closed and open.
 *
 * @param root - The value's root.
 * @param value - The value.
 * @returns The features it exercises.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a generated or hand-built value of any root, inspected as plain data.
const featuresOf = (root: RootId, value: unknown): readonly Feature[] => {
  const entries = entriesOf(value);

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a field of any depth of the value, read as plain data.
  const has = (predicate: (key: string, field: unknown) => boolean) =>
    entries.some(([key, field]) => predicate(key, field));

  const items = (key: string): readonly unknown[] => {
    const field: unknown = Predicate.isObject(value) ? value[key] : undefined;

    return Array.isArray(field) ? field : [];
  };

  const catalog = root === "Catalog";

  const found: readonly (readonly [Feature, boolean])[] = [
    ["attributes", attributed.has(root)],
    ["prefixed attribute", has((key) => key === "p:level" || key === "p:id")],
    ["data-*", has((key) => key.startsWith("data-"))],
    ["text", has((key) => key === "$text")],
    ["plain slot", catalog],
    ["optionalKey present", catalog && Predicate.hasProperty(value, "note")],
    ["optionalKey absent", catalog && !Predicate.hasProperty(value, "note")],
    ["Array empty", catalog && items("entry").length === 0],
    ["Array non-empty", catalog && items("entry").length > 0],
    ["open elements", root === "Bag" && items("*").length > 0],
    ["mixed closed", root === "Para"],
    [
      "mixed open",
      root === "Doc" && items("$children").some((item) => Predicate.hasProperty(item, "element")),
    ],
    ["suspend", has((key, field) => key === "child" && Array.isArray(field) && field.length > 0)],
    ["second-namespace child", catalog],
  ];

  return found.flatMap(([feature, present]) => (present ? [feature] : []));
};

/**
 * Read the library reason of an encode outcome, or why it has none.
 *
 * @param outcome - One side's P1 or P5 outcome.
 * @returns The reason's `_tag`, `"encoded"` for a success, `"schema only"` for a failure that
 *   carries no library error, or `"defect"`.
 */
const reasonOf = (outcome: EncodeOutcome): string => {
  if ("text" in outcome) {
    return "encoded";
  }

  if ("defect" in outcome) {
    return "defect";
  }

  return outcome.xml === "none" ? "schema only" : outcome.xml.reason._tag;
};

/**
 * The corruptions the root itself rejects, a leaf rejection or an excess key under
 * `onExcessProperty: "error"`: `fromString` hands the value to `encodeString`, where the root's
 * own encode fails with reason `EncodeSchemaFailure`.
 */
const rejectedCorruptions: ReadonlySet<GeneratedEncodeInput["corruption"]> = new Set([
  "check",
  "excess",
  "finite",
  "literal",
]);

/**
 * Tell whether the root rejects a value input.
 *
 * @param input - The value input.
 * @returns `true` for a corruption in {@link rejectedCorruptions}.
 */
const isRejected = (input: GeneratedEncodeInput): boolean =>
  rejectedCorruptions.has(input.corruption);

/**
 * The library error a rejected sample corruption's P5 encode carries, keyed by `root/corruption`:
 * reason `EncodeSchemaFailure` at the rejected leaf's XML path.
 */
const rejectedSamplePaths: ReadonlyMap<string, string> = new Map([
  ["Catalog/check", "/catalog/note"],
  ["Catalog/finite", "/catalog/@count"],
  ["Catalog/literal", "/catalog/@p:level"],
  ["Catalog/excess", "/catalog/stray"],
  ["Para/literal", "/para/3"],
  ["Bag/finite", "/bag/@size"],
]);

/**
 * Read the reason and path of the library error an encode outcome carries.
 *
 * @param outcome - One side's encode outcome.
 * @returns The reason's `_tag` and the error's path, or `"none"`.
 */
const libraryErrorOf = (outcome: EncodeOutcome) =>
  "xml" in outcome && outcome.xml !== "none"
    ? { path: outcome.xml.path, reason: outcome.xml.reason._tag }
    : "none";

/**
 * Assert that a rejected sample corruption's P5 encode carries the library error pinned for it.
 *
 * @param input - The value input.
 * @param outcome - The `src` side's P5 outcome.
 * @returns The row's key in {@link rejectedSamplePaths}, or none for any other input.
 */
const expectPinnedError = (
  input: GeneratedEncodeInput,
  outcome: EncodeOutcome,
): readonly string[] => {
  if (input.origin !== "sample" || !isRejected(input)) {
    return [];
  }

  const key = `${input.root}/${input.corruption}`;

  expect({ error: libraryErrorOf(outcome), id: input.id }).toStrictEqual({
    error: { path: rejectedSamplePaths.get(key), reason: "EncodeSchemaFailure" },
    id: input.id,
  });

  return [key];
};

/**
 * The library reasons P5 must provoke on both sides.
 */
const encodeReasons: readonly EncodeReasonSummary["_tag"][] = [
  "EncodeSchemaFailure",
  "InvalidEvent",
  "UnmappedNamespace",
];

/**
 * Observe P1 of every value input on one side, keyed by input id.
 *
 * @param build - Builds the side's builders for a value input.
 * @returns Each input's encode outcome on that side.
 */
const encodesOf = Effect.fnUntraced(function* encodesOf(
  build: (input: GeneratedEncodeInput) => Built,
) {
  const outcomes = new Map<string, EncodeOutcome>();

  for (const input of encodeInputs) {
    const built = build(input);

    outcomes.set(
      input.id,
      yield* documentEncode(built.side, built.document, input.value, input.parseOptions),
    );
  }

  return outcomes;
});

/**
 * Compare every surface of one value on both sides inside a property check.
 *
 * @param root - The root the value belongs to.
 * @returns A property that holds when both sides agree on every encode surface and, when the
 *   value encodes, on every decode surface of its text.
 */
const agrees = (root: GeneratedRoot) =>
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a value `Arbitrary` drew for the root, compared as plain data.
  Effect.fnUntraced(function* agreesOn(value: unknown) {
    const left = yield* observeEncode(builtOf(src, root.roots.src), value);
    const right = yield* observeEncode(builtOf(standard, root.roots.standard), value);

    if (!isDeepStrictEqual(left, right) || !isDeepStrictEqual(left.encode, left.encodeTokenizer)) {
      return false;
    }

    if (!("text" in left.encode)) {
      return true;
    }

    const input: GeneratedDocumentInput = {
      id: "property",
      path: root.path,
      root: root.id,
      roots: root.roots,
      text: left.encode.text,
    };

    return isDeepStrictEqual(
      yield* observeDocument(builtOf(src, root.roots.src), input),
      yield* observeDocument(builtOf(standard, root.roots.standard), input),
    );
  });

describe("differential: generated values over a feature vocabulary", () => {
  for (const root of generatedRoots) {
    it.effect(`derives ${root.id} on both sides, or fails to with the same message`, () =>
      Effect.gen(function* derives() {
        const left = yield* derivationOf(root.roots.src);
        const right = yield* derivationOf(root.roots.standard);

        expect(left).toStrictEqual(right);
        expect(left).toBe(root.derivation === "derived" ? "derived" : root.derivation.message);
      }),
    );

    it.effect(`compares P1, P1t, P3, and P5 over every value of ${root.id}`, () =>
      Effect.gen(function* compares() {
        const inputs = encodeInputsOf(root.id);

        for (const input of inputs) {
          const left = yield* observeEncode(
            builtOf(src, input.roots.src),
            input.value,
            input.parseOptions,
          );

          const right = yield* observeEncode(
            builtOf(standard, input.roots.standard),
            input.value,
            input.parseOptions,
          );

          expect({ id: input.id, observation: left }).toStrictEqual({
            id: input.id,
            observation: right,
          });
          expect({ id: input.id, tokenizer: left.encodeTokenizer }).toStrictEqual({
            id: input.id,
            tokenizer: left.encode,
          });
        }

        expect(inputs.length).toBeGreaterThan(0);
      }),
    );

    it.effect(`compares P2 and P4 over every encoded text of ${root.id}`, () =>
      Effect.gen(function* compares() {
        const inputs = documentInputsOf(root.id);

        for (const input of inputs) {
          const left = yield* observeDocument(builtOf(src, input.roots.src), input);
          const right = yield* observeDocument(builtOf(standard, input.roots.standard), input);

          expect({ id: input.id, observation: left }).toStrictEqual({
            id: input.id,
            observation: right,
          });
        }

        expect(inputs.length).toBeGreaterThan(0);
      }),
    );

    if (root.derivation === "derived") {
      it.effect(`holds every surface alike over fresh ${root.id} values (seed ${seed})`, () =>
        Effect.gen(function* holds() {
          const result = yield* Arbitrary.checkEffect(
            Arbitrary.schema(Schema.toType(root.roots.src)),
            agrees(root),
            { runs, seed, size },
          );

          expect(Arbitrary.formatCheckFailure(result)).toBeUndefined();
          expect(result._tag === "Passed" ? result.runs : 0).toBe(runs);
        }),
      );
    }
  }

  it.effect(
    "exercises every feature, provokes every encode reason, and runs structural roots",
    () =>
      Effect.gen(function* exercises() {
        const left = yield* encodesOf((input) => builtOf(src, input.roots.src));
        const right = yield* encodesOf((input) => builtOf(standard, input.roots.standard));
        const counts = new Map<Feature, number>(features.map((feature) => [feature, 0]));
        const pinned: string[] = [];
        let rejected = 0;

        const reasons = {
          src: new Map<string, number>(),
          standard: new Map<string, number>(),
        };

        for (const input of encodeInputs) {
          const ours = left.get(input.id);
          const theirs = right.get(input.id);

          expect(ours).toBeDefined();
          expect(theirs).toBeDefined();

          if (ours === undefined || theirs === undefined) {
            continue;
          }

          if (input.corruption === undefined && "text" in ours) {
            for (const feature of featuresOf(input.root, input.value)) {
              counts.set(feature, (counts.get(feature) ?? 0) + 1);
            }
          }

          if (input.corruption !== undefined) {
            for (const [side, outcome] of [
              [reasons.src, ours],
              [reasons.standard, theirs],
            ] as const) {
              side.set(reasonOf(outcome), (side.get(reasonOf(outcome)) ?? 0) + 1);
            }
          }

          if (isRejected(input)) {
            expect({ id: input.id, reason: reasonOf(ours) }).toStrictEqual({
              id: input.id,
              reason: "EncodeSchemaFailure",
            });
            rejected += 1;
          }

          if (input.corruption !== undefined && input.origin === "sample") {
            expect({ id: input.id, reason: reasonOf(ours) }).toStrictEqual({
              id: input.id,
              reason: input.intended ?? "schema only",
            });
          }

          pinned.push(...expectPinnedError(input, ours));
        }

        for (const feature of features) {
          expect({ exercised: (counts.get(feature) ?? 0) > 0, feature }).toStrictEqual({
            exercised: true,
            feature,
          });
        }

        for (const reason of encodeReasons) {
          expect({ provoked: (reasons.src.get(reason) ?? 0) > 0, reason }).toStrictEqual({
            provoked: true,
            reason,
          });
          expect({ provoked: (reasons.standard.get(reason) ?? 0) > 0, reason }).toStrictEqual({
            provoked: true,
            reason,
          });
        }

        const structural = {
          documents: documentInputs.filter(({ roots }) => structuralPlan(roots.src) !== undefined)
            .length,
          values: encodeInputs.filter(({ roots }) => structuralPlan(roots.src) !== undefined)
            .length,
        };

        expect(Arr.sort(Arr.dedupe(pinned), Order.String)).toStrictEqual(
          Arr.sort(rejectedSamplePaths.keys(), Order.String),
        );
        expect(pinned).toHaveLength(10);
        expect(rejected).toBeGreaterThan(0);
        expect(reasons.src).toStrictEqual(reasons.standard);
        expect(structural.values).toBeGreaterThan(0);
        expect(structural.documents).toBeGreaterThan(0);
      }),
  );
});
