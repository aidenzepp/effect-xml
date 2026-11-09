/**
 * Pins every `Schema` derivation of the vocabulary element codecs and their document codecs by
 * digest: each subject is built once on `src`, each derivation's observable output is serialized
 * to canonical JSON, and the SHA-256 of that JSON is asserted under the key
 * `<subject>/<derivation>`, so a failure names exactly which derivation changed.
 *
 * Subjects are QTI `AssessmentItem`, `ChoiceInteraction`, `MathElement` (mixed), and `Div` (a
 * `suspend` recursion), streaming `ItemRef` and `AssessmentTest`, `fromString` of each, and
 * `ElementFromString`. Derivations are every `Schema.to*` the pinned Effect offers plus
 * `Arbitrary.schema`; `toTaggedUnion` does not apply because no subject is a union. Each subject's
 * values come from decoding a corpus fixture or the streaming fixture. A derivation that throws is
 * recorded by its message.
 *
 * The digested JSON holds derivation output text, including issue and thrown messages, so this
 * file asserts message text, as `test/wire-fast-path.test.ts` does (an exception to the
 * repository's test rule, scoped to this file). To inspect a changed derivation, print its full
 * JSON by key with `DERIVATIONS_DUMP='<subject>/<derivation>' bun x vp test
 * test/differential/derivations.test.ts`. After reviewing the change, update the digests with
 * `bun x vp test test/differential/derivations.test.ts -u` and review the inline snapshot diff.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type { StandardSchemaV1 } from "effect/StandardSchema";
import * as Stream from "effect/Stream";

import { XmlSchema } from "../../src/index.ts";
import * as Qti from "../qti/vocabulary.ts";
import * as Streaming from "../streaming/vocabulary.ts";
import { directOutcome, treeOf, valueSummary } from "./harness.ts";
import type { DirectOutcome } from "./harness.ts";

/**
 * The JSON Schema dialect every JSON Schema derivation targets.
 */
const target = "draft-2020-12";

/**
 * The fixed seed, size, and count of every `Arbitrary` sample, so both sides draw the same values.
 */
const sampling = { count: 3, seed: 20_261_106, size: 3 } as const;

/**
 * One codec under derivation with the values the derivations read, all built on one side.
 *
 * `valid` and `other` are two distinct decoded values, `encoded` is `valid` encoded by `schema`,
 * and `invalid` is an encoded input `schema` rejects.
 */
interface Subject {
  readonly id: string;
  readonly schema: Schema.Codec<unknown, unknown>;
  readonly valid: unknown;
  readonly other: unknown;
  readonly encoded: unknown;
  readonly invalid: unknown;
}

/**
 * One vocabulary root with its document codec, both erased to a plain codec so the derivations
 * take either.
 */
interface Root {
  readonly element: Schema.Codec<unknown, unknown>;
  readonly document: Schema.Codec<unknown, unknown>;
  /**
   * Decode the records a text holds at a path with the root's record channel.
   *
   * @param path - The root-anchored record path.
   * @param text - The document text.
   * @returns The records; a decode failure is a defect, because every subject's text is valid.
   */
  readonly records: (path: readonly string[], text: string) => Effect.Effect<readonly unknown[]>;
}

/**
 * Build a root from an element codec.
 *
 * @param element - The element codec, built from `src/index.ts`.
 * @returns The root with its `fromString` codec and record channel.
 */
const rootOf = (
  element: Parameters<typeof XmlSchema.fromString>[0] & Schema.Codec<unknown>,
): Root => ({
  document: XmlSchema.fromString(element),
  element,
  records: (path, text) =>
    Stream.make(text).pipe(
      Stream.pipeThroughChannel(XmlSchema.decodeSchemaString(element, path)()),
      Stream.runCollect,
      Effect.orDie,
    ),
});

/**
 * The vocabulary roots under derivation, keyed by subject id.
 */
const roots = {
  AssessmentItem: rootOf(Qti.AssessmentItem),
  AssessmentTest: rootOf(Streaming.AssessmentTest),
  ChoiceInteraction: rootOf(Qti.ChoiceInteraction),
  Div: rootOf(Qti.Div),
  ItemRef: rootOf(Streaming.ItemRef),
  MathElement: rootOf(Qti.MathElement),
} satisfies Record<string, Root>;

/**
 * The `ElementFromString` subject, with the QTI namespace as the default prefix.
 */
const tree = XmlSchema.ElementFromString({ "": Qti.QTI, xsi: Qti.XSI });

/**
 * Write a Clark name in a namespace.
 *
 * @param namespace - The namespace URI.
 * @param local - The local name.
 * @returns The Clark name.
 */
const clark = (namespace: string, local: string): string =>
  XmlSchema.clark(Option.some(namespace), local);

/**
 * Read one fixture by its path from the repository root.
 *
 * @param path - The fixture path, such as `spikes/fixtures/qti/bg007-true-false.xml`.
 * @returns The fixture's text.
 */
const readFixture = (path: string): string =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf-8");

/**
 * The corpus and streaming fixtures the subjects decode.
 */
const fixtures = {
  missingWord: readFixture("spikes/fixtures/qti/bg010-missing-word.xml"),
  postcard: readFixture("spikes/fixtures/qti/extended-text-postcard.xml"),
  testFeatures: readFixture("spikes/fixtures/qti/test-features.xml"),
  trueFalse: readFixture("spikes/fixtures/qti/bg007-true-false.xml"),
} as const;

/**
 * Build a test document from the streaming fixture's root start tag alone.
 *
 * `AssessmentTest` declares no children and neither `xsi:schemaLocation` nor `xml:lang`, so the
 * whole fixture is not a valid `AssessmentTest`; its start tag, without those two attributes and
 * closed as an empty element, is.
 *
 * @param keepTitle - Whether the root keeps its optional `title`.
 * @returns The test document's text.
 */
const testRootText = (keepTitle: boolean): string => {
  const start = fixtures.testFeatures.indexOf("<qti-assessment-test");
  const tag = fixtures.testFeatures.slice(start, fixtures.testFeatures.indexOf(">", start));

  const undeclared = keepTitle
    ? /\s+(?:xsi:schemaLocation|xml:lang)="[^"]*"/gu
    : /\s+(?:xsi:schemaLocation|xml:lang|title)="[^"]*"/gu;

  return `${tag.replaceAll(undeclared, "")}/>`;
};

/**
 * Where one value of a root decodes from: the text, the record path, and the record's index.
 */
interface Source {
  readonly text: string;
  readonly path: readonly string[];
  readonly index: number;
}

/**
 * The valid and other source of each root.
 *
 * `ChoiceInteraction` and `MathElement` occur once in the corpus, so their other value decodes the
 * same fixture with one attribute or number changed.
 */
const sources = (() => {
  const item = clark(Qti.QTI, "qti-assessment-item");
  const choice = [item, clark(Qti.QTI, "qti-item-body"), clark(Qti.QTI, "qti-choice-interaction")];
  const div = [item, clark(Qti.QTI, "qti-item-body"), clark(Qti.QTI, "div")];
  const math = [...Array.from({ length: 7 }, () => "*"), clark(Qti.MATHML, "math")];

  return {
    AssessmentItem: [
      { index: 0, path: [item], text: fixtures.trueFalse },
      { index: 0, path: [item], text: fixtures.missingWord },
    ],
    AssessmentTest: [
      { index: 0, path: Streaming.testPath, text: testRootText(true) },
      { index: 0, path: Streaming.testPath, text: testRootText(false) },
    ],
    ChoiceInteraction: [
      { index: 0, path: choice, text: fixtures.trueFalse },
      {
        index: 0,
        path: choice,
        text: fixtures.trueFalse.replace('max-choices="1"', 'max-choices="2"'),
      },
    ],
    Div: [
      { index: 0, path: div, text: fixtures.postcard },
      { index: 0, path: div, text: fixtures.missingWord },
    ],
    ItemRef: [
      { index: 0, path: Streaming.itemRefPath, text: fixtures.testFeatures },
      { index: 1, path: Streaming.itemRefPath, text: fixtures.testFeatures },
    ],
    MathElement: [
      { index: 0, path: math, text: fixtures.postcard },
      { index: 0, path: math, text: fixtures.postcard.replace("<mn>8</mn>", "<mn>9</mn>") },
    ],
  } satisfies { readonly [Id in keyof typeof roots]: readonly [valid: Source, other: Source] };
})();

/**
 * The root ids in build order.
 */
const rootIds = [
  "AssessmentItem",
  "ChoiceInteraction",
  "MathElement",
  "Div",
  "ItemRef",
  "AssessmentTest",
] as const;

/**
 * The subject ids in build order: each root, then its `fromString` codec, then
 * `ElementFromString`.
 */
const subjectIds = [
  ...rootIds.flatMap((id) => [id, `fromString(${id})`]),
  "ElementFromString",
] as const;

/**
 * Build every subject with values decoded from the fixtures.
 *
 * Yields the subjects in {@link subjectIds} order.
 */
const buildSubjects = Effect.gen(function* buildSubjects() {
  const subjects: Subject[] = [];

  for (const id of rootIds) {
    const { document, element, records } = roots[id];
    const [validSource, otherSource] = sources[id];
    const valid = (yield* records(validSource.path, validSource.text))[validSource.index];
    const other = (yield* records(otherSource.path, otherSource.text))[otherSource.index];

    subjects.push(
      {
        encoded: yield* Effect.orDie(Schema.encodeUnknownEffect(element)(valid)),
        id,
        invalid: { attributes: {}, children: [], name: "{urn:invalid}zz" },
        other,
        schema: element,
        valid,
      },
      {
        encoded: yield* Effect.orDie(Schema.encodeUnknownEffect(document)(valid)),
        id: `fromString(${id})`,
        invalid: "<unclosed>",
        other,
        schema: document,
        valid,
      },
    );
  }

  const valid = yield* Effect.orDie(Schema.decodeUnknownEffect(tree)(fixtures.trueFalse));

  subjects.push({
    encoded: yield* Effect.orDie(Schema.encodeUnknownEffect(tree)(valid)),
    id: "ElementFromString",
    invalid: "<unclosed>",
    other: yield* Effect.orDie(Schema.decodeUnknownEffect(tree)(fixtures.missingWord)),
    schema: tree,
    valid,
  });

  return subjects;
});

/**
 * Write a thrown value as a comparable message.
 *
 * @param error - The thrown value.
 * @returns The error's name and message, or its text when it is not an `Error`.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a derivation may throw any value; its text is what both sides compare.
const messageOf = (error: unknown): string =>
  Predicate.isError(error) ? `${error.name}: ${error.message}` : String(error);

/**
 * Replace each value JSON drops or rejects with a tag naming it, so a derivation output holding
 * one still compares instead of losing it.
 *
 * @param _key - The property key JSON is writing.
 * @param value - The property's value.
 * @returns The value, or its tag when JSON would drop or reject it.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- a JSON.stringify replacer receives and returns any value a derivation outputs.
const tagUnwritable = (_key: string, value: unknown) => {
  if (Predicate.isFunction(value)) {
    return `[function ${value.name}]`;
  }

  if (Predicate.isSymbol(value)) {
    return `[symbol ${value.description ?? ""}]`;
  }

  if (Predicate.isBigInt(value)) {
    return `[bigint ${value.toString()}]`;
  }

  return value === undefined ? "[undefined]" : value;
};

// Native: Schema.Json and Schema.fromJsonString reject functions, undefined, and symbols, which derivation outputs such as representations hold in annotations.
/**
 * Summarize a derivation's output as JSON data with its own-key order.
 *
 * Functions, `undefined`, symbols, and bigints become tags, because the two sides' functions are
 * distinct objects that `toStrictEqual` would never accept as equal; symbol keys drop out. An
 * output JSON cannot write, such as a cycle, becomes its error message.
 *
 * @param value - The derivation's output.
 * @returns The output as plain data with its key order, or the message JSON failed with.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a derivation's output of either side, compared as opaque data.
const jsonOf = (value: unknown) =>
  Effect.runSync(
    Effect.try({
      catch: messageOf,
      try: () =>
        Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(
          JSON.stringify(value, tagUnwritable),
        ),
    }).pipe(Effect.match({ onFailure: (unwritable) => ({ unwritable }), onSuccess: valueSummary })),
  );

/**
 * Evaluate a derivation and observe its result, comparing a throw by its message.
 *
 * @param evaluate - Runs the derivation; it may throw.
 * @param observe - Turns the derivation's result into comparable data.
 * @returns The observation, or the thrown message.
 */
const derive = <A, O>(
  evaluate: () => A,
  observe: (derived: A) => Effect.Effect<O>,
): Effect.Effect<O | { readonly thrown: string }> =>
  Effect.try({ catch: messageOf, try: evaluate }).pipe(
    Effect.matchEffect({ onFailure: (thrown) => Effect.succeed({ thrown }), onSuccess: observe }),
  );

/**
 * Observe a codec a derivation returns: its representation, its decode and encode of the valid
 * value, and its decode of what that encode produced.
 *
 * @param codec - The derived codec.
 * @param valid - The subject's valid value.
 * @returns The observations as harness summaries.
 */
const codecObservation = (
  codec: Schema.Codec<unknown, unknown>,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a decoded value of the subject's side.
  valid: unknown,
) =>
  Effect.gen(function* observe() {
    const decode = directOutcome(yield* Effect.exit(Schema.decodeUnknownEffect(codec)(valid)));
    const encodeExit = yield* Effect.exit(Schema.encodeUnknownEffect(codec)(valid));

    const roundTrip: DirectOutcome | "none" = Exit.isSuccess(encodeExit)
      ? directOutcome(yield* Effect.exit(Schema.decodeUnknownEffect(codec)(encodeExit.value)))
      : "none";

    return {
      decode,
      encode: directOutcome(encodeExit),
      representation: jsonOf(Schema.toRepresentation(codec)),
      roundTrip,
    };
  });

/**
 * Observe a Standard Schema validation result: the value with its key order, or each issue's
 * message and path.
 *
 * @param result - The result `validate` returned.
 * @returns The result as plain data.
 */
const standardResultOf = (result: StandardSchemaV1.Result<unknown>) =>
  result.issues === undefined
    ? { value: valueSummary(result.value) }
    : {
        issues: result.issues.map(({ message, path }) => ({
          message,
          path: (path ?? []).map((segment) =>
            Predicate.isPropertyKey(segment) ? segment : segment.key,
          ),
        })),
      };

/**
 * Validate an input with a Standard Schema validator, synchronous or not.
 *
 * @param validate - The validator `toStandardSchemaV1` derived.
 * @param input - The input to validate.
 * @returns The validation result as plain data.
 */
const validationOf = (
  validate: StandardSchemaV1["~standard"]["validate"],
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- an encoded input, valid or deliberately not.
  input: unknown,
) => Effect.promise(() => Promise.resolve(validate(input))).pipe(Effect.map(standardResultOf));

/**
 * Observe an optic by reading the input and writing back what it read.
 *
 * @param optic - The derived optic.
 * @param optic.get - Reads the focus from a source.
 * @param optic.set - Builds a source from a focus.
 * @param input - The source the optic reads.
 * @returns What `get` read and what `set` built from it, or the thrown message.
 */
const opticObservation = <S, A>(
  optic: { readonly get: (source: S) => A; readonly set: (focus: A) => S },
  input: S,
) =>
  derive(() => {
    const read = optic.get(input);

    return { get: jsonOf(read), set: jsonOf(optic.set(read)) };
  }, Effect.succeed);

/**
 * Every derivation under comparison with its observation of one subject, in receipt-R5 order
 * followed by `Arbitrary.schema`.
 *
 * Each observation yields plain data or harness summaries with own-key order, so `toStrictEqual`
 * compares the two sides without class identity.
 */
const derivations: readonly (readonly [
  name: string,
  observe: (subject: Subject) => Effect.Effect<unknown>,
])[] = [
  [
    "toStandardSchemaV1",
    ({ encoded, invalid, schema }) =>
      derive(
        () => Schema.toStandardSchemaV1(schema)["~standard"].validate,
        (validate) =>
          Effect.all({
            invalid: validationOf(validate, invalid),
            valid: validationOf(validate, encoded),
          }),
      ),
  ],
  [
    "toStandardJSONSchemaV1",
    ({ schema }) =>
      derive(() => {
        const { jsonSchema } = Schema.toStandardJSONSchemaV1(schema)["~standard"];

        return {
          input: jsonOf(jsonSchema.input({ target })),
          output: jsonOf(jsonSchema.output({ target })),
        };
      }, Effect.succeed),
  ],
  [
    "toType",
    ({ schema, valid }) =>
      derive(
        () => Schema.toType(schema),
        (codec) => codecObservation(codec, valid),
      ),
  ],
  [
    "toEncoded",
    ({ schema, valid }) =>
      derive(
        () => Schema.toEncoded(schema),
        (codec) => codecObservation(codec, valid),
      ),
  ],
  ["toTaggedUnion", () => Effect.succeed("not applicable: no subject is a union")],
  [
    "toFormatter",
    ({ schema, valid }) => derive(() => Schema.toFormatter(schema)(valid), Effect.succeed),
  ],
  [
    "toEquivalence",
    ({ other, schema, valid }) =>
      derive(() => {
        const equivalent = Schema.toEquivalence(schema);

        return {
          different: equivalent(valid, other),
          same: equivalent(valid, structuredClone(valid)),
        };
      }, Effect.succeed),
  ],
  [
    "toRepresentation",
    ({ schema }) => derive(() => jsonOf(Schema.toRepresentation(schema)), Effect.succeed),
  ],
  [
    "toJsonSchemaDocument",
    ({ schema }) => derive(() => jsonOf(Schema.toJsonSchemaDocument(schema)), Effect.succeed),
  ],
  [
    "toCodecJson",
    ({ schema, valid }) =>
      derive(
        () => Schema.toCodecJson(schema),
        (codec) => codecObservation(codec, valid),
      ),
  ],
  [
    "toCodecIso",
    ({ schema, valid }) =>
      derive(
        () => Schema.toCodecIso(schema),
        (codec) => codecObservation(codec, valid),
      ),
  ],
  [
    "toCodecStringTree",
    ({ schema, valid }) =>
      derive(
        () => Schema.toCodecStringTree(schema),
        (codec) => codecObservation(codec, valid),
      ),
  ],
  [
    "toCodecArrayFromSingle",
    ({ schema, valid }) =>
      derive(
        () => Schema.toCodecArrayFromSingle(schema),
        (codec) => codecObservation(codec, valid),
      ),
  ],
  [
    "toCodecGoJson",
    ({ schema, valid }) =>
      derive(
        () => Schema.toCodecGoJson(schema),
        (codec) => codecObservation(codec, valid),
      ),
  ],
  [
    "toEncoderXml",
    ({ schema, valid }) =>
      derive(
        () => Schema.toEncoderXml(schema),
        (encode) =>
          encode(valid).pipe(
            Effect.match({
              onFailure: (issue) => ({ tree: treeOf(issue) }),
              onSuccess: (text) => ({ text }),
            }),
          ),
      ),
  ],
  [
    "toIso",
    ({ schema, valid }) =>
      derive(
        () => Schema.toIso(schema),
        (iso) => opticObservation(iso, valid),
      ),
  ],
  [
    "toIsoSource",
    ({ schema, valid }) =>
      derive(
        () => Schema.toIsoSource(schema),
        (iso) => opticObservation(iso, valid),
      ),
  ],
  [
    "toIsoFocus",
    ({ schema, valid }) =>
      derive(
        () => ({ focus: Schema.toIso(schema).get(valid), iso: Schema.toIsoFocus(schema) }),
        ({ focus, iso }) => opticObservation(iso, focus),
      ),
  ],
  [
    "toDifferJsonPatch",
    ({ other, schema, valid }) =>
      derive(() => {
        const differ = Schema.toDifferJsonPatch(schema);
        const patch = differ.diff(valid, other);

        return { patch: jsonOf(patch), patched: jsonOf(differ.patch(valid, patch)) };
      }, Effect.succeed),
  ],
  [
    "Arbitrary.schema",
    ({ schema }) =>
      derive(
        () => Arbitrary.schema(schema),
        (arbitrary) =>
          Arbitrary.sampleEffect(arbitrary, sampling).pipe(
            Effect.match({
              onFailure: (failure) => ({ sampleError: failure._tag }),
              onSuccess: (samples) => ({ samples: jsonOf(samples) }),
            }),
          ),
      ),
  ],
];

/**
 * Observe every derivation of one subject.
 *
 * @param subject - The subject.
 * @returns Each derivation's observation keyed by its name, in {@link derivations} order.
 */
const observationsOf = Effect.fnUntraced(function* observationsOf(subject: Subject) {
  const observations: (readonly [name: string, observation: unknown])[] = [];

  for (const [name, observe] of derivations) {
    observations.push([name, yield* observe(subject)]);
  }

  return Object.fromEntries(observations);
});

/**
 * Write one observation as the canonical JSON its digest covers.
 *
 * @param observation - A derivation's observation of one subject.
 * @returns The observation's JSON text, with unwritable values tagged.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- an observation is opaque data of any derivation.
const canonicalOf = (observation: unknown): string => JSON.stringify(observation, tagUnwritable);

/**
 * Digest canonical JSON text.
 *
 * @param text - The canonical JSON of one observation.
 * @returns The text's SHA-256 as lowercase hex.
 */
const digestOf = (text: string): string => createHash("sha256").update(text).digest("hex");

/**
 * The `<subject>/<derivation>` key whose full JSON the run prints, when set.
 */
const dumpKey = process.env.DERIVATIONS_DUMP;

describe("Schema derivations of element and document codecs", () => {
  it.effect("builds every subject, each with distinct valid values", () =>
    Effect.gen(function* builds() {
      const subjects = yield* buildSubjects;

      expect(subjects.map(({ id }) => id)).toStrictEqual(subjectIds);

      for (const subject of subjects) {
        expect(valueSummary(subject.valid)).not.toStrictEqual(valueSummary(subject.other));
      }
    }),
  );

  it.effect("derives every subject to the pinned digests", () =>
    Effect.gen(function* derives() {
      const digests: Record<string, string> = {};

      for (const subject of yield* buildSubjects) {
        const observations = yield* observationsOf(subject);

        expect(Object.keys(observations)).toHaveLength(derivations.length);

        for (const [name, observation] of Object.entries(observations)) {
          const key = `${subject.id}/${name}`;
          const text = canonicalOf(observation);

          if (key === dumpKey) {
            yield* Effect.sync(() =>
              process.stdout.write(`${JSON.stringify(JSON.parse(text), undefined, 2)}\n`),
            );
          }

          digests[key] = digestOf(text);
        }
      }

      expect(Object.keys(digests)).toHaveLength(subjectIds.length * derivations.length);
      expect(digests).toMatchInlineSnapshot(`
        {
          "AssessmentItem/Arbitrary.schema": "932c232ed54bf44ba84f8750820b8386f3fe8c83c44cc9ec34a5c61be9e9c105",
          "AssessmentItem/toCodecArrayFromSingle": "97f6d588b4e8427500be7f0e8afb60b95009f5379f92acd3d8df65b7f0f383e4",
          "AssessmentItem/toCodecGoJson": "3087312d2e3bba32352c12c380e8ca5489c677854b02489c1bf43b80fe72575b",
          "AssessmentItem/toCodecIso": "1c332ab6b5eae9439df749d3fdb2090f85729d89fbeb518aebd6fba53ae32eeb",
          "AssessmentItem/toCodecJson": "d8e85f62ccc827b4c52ddd9d48d7a15fb980f8fa69ebfa8c6c18ae44a9f548ba",
          "AssessmentItem/toCodecStringTree": "3c8cb04b83d940bca042f77b74028da1528221f0febe96750bee0be721aab814",
          "AssessmentItem/toDifferJsonPatch": "b1f43f93d27f1effa1753e590eab3a9e25759e74fb864e4351f8753c3b196e2e",
          "AssessmentItem/toEncoded": "1a59d8f48abd666fe3495c76fec5b6c5098ed699fe1f8c11d92722f9ea5d0977",
          "AssessmentItem/toEncoderXml": "3c8cb04b83d940bca042f77b74028da1528221f0febe96750bee0be721aab814",
          "AssessmentItem/toEquivalence": "ed8005a9093b7f8327eed5a401f5c92b366ee2491016648ed3c597061f23a5f3",
          "AssessmentItem/toFormatter": "13df6f74470be88dd41a406f9a731eab878c7c22930ea4b3dc50eba094cfd5f6",
          "AssessmentItem/toIso": "9f9b83c955d1fe934378d909fc1ec708e9d0ad30229d6b6fa91fa57b0dc1602e",
          "AssessmentItem/toIsoFocus": "9f9b83c955d1fe934378d909fc1ec708e9d0ad30229d6b6fa91fa57b0dc1602e",
          "AssessmentItem/toIsoSource": "9f9b83c955d1fe934378d909fc1ec708e9d0ad30229d6b6fa91fa57b0dc1602e",
          "AssessmentItem/toJsonSchemaDocument": "97d527fdebf5bc518dc96fb108396034c153a57fef7edde944e5d6a578f6af6d",
          "AssessmentItem/toRepresentation": "b2b8a9d20d2e37de7524c11e73309bee29282ee877fc8ca6c36437ffba5bb367",
          "AssessmentItem/toStandardJSONSchemaV1": "623b940c5abac4c44f6bfd437bc0082c962e8a4e9f07b0cfa810f9d2e3e79914",
          "AssessmentItem/toStandardSchemaV1": "8dc3e22a7025fb20b164b0fbfc9dd8274e4fde68c51abf9780c9d6fc2b235bbd",
          "AssessmentItem/toTaggedUnion": "d0634b45c3f0616c6f48240deea658cddb94c536557506266e36260fa209ff56",
          "AssessmentItem/toType": "1c332ab6b5eae9439df749d3fdb2090f85729d89fbeb518aebd6fba53ae32eeb",
          "AssessmentTest/Arbitrary.schema": "a7f2fa5a67ae5690936a866afc39bcd168db80b8eb1a0c6ff2e77714e3c8220a",
          "AssessmentTest/toCodecArrayFromSingle": "d65c5d05502eb79bc7df6a67412aaa07b3b69992dca9cd4f905a752fa86a1846",
          "AssessmentTest/toCodecGoJson": "30ce4b289848498553ea2bacb09223a7519ac3b3b5b56f4787835138437db5fa",
          "AssessmentTest/toCodecIso": "804befdf0f933c0db1885533d473b4cc1d38b742b91764acbb7a375c9722b4f4",
          "AssessmentTest/toCodecJson": "87c42b2f050f78f6dc2b83702caa10501ad94716e3237b6abe91c1426db0fc17",
          "AssessmentTest/toCodecStringTree": "3c8cb04b83d940bca042f77b74028da1528221f0febe96750bee0be721aab814",
          "AssessmentTest/toDifferJsonPatch": "a8b5b45efa1033d399963ab8195ad30d9bae9750e6248f579949472d27c5ff43",
          "AssessmentTest/toEncoded": "2e713982c67794ed120862cbc295b92f67af8c77b661b064b342cee72a776e44",
          "AssessmentTest/toEncoderXml": "3c8cb04b83d940bca042f77b74028da1528221f0febe96750bee0be721aab814",
          "AssessmentTest/toEquivalence": "ed8005a9093b7f8327eed5a401f5c92b366ee2491016648ed3c597061f23a5f3",
          "AssessmentTest/toFormatter": "2a251e383f5a1f0ea48122fa4f3ae91708c28dc8bb9d3354a5c619123e63fb5f",
          "AssessmentTest/toIso": "cb9a0e29f3eb1edc2493c1324665053891faf8dade095776997424779a7b8ec2",
          "AssessmentTest/toIsoFocus": "cb9a0e29f3eb1edc2493c1324665053891faf8dade095776997424779a7b8ec2",
          "AssessmentTest/toIsoSource": "cb9a0e29f3eb1edc2493c1324665053891faf8dade095776997424779a7b8ec2",
          "AssessmentTest/toJsonSchemaDocument": "086cce291372d80f363c6050799a4246f7eea18d094edd418d16d0a2046fc9d2",
          "AssessmentTest/toRepresentation": "40255308982b66f219608e53ba550a7ffc4eae3c82e1367caffc7c4ec8ea8f07",
          "AssessmentTest/toStandardJSONSchemaV1": "5155651dc5c08637cd46cbe65cf07cd9718af22957e374c1e9a5c33954ef49c0",
          "AssessmentTest/toStandardSchemaV1": "dfe44612e637c074dc27fffd46a1fa224480c82fd8fd3b27d3b2ad9ede580ad8",
          "AssessmentTest/toTaggedUnion": "d0634b45c3f0616c6f48240deea658cddb94c536557506266e36260fa209ff56",
          "AssessmentTest/toType": "804befdf0f933c0db1885533d473b4cc1d38b742b91764acbb7a375c9722b4f4",
          "ChoiceInteraction/Arbitrary.schema": "336cff6874bd36c08ac641fd08a7dfd218413244667c5e57fbe0498918a1e994",
          "ChoiceInteraction/toCodecArrayFromSingle": "0d360708aa8cb5309056a0b9b1d6965bbe758dc9cc8db8e9d666f6c37bbd414a",
          "ChoiceInteraction/toCodecGoJson": "0f14f9ff27267c22e3fa584115417fffe1c91fcea333834779dd8ba5c44d7c8c",
          "ChoiceInteraction/toCodecIso": "a38b1f5116011f79b424af488394e783199535cb443359e9d15c7bdc1b2375ce",
          "ChoiceInteraction/toCodecJson": "639626ed032a035cd971ed144079daabfce7f150fa2f8db5e267554045e12ee8",
          "ChoiceInteraction/toCodecStringTree": "3c8cb04b83d940bca042f77b74028da1528221f0febe96750bee0be721aab814",
          "ChoiceInteraction/toDifferJsonPatch": "d7bf90d24c446a1cf03120b1093654a0005b866b37b9c4fbb0cb6c84d7119099",
          "ChoiceInteraction/toEncoded": "cdf68e065ef1a5006296996720187b2530125a289bf51ba104e309f878dbaada",
          "ChoiceInteraction/toEncoderXml": "3c8cb04b83d940bca042f77b74028da1528221f0febe96750bee0be721aab814",
          "ChoiceInteraction/toEquivalence": "ed8005a9093b7f8327eed5a401f5c92b366ee2491016648ed3c597061f23a5f3",
          "ChoiceInteraction/toFormatter": "5bc35fb31aff853feb0949767653ceeb2b6ed59d5a7c6e129a0ca6fbcb58b89b",
          "ChoiceInteraction/toIso": "dcb304ffa9236cc5f0fb766345b3e439210563e469028820340f190dcb8ae5a8",
          "ChoiceInteraction/toIsoFocus": "dcb304ffa9236cc5f0fb766345b3e439210563e469028820340f190dcb8ae5a8",
          "ChoiceInteraction/toIsoSource": "dcb304ffa9236cc5f0fb766345b3e439210563e469028820340f190dcb8ae5a8",
          "ChoiceInteraction/toJsonSchemaDocument": "8b4e8a0bece34a1b965040b01a4bf4906645551d67cb4cc12ddbf47c28e3d0f9",
          "ChoiceInteraction/toRepresentation": "e9c1e28c91fb5872e4626b140f26d4ad5186b1f742eeae78d8858cdd3d6dfbd0",
          "ChoiceInteraction/toStandardJSONSchemaV1": "754ec2090851983c67abee8246f810647937890eb2b2f4e63414367f44ca0cab",
          "ChoiceInteraction/toStandardSchemaV1": "c516c5689571973e7e4cb6fd372be2e199a036d6047ef42357657aa23200a0e1",
          "ChoiceInteraction/toTaggedUnion": "d0634b45c3f0616c6f48240deea658cddb94c536557506266e36260fa209ff56",
          "ChoiceInteraction/toType": "a38b1f5116011f79b424af488394e783199535cb443359e9d15c7bdc1b2375ce",
          "Div/Arbitrary.schema": "d00406221099f6f66b3ef3ec76aea128ee04086305ff25b7c56d567eb91478de",
          "Div/toCodecArrayFromSingle": "9e0d4f3bda212d7cb034ccd79c890675fab02d88907fce02ffce8854eeec2e8d",
          "Div/toCodecGoJson": "5efe148e7b04f4befc5d8a7b4e555198eb50e240cdea7644c5be10f11a85242f",
          "Div/toCodecIso": "bf320a123ac1768bcab34ddcedfa90ed79b714bda001ed587a1d7df944b5a809",
          "Div/toCodecJson": "1b33936c18509e013d73ead2eb65a6d62dbda58d439dadc037aa91b013d9cc16",
          "Div/toCodecStringTree": "3c8cb04b83d940bca042f77b74028da1528221f0febe96750bee0be721aab814",
          "Div/toDifferJsonPatch": "683e6cad1769ec331d28460bf30f435edb4583a42f404047715bbcf69daeaa17",
          "Div/toEncoded": "46ba3475834edbf62b32195463dbd4c004238a2932933f03eac7cb0a481cadb7",
          "Div/toEncoderXml": "3c8cb04b83d940bca042f77b74028da1528221f0febe96750bee0be721aab814",
          "Div/toEquivalence": "ed8005a9093b7f8327eed5a401f5c92b366ee2491016648ed3c597061f23a5f3",
          "Div/toFormatter": "db92112f8336637daa260994661e72c5049dc40e660bbd6fca4fc995dc64f120",
          "Div/toIso": "64a50bb04e05c44ac53bf5ee9eadfaf7456cd9e0283948c95f846c37a5bc2b5e",
          "Div/toIsoFocus": "64a50bb04e05c44ac53bf5ee9eadfaf7456cd9e0283948c95f846c37a5bc2b5e",
          "Div/toIsoSource": "64a50bb04e05c44ac53bf5ee9eadfaf7456cd9e0283948c95f846c37a5bc2b5e",
          "Div/toJsonSchemaDocument": "aee972312a817df29a38bc67f8e3fbb2b9288816fc17818716572cbc6bf5dd7b",
          "Div/toRepresentation": "3c9e0879840555c05e3b57e92a37ce59bfdc34ac7373c285b365376ea57ad3dd",
          "Div/toStandardJSONSchemaV1": "4b29b93ab197c7f0188cf5f6e3f52df74c0e1c969062006b50624854f8c1fcdb",
          "Div/toStandardSchemaV1": "7d979cc21debac64ad7eb267e117a422368c87db71e902a973f5ab4b488a97e1",
          "Div/toTaggedUnion": "d0634b45c3f0616c6f48240deea658cddb94c536557506266e36260fa209ff56",
          "Div/toType": "bf320a123ac1768bcab34ddcedfa90ed79b714bda001ed587a1d7df944b5a809",
          "ElementFromString/Arbitrary.schema": "91afb6b7df892475200e1727c90f80211327297eb98b615164a3e55fff321da3",
          "ElementFromString/toCodecArrayFromSingle": "b17b4c48fce5f115cd446a34599aee7edfc2def4e7189a4e39036e13f389d9a3",
          "ElementFromString/toCodecGoJson": "b17b4c48fce5f115cd446a34599aee7edfc2def4e7189a4e39036e13f389d9a3",
          "ElementFromString/toCodecIso": "47e3bfc397d4f64645b3a3db40c1dfbf9ed0f3faa298e21dd169374b44b118b3",
          "ElementFromString/toCodecJson": "b17b4c48fce5f115cd446a34599aee7edfc2def4e7189a4e39036e13f389d9a3",
          "ElementFromString/toCodecStringTree": "b17b4c48fce5f115cd446a34599aee7edfc2def4e7189a4e39036e13f389d9a3",
          "ElementFromString/toDifferJsonPatch": "dc00fe0dd844ca47689611ba46809b8b9d99536d8c5999579a5cd354efd86587",
          "ElementFromString/toEncoded": "cdfef2e55ebeb1e469a12c1f224f96ffce6a164d4dcc11574d53d7f29a9e2718",
          "ElementFromString/toEncoderXml": "b9e88117db08b771a3152412686421bb726cf1cc3f742f2efa804c96581b6734",
          "ElementFromString/toEquivalence": "ed8005a9093b7f8327eed5a401f5c92b366ee2491016648ed3c597061f23a5f3",
          "ElementFromString/toFormatter": "027f3fcdb8fd29384f534de2a3a7630dc22ed1fa77e7cf076b2543b670ff96dc",
          "ElementFromString/toIso": "ecad2d9e8cfc66775a5a8dc4b1b0a32cbc88d7a7f7dd06299e9b1c5d53517d32",
          "ElementFromString/toIsoFocus": "ecad2d9e8cfc66775a5a8dc4b1b0a32cbc88d7a7f7dd06299e9b1c5d53517d32",
          "ElementFromString/toIsoSource": "ecad2d9e8cfc66775a5a8dc4b1b0a32cbc88d7a7f7dd06299e9b1c5d53517d32",
          "ElementFromString/toJsonSchemaDocument": "f61f3fd64ce937b6ec3572ce336e112358a2fe59f95873bccf1b26b2217971c6",
          "ElementFromString/toRepresentation": "107777b3dfdbd934817c2e5654738c362016a30c8b023d06de43b5c77a35e438",
          "ElementFromString/toStandardJSONSchemaV1": "3da708ddbf6053636f9ac160864234101809b3af95afc6b46b6d946c2e8fadad",
          "ElementFromString/toStandardSchemaV1": "d6460e647e62feccd8729fad4e153c4c2ad30758fcd7b69685a8bc861fa4f295",
          "ElementFromString/toTaggedUnion": "d0634b45c3f0616c6f48240deea658cddb94c536557506266e36260fa209ff56",
          "ElementFromString/toType": "47e3bfc397d4f64645b3a3db40c1dfbf9ed0f3faa298e21dd169374b44b118b3",
          "ItemRef/Arbitrary.schema": "f9c8b0609f5f9123611932cdb3896417b3baf9795482c256dfa81e0aed88b793",
          "ItemRef/toCodecArrayFromSingle": "edc92493e69dfe477d00442f096068fbfb9d6452cb7d02e2a69821c798575ab5",
          "ItemRef/toCodecGoJson": "148c6ec5890e27c77e84d704864cfa757e14fa87b10541156ed95384546fe7d6",
          "ItemRef/toCodecIso": "5a5eb6af7c8be80e93249fccfffe72ce99b7886b20f5cab4f45f7f4c217f6465",
          "ItemRef/toCodecJson": "84533e6c31d1481afc5734324c9fe693c59faaf236ba2fb91696a10b0f00a5ea",
          "ItemRef/toCodecStringTree": "3c8cb04b83d940bca042f77b74028da1528221f0febe96750bee0be721aab814",
          "ItemRef/toDifferJsonPatch": "e080896c610a4cd7260569f3dfa31545d27872976f40e09fd5253c4dc818ecf9",
          "ItemRef/toEncoded": "2376b5c428993d5174ea1b87eb35c912ffb4d798cb2e9876e2c90c08dc7b1d73",
          "ItemRef/toEncoderXml": "3c8cb04b83d940bca042f77b74028da1528221f0febe96750bee0be721aab814",
          "ItemRef/toEquivalence": "ed8005a9093b7f8327eed5a401f5c92b366ee2491016648ed3c597061f23a5f3",
          "ItemRef/toFormatter": "a8a2369646556f68a595638b0cc13d424be31c3fdaee46a341abaf8010f9c68e",
          "ItemRef/toIso": "0ea27d56dd99995336da4f4b7c381fcbf6b986f248a1ee6f64445bf5b5ed28e0",
          "ItemRef/toIsoFocus": "0ea27d56dd99995336da4f4b7c381fcbf6b986f248a1ee6f64445bf5b5ed28e0",
          "ItemRef/toIsoSource": "0ea27d56dd99995336da4f4b7c381fcbf6b986f248a1ee6f64445bf5b5ed28e0",
          "ItemRef/toJsonSchemaDocument": "9b914f66b3c589d6178d3eef7b261f2deed2728988c089fc209d59cb5f24cb3f",
          "ItemRef/toRepresentation": "dac614760579238447577de4b4ae289a5a3afc33623586d1882fbbf115a043c8",
          "ItemRef/toStandardJSONSchemaV1": "66eca96779b2d4ea7f1864bb252fb0185f1f3378de0e9dbef717a7b992d4e85c",
          "ItemRef/toStandardSchemaV1": "4d5f64cf1f698518eccf0cfce35d86cd208faccd4f602943e73e89b0ba4982af",
          "ItemRef/toTaggedUnion": "d0634b45c3f0616c6f48240deea658cddb94c536557506266e36260fa209ff56",
          "ItemRef/toType": "5a5eb6af7c8be80e93249fccfffe72ce99b7886b20f5cab4f45f7f4c217f6465",
          "MathElement/Arbitrary.schema": "c169f0867cb5cf61464866b1e1fd63cf028a42909d9ee5dda884189278138199",
          "MathElement/toCodecArrayFromSingle": "ed793e8a85cb1bbba86be2c948b5ab917d4bc8257c91e4a4df106b23a187b82f",
          "MathElement/toCodecGoJson": "ceca297a4f8bd11df52d9f7e81d848a267b12d04079282192eeebd842c416fdd",
          "MathElement/toCodecIso": "a5a2353e5aaa03c34e0e274128a5e4e8d1f9b0eba1f96a0595cf969f407789fd",
          "MathElement/toCodecJson": "ed0a3923dd9e45235db510fe6e57d599f7a569efb19e731c3865fadc238cf844",
          "MathElement/toCodecStringTree": "3c8cb04b83d940bca042f77b74028da1528221f0febe96750bee0be721aab814",
          "MathElement/toDifferJsonPatch": "974028eed40d361383d0980f49aa36a928bcfa1a8d1038d8390e33dc370237d9",
          "MathElement/toEncoded": "a128cf5e3b073616f6872f97d0ca1553c39e1c1592e0a6c484c64e60026a78b7",
          "MathElement/toEncoderXml": "3c8cb04b83d940bca042f77b74028da1528221f0febe96750bee0be721aab814",
          "MathElement/toEquivalence": "ed8005a9093b7f8327eed5a401f5c92b366ee2491016648ed3c597061f23a5f3",
          "MathElement/toFormatter": "0a945b437da881d21f7776cb7f23d4d264636aa840ccfea3134b5f4ece68b9f6",
          "MathElement/toIso": "f9c428789d77adaad7fdcd7c7c3147993c5169b37421565faf507fd922befd71",
          "MathElement/toIsoFocus": "f9c428789d77adaad7fdcd7c7c3147993c5169b37421565faf507fd922befd71",
          "MathElement/toIsoSource": "f9c428789d77adaad7fdcd7c7c3147993c5169b37421565faf507fd922befd71",
          "MathElement/toJsonSchemaDocument": "bf36ee1244a8a8556bcf519a2061837558030e65d6ee837c058f17f10d94e9aa",
          "MathElement/toRepresentation": "bdeb04bb52a961a330e21dc77108bc1aaf5d4035002a310c3a9dabce8d9a1bfe",
          "MathElement/toStandardJSONSchemaV1": "555d4b7396300bef1fcd08f54130d43d2616dfdd437a14fbb627f1cf706b58b3",
          "MathElement/toStandardSchemaV1": "241936270d1d99498b7a4bba83cc790a2fce8c7c969d1dc88905e2330199f8e3",
          "MathElement/toTaggedUnion": "d0634b45c3f0616c6f48240deea658cddb94c536557506266e36260fa209ff56",
          "MathElement/toType": "a5a2353e5aaa03c34e0e274128a5e4e8d1f9b0eba1f96a0595cf969f407789fd",
          "fromString(AssessmentItem)/Arbitrary.schema": "932c232ed54bf44ba84f8750820b8386f3fe8c83c44cc9ec34a5c61be9e9c105",
          "fromString(AssessmentItem)/toCodecArrayFromSingle": "aef8210362fcbb63957555333119ab49359a7875bb72855980225803929b963f",
          "fromString(AssessmentItem)/toCodecGoJson": "aef8210362fcbb63957555333119ab49359a7875bb72855980225803929b963f",
          "fromString(AssessmentItem)/toCodecIso": "1c332ab6b5eae9439df749d3fdb2090f85729d89fbeb518aebd6fba53ae32eeb",
          "fromString(AssessmentItem)/toCodecJson": "aef8210362fcbb63957555333119ab49359a7875bb72855980225803929b963f",
          "fromString(AssessmentItem)/toCodecStringTree": "aef8210362fcbb63957555333119ab49359a7875bb72855980225803929b963f",
          "fromString(AssessmentItem)/toDifferJsonPatch": "deea67d7904bd026858314bcc2b049b30323703561264867acffba8ece248d92",
          "fromString(AssessmentItem)/toEncoded": "cdfef2e55ebeb1e469a12c1f224f96ffce6a164d4dcc11574d53d7f29a9e2718",
          "fromString(AssessmentItem)/toEncoderXml": "6ddf35c92626385b9fcbe49c295b702965b3581d24ae289637908496b82f4267",
          "fromString(AssessmentItem)/toEquivalence": "ed8005a9093b7f8327eed5a401f5c92b366ee2491016648ed3c597061f23a5f3",
          "fromString(AssessmentItem)/toFormatter": "13df6f74470be88dd41a406f9a731eab878c7c22930ea4b3dc50eba094cfd5f6",
          "fromString(AssessmentItem)/toIso": "9f9b83c955d1fe934378d909fc1ec708e9d0ad30229d6b6fa91fa57b0dc1602e",
          "fromString(AssessmentItem)/toIsoFocus": "9f9b83c955d1fe934378d909fc1ec708e9d0ad30229d6b6fa91fa57b0dc1602e",
          "fromString(AssessmentItem)/toIsoSource": "9f9b83c955d1fe934378d909fc1ec708e9d0ad30229d6b6fa91fa57b0dc1602e",
          "fromString(AssessmentItem)/toJsonSchemaDocument": "5a0b954317dbae311a7efde72e16a15970a34d9b997e9d4cd72254e3519f237a",
          "fromString(AssessmentItem)/toRepresentation": "fbaae089b3597d9961c3ba059c450224d42afa2ed715675dcbbcf449a69eff43",
          "fromString(AssessmentItem)/toStandardJSONSchemaV1": "99c9a7d9fb71b4a52294608dfe4a6243def1726b49c910359cc38450816e0a5c",
          "fromString(AssessmentItem)/toStandardSchemaV1": "8fd786aa12b6705bdf56c83f6005f9876dc16f71e243313cc0d60ea3e115fffb",
          "fromString(AssessmentItem)/toTaggedUnion": "d0634b45c3f0616c6f48240deea658cddb94c536557506266e36260fa209ff56",
          "fromString(AssessmentItem)/toType": "e9ca831e80a51d4c61cf21ae01576b50de6757a7381e4282a5ba1af950e16929",
          "fromString(AssessmentTest)/Arbitrary.schema": "a7f2fa5a67ae5690936a866afc39bcd168db80b8eb1a0c6ff2e77714e3c8220a",
          "fromString(AssessmentTest)/toCodecArrayFromSingle": "466c28ba823459bf19d3b952155c76449b5ade0e74296cd55f9e0d482082a3ba",
          "fromString(AssessmentTest)/toCodecGoJson": "466c28ba823459bf19d3b952155c76449b5ade0e74296cd55f9e0d482082a3ba",
          "fromString(AssessmentTest)/toCodecIso": "804befdf0f933c0db1885533d473b4cc1d38b742b91764acbb7a375c9722b4f4",
          "fromString(AssessmentTest)/toCodecJson": "466c28ba823459bf19d3b952155c76449b5ade0e74296cd55f9e0d482082a3ba",
          "fromString(AssessmentTest)/toCodecStringTree": "466c28ba823459bf19d3b952155c76449b5ade0e74296cd55f9e0d482082a3ba",
          "fromString(AssessmentTest)/toDifferJsonPatch": "f20adf0dc9daf1bb33b41d8b55982d3f6f3ed6cf612eb8111ae91331d5011a9b",
          "fromString(AssessmentTest)/toEncoded": "cdfef2e55ebeb1e469a12c1f224f96ffce6a164d4dcc11574d53d7f29a9e2718",
          "fromString(AssessmentTest)/toEncoderXml": "e19014d6c22b51e9676c86bf169023d076a020dfb70f0ef32d9160c951b38424",
          "fromString(AssessmentTest)/toEquivalence": "ed8005a9093b7f8327eed5a401f5c92b366ee2491016648ed3c597061f23a5f3",
          "fromString(AssessmentTest)/toFormatter": "2a251e383f5a1f0ea48122fa4f3ae91708c28dc8bb9d3354a5c619123e63fb5f",
          "fromString(AssessmentTest)/toIso": "cb9a0e29f3eb1edc2493c1324665053891faf8dade095776997424779a7b8ec2",
          "fromString(AssessmentTest)/toIsoFocus": "cb9a0e29f3eb1edc2493c1324665053891faf8dade095776997424779a7b8ec2",
          "fromString(AssessmentTest)/toIsoSource": "cb9a0e29f3eb1edc2493c1324665053891faf8dade095776997424779a7b8ec2",
          "fromString(AssessmentTest)/toJsonSchemaDocument": "5a0b954317dbae311a7efde72e16a15970a34d9b997e9d4cd72254e3519f237a",
          "fromString(AssessmentTest)/toRepresentation": "fbaae089b3597d9961c3ba059c450224d42afa2ed715675dcbbcf449a69eff43",
          "fromString(AssessmentTest)/toStandardJSONSchemaV1": "e6c40d7e888170bbf0d9cf049c92d5024f70e2a59855833e14ec09e5a0c25e30",
          "fromString(AssessmentTest)/toStandardSchemaV1": "2cd2fbd94064ccb6a48373ae26b01f7a50abccbd88d3a220e23ee1c44a32627a",
          "fromString(AssessmentTest)/toTaggedUnion": "d0634b45c3f0616c6f48240deea658cddb94c536557506266e36260fa209ff56",
          "fromString(AssessmentTest)/toType": "9af9fb1d20c0b417415f49ec884e1ada08a2b46d3d0a4c45a890ed51960473d5",
          "fromString(ChoiceInteraction)/Arbitrary.schema": "336cff6874bd36c08ac641fd08a7dfd218413244667c5e57fbe0498918a1e994",
          "fromString(ChoiceInteraction)/toCodecArrayFromSingle": "2f1991f10e8058b7f598fdc6ffadef238398719c24e0f4960c33077916b6d41d",
          "fromString(ChoiceInteraction)/toCodecGoJson": "2f1991f10e8058b7f598fdc6ffadef238398719c24e0f4960c33077916b6d41d",
          "fromString(ChoiceInteraction)/toCodecIso": "a38b1f5116011f79b424af488394e783199535cb443359e9d15c7bdc1b2375ce",
          "fromString(ChoiceInteraction)/toCodecJson": "2f1991f10e8058b7f598fdc6ffadef238398719c24e0f4960c33077916b6d41d",
          "fromString(ChoiceInteraction)/toCodecStringTree": "2f1991f10e8058b7f598fdc6ffadef238398719c24e0f4960c33077916b6d41d",
          "fromString(ChoiceInteraction)/toDifferJsonPatch": "f92ca4552a6875192b0bfcb3014f8f01314836a51a76076a4a3d997e3dc107dc",
          "fromString(ChoiceInteraction)/toEncoded": "cdfef2e55ebeb1e469a12c1f224f96ffce6a164d4dcc11574d53d7f29a9e2718",
          "fromString(ChoiceInteraction)/toEncoderXml": "6472c4023dad04c70d13b9bb45776ecc6ba5302aa953b23bb13ad2901b95fa28",
          "fromString(ChoiceInteraction)/toEquivalence": "ed8005a9093b7f8327eed5a401f5c92b366ee2491016648ed3c597061f23a5f3",
          "fromString(ChoiceInteraction)/toFormatter": "5bc35fb31aff853feb0949767653ceeb2b6ed59d5a7c6e129a0ca6fbcb58b89b",
          "fromString(ChoiceInteraction)/toIso": "dcb304ffa9236cc5f0fb766345b3e439210563e469028820340f190dcb8ae5a8",
          "fromString(ChoiceInteraction)/toIsoFocus": "dcb304ffa9236cc5f0fb766345b3e439210563e469028820340f190dcb8ae5a8",
          "fromString(ChoiceInteraction)/toIsoSource": "dcb304ffa9236cc5f0fb766345b3e439210563e469028820340f190dcb8ae5a8",
          "fromString(ChoiceInteraction)/toJsonSchemaDocument": "5a0b954317dbae311a7efde72e16a15970a34d9b997e9d4cd72254e3519f237a",
          "fromString(ChoiceInteraction)/toRepresentation": "fbaae089b3597d9961c3ba059c450224d42afa2ed715675dcbbcf449a69eff43",
          "fromString(ChoiceInteraction)/toStandardJSONSchemaV1": "db36c70753415029732c060f7ad2574669e9fe388692f550de55ed29d3dbb846",
          "fromString(ChoiceInteraction)/toStandardSchemaV1": "fed965a5896d668b7c77a71baee72ed0f38a8eca6278ad4c2f2ef9d0c2ff2a78",
          "fromString(ChoiceInteraction)/toTaggedUnion": "d0634b45c3f0616c6f48240deea658cddb94c536557506266e36260fa209ff56",
          "fromString(ChoiceInteraction)/toType": "93c69189c6d8a111c15f7e3fad8d1d64ae924511a81e422cc7cd600018f461de",
          "fromString(Div)/Arbitrary.schema": "d00406221099f6f66b3ef3ec76aea128ee04086305ff25b7c56d567eb91478de",
          "fromString(Div)/toCodecArrayFromSingle": "b5143b0b8c982911de43b216fd324d96adb0f2cf1f7f28cd54ba6a15736dc395",
          "fromString(Div)/toCodecGoJson": "b5143b0b8c982911de43b216fd324d96adb0f2cf1f7f28cd54ba6a15736dc395",
          "fromString(Div)/toCodecIso": "bf320a123ac1768bcab34ddcedfa90ed79b714bda001ed587a1d7df944b5a809",
          "fromString(Div)/toCodecJson": "b5143b0b8c982911de43b216fd324d96adb0f2cf1f7f28cd54ba6a15736dc395",
          "fromString(Div)/toCodecStringTree": "b5143b0b8c982911de43b216fd324d96adb0f2cf1f7f28cd54ba6a15736dc395",
          "fromString(Div)/toDifferJsonPatch": "da71687269b5d38e538125b2a59be7a5698db9f1cb0909adfcb0d24e13416350",
          "fromString(Div)/toEncoded": "cdfef2e55ebeb1e469a12c1f224f96ffce6a164d4dcc11574d53d7f29a9e2718",
          "fromString(Div)/toEncoderXml": "e645c3c7829c8c0cb45764ad9fdf017a44553d46864eb5a4d118e3ac8d0de142",
          "fromString(Div)/toEquivalence": "ed8005a9093b7f8327eed5a401f5c92b366ee2491016648ed3c597061f23a5f3",
          "fromString(Div)/toFormatter": "db92112f8336637daa260994661e72c5049dc40e660bbd6fca4fc995dc64f120",
          "fromString(Div)/toIso": "64a50bb04e05c44ac53bf5ee9eadfaf7456cd9e0283948c95f846c37a5bc2b5e",
          "fromString(Div)/toIsoFocus": "64a50bb04e05c44ac53bf5ee9eadfaf7456cd9e0283948c95f846c37a5bc2b5e",
          "fromString(Div)/toIsoSource": "64a50bb04e05c44ac53bf5ee9eadfaf7456cd9e0283948c95f846c37a5bc2b5e",
          "fromString(Div)/toJsonSchemaDocument": "5a0b954317dbae311a7efde72e16a15970a34d9b997e9d4cd72254e3519f237a",
          "fromString(Div)/toRepresentation": "fbaae089b3597d9961c3ba059c450224d42afa2ed715675dcbbcf449a69eff43",
          "fromString(Div)/toStandardJSONSchemaV1": "3fd33fca3417b1978e4caed98ffee42ff2583924b82be90c6dbf5da03af02d30",
          "fromString(Div)/toStandardSchemaV1": "8d8dc7006f06c6b04bb24da627dd6fe0a7204b17edfc346c9296dd1e2d735823",
          "fromString(Div)/toTaggedUnion": "d0634b45c3f0616c6f48240deea658cddb94c536557506266e36260fa209ff56",
          "fromString(Div)/toType": "bae91b65521934dbeefa3dbd317fceb7345fb1251eccc0db479365070c648356",
          "fromString(ItemRef)/Arbitrary.schema": "f9c8b0609f5f9123611932cdb3896417b3baf9795482c256dfa81e0aed88b793",
          "fromString(ItemRef)/toCodecArrayFromSingle": "77f98087a6cc8d554496b8b8e23d17a53c90c621ef1edb22515d0311dbf1f66a",
          "fromString(ItemRef)/toCodecGoJson": "77f98087a6cc8d554496b8b8e23d17a53c90c621ef1edb22515d0311dbf1f66a",
          "fromString(ItemRef)/toCodecIso": "5a5eb6af7c8be80e93249fccfffe72ce99b7886b20f5cab4f45f7f4c217f6465",
          "fromString(ItemRef)/toCodecJson": "77f98087a6cc8d554496b8b8e23d17a53c90c621ef1edb22515d0311dbf1f66a",
          "fromString(ItemRef)/toCodecStringTree": "77f98087a6cc8d554496b8b8e23d17a53c90c621ef1edb22515d0311dbf1f66a",
          "fromString(ItemRef)/toDifferJsonPatch": "0c3955986da4b1e5dfa6dbad08fc1ba02de1ad8c6fe4b159fdc837e5147bace9",
          "fromString(ItemRef)/toEncoded": "cdfef2e55ebeb1e469a12c1f224f96ffce6a164d4dcc11574d53d7f29a9e2718",
          "fromString(ItemRef)/toEncoderXml": "7a0d99efacfff123406fe607196111bf17407b85562633285dbfa267ea6b3033",
          "fromString(ItemRef)/toEquivalence": "ed8005a9093b7f8327eed5a401f5c92b366ee2491016648ed3c597061f23a5f3",
          "fromString(ItemRef)/toFormatter": "a8a2369646556f68a595638b0cc13d424be31c3fdaee46a341abaf8010f9c68e",
          "fromString(ItemRef)/toIso": "0ea27d56dd99995336da4f4b7c381fcbf6b986f248a1ee6f64445bf5b5ed28e0",
          "fromString(ItemRef)/toIsoFocus": "0ea27d56dd99995336da4f4b7c381fcbf6b986f248a1ee6f64445bf5b5ed28e0",
          "fromString(ItemRef)/toIsoSource": "0ea27d56dd99995336da4f4b7c381fcbf6b986f248a1ee6f64445bf5b5ed28e0",
          "fromString(ItemRef)/toJsonSchemaDocument": "5a0b954317dbae311a7efde72e16a15970a34d9b997e9d4cd72254e3519f237a",
          "fromString(ItemRef)/toRepresentation": "fbaae089b3597d9961c3ba059c450224d42afa2ed715675dcbbcf449a69eff43",
          "fromString(ItemRef)/toStandardJSONSchemaV1": "61211400bd8c0021ce146054b16f41d62adf3b3a59dbdf95ca1d4e8c21d7d2b5",
          "fromString(ItemRef)/toStandardSchemaV1": "fbba64d63b9fa3f0a7a131897f792a5d98daede721f7214cce342669a2e859e3",
          "fromString(ItemRef)/toTaggedUnion": "d0634b45c3f0616c6f48240deea658cddb94c536557506266e36260fa209ff56",
          "fromString(ItemRef)/toType": "50e84aedc6c869625f561420b7800d812c9f1abb8727e9e077f2da486edcf3d9",
          "fromString(MathElement)/Arbitrary.schema": "c169f0867cb5cf61464866b1e1fd63cf028a42909d9ee5dda884189278138199",
          "fromString(MathElement)/toCodecArrayFromSingle": "88322ab29d39ea9d674da5110474dc5c020e04600aef0874cc3ee4e78ee7cb22",
          "fromString(MathElement)/toCodecGoJson": "88322ab29d39ea9d674da5110474dc5c020e04600aef0874cc3ee4e78ee7cb22",
          "fromString(MathElement)/toCodecIso": "a5a2353e5aaa03c34e0e274128a5e4e8d1f9b0eba1f96a0595cf969f407789fd",
          "fromString(MathElement)/toCodecJson": "88322ab29d39ea9d674da5110474dc5c020e04600aef0874cc3ee4e78ee7cb22",
          "fromString(MathElement)/toCodecStringTree": "88322ab29d39ea9d674da5110474dc5c020e04600aef0874cc3ee4e78ee7cb22",
          "fromString(MathElement)/toDifferJsonPatch": "8150b484a2181e25162cc4d9c16874da03d3453236c71f9ed7d50227f532572d",
          "fromString(MathElement)/toEncoded": "cdfef2e55ebeb1e469a12c1f224f96ffce6a164d4dcc11574d53d7f29a9e2718",
          "fromString(MathElement)/toEncoderXml": "7728cfc89fd76680add60dd33be0040e3db565bba1f76e781094eb478683b59a",
          "fromString(MathElement)/toEquivalence": "ed8005a9093b7f8327eed5a401f5c92b366ee2491016648ed3c597061f23a5f3",
          "fromString(MathElement)/toFormatter": "0a945b437da881d21f7776cb7f23d4d264636aa840ccfea3134b5f4ece68b9f6",
          "fromString(MathElement)/toIso": "f9c428789d77adaad7fdcd7c7c3147993c5169b37421565faf507fd922befd71",
          "fromString(MathElement)/toIsoFocus": "f9c428789d77adaad7fdcd7c7c3147993c5169b37421565faf507fd922befd71",
          "fromString(MathElement)/toIsoSource": "f9c428789d77adaad7fdcd7c7c3147993c5169b37421565faf507fd922befd71",
          "fromString(MathElement)/toJsonSchemaDocument": "5a0b954317dbae311a7efde72e16a15970a34d9b997e9d4cd72254e3519f237a",
          "fromString(MathElement)/toRepresentation": "fbaae089b3597d9961c3ba059c450224d42afa2ed715675dcbbcf449a69eff43",
          "fromString(MathElement)/toStandardJSONSchemaV1": "60a9de23148ad66630064bd29a1ea8465e90bc00a2b9d406bd951ee7ec1ad45f",
          "fromString(MathElement)/toStandardSchemaV1": "a77e7ed22f3ccc9700574c69536df0d6fde466a2d17f5cc862287c587ff9b873",
          "fromString(MathElement)/toTaggedUnion": "d0634b45c3f0616c6f48240deea658cddb94c536557506266e36260fa209ff56",
          "fromString(MathElement)/toType": "3dce034f4dffe2f77f58988ea08df32ed3c8a0f574d822d4443e3168f90f9556",
        }
      `);
    }),
  );
});
