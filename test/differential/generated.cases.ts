/**
 * The inputs of the generated-value differential suite: per root, values drawn by
 * `effect/Arbitrary` from the decoded type of the `src` root with a fixed seed and their strings
 * held to XML characters, the hand-built {@link samples} of the feature vocabulary, the encoded
 * text of each value that encodes, and corruptions of every feature value at one leaf.
 *
 * The roots are the feature roots of `features.ts`, streaming `ItemRef` and `AssessmentTest`, and
 * QTI `AssessmentItem`, each paired with its {@link standardOf} copy. Values are plain data, so
 * one value serves both sides. This module imports no test runner, so the acceptance run and the
 * no-eval child processes reuse exactly the values and texts this suite compares.
 */
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";

import { XmlSchema as SrcXml } from "../../src/index.ts";
import * as SrcQti from "../qti/vocabulary.ts";
import * as SrcStreaming from "../streaming/vocabulary.ts";
import { checkedMax, FEATURE, featureIds, makeFeatures, samples } from "./features.ts";
import type { FeatureId } from "./features.ts";
import { standardOf } from "./harness.ts";
import type { DocumentInput, EncodeInput, Sides } from "./harness.ts";

/**
 * A `src` root, or its standard-path copy: an element codec with no services.
 */
export type SrcRoot = Schema.Codec<unknown, SrcXml.XmlElement<string>>;

/**
 * The id of every root the suite generates values for.
 */
export type RootId = FeatureId | "AssessmentItem" | "AssessmentTest" | "ItemRef";

/**
 * The fixed seed of every generated run, the `Arbitrary` sample and the property checks alike.
 */
export const seed = 20_261_106;

/**
 * The fixed number of values drawn per root, and the run count of each property check.
 */
export const runs = 8;

/**
 * The fixed local complexity scale of every generated run.
 */
export const size = 4;

/**
 * How a root's values were obtained: `"derived"` when `Arbitrary.schema` derives the root's
 * decoded type, otherwise the derivation's error message, and the root's values are its
 * {@link samples} only.
 */
export type Derivation = "derived" | { readonly message: string };

/**
 * One root under comparison: its `src` definition and standard-path copy, the one-step record path
 * of its Clark name, and how its values were obtained from the `src` definition.
 */
export interface GeneratedRoot {
  readonly id: RootId;
  readonly roots: Sides<SrcRoot>;
  readonly path: readonly string[];
  readonly derivation: Derivation;
}

/**
 * The leaf a corruption breaks and how.
 *
 * `check`, `finite`, and `literal` are values the leaf schema rejects on encode; `nul` and
 * `surrogate` are characters XML cannot hold; `unmapped` is an attribute in a namespace no prefix
 * spells; `member`, `number-child`, and `number-attribute` are open-`mixed` `*` items the open
 * member's guard refuses; `excess` is an extra key under `onExcessProperty: "error"`.
 */
export type Corruption =
  | "check"
  | "excess"
  | "finite"
  | "literal"
  | "member"
  | "nul"
  | "number-attribute"
  | "number-child"
  | "surrogate"
  | "unmapped";

/**
 * One value input of the suite: a generated value, a sample, or a corruption of either.
 *
 * `intended` names the library reason a corruption is built to provoke on the `fromString`
 * surface. A leaf rejection (`check`, `finite`, `literal`) and `excess` provoke
 * `EncodeSchemaFailure`, because `fromString` hands the value to `encodeString` unchecked and the
 * root's own encode rejects it there.
 */
export interface GeneratedEncodeInput extends EncodeInput<unknown, SrcRoot> {
  readonly root: RootId;
  readonly origin: "generated" | "sample";
  readonly corruption?: Corruption;
}

/**
 * One text input of the suite: the `src` encode of a value that encodes, read back on both sides
 * through the whole-document codec and the record channel at the root's path.
 */
export interface GeneratedDocumentInput extends DocumentInput<SrcRoot> {
  readonly root: RootId;
  readonly path: readonly string[];
}

/**
 * The feature roots, built once on `src`.
 */
const featureRoots: Readonly<Record<FeatureId, SrcRoot>> = makeFeatures();

/**
 * Pair a `src` root with its standard-path copy.
 *
 * @param root - The `src` root.
 * @returns The root and its {@link standardOf} copy.
 */
const sidesOf = (root: SrcRoot): Sides<SrcRoot> => ({ src: root, standard: standardOf(root) });

/**
 * A namespace no feature root's map binds, so an attribute in it has no prefix to spell it.
 */
export const UNMAPPED = "urn:effect-xml:feature:unmapped";

/**
 * Describe a thrown value by its message.
 *
 * @param cause - What a derivation threw.
 * @returns The error's message, or the value as text when it is not an `Error`.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- `Effect.try` hands over whatever the derivation threw.
export const messageOf = (cause: unknown): string =>
  Predicate.isError(cause) ? cause.message : String(cause);

/**
 * The UTF-16 code units outside the XML `Char` production, one at a time: C0 controls other than
 * tab, line feed, and carriage return, a surrogate not part of a valid pair, and U+FFFE and U+FFFF.
 *
 * @see {@link https://www.w3.org/TR/xml/#charsets} for the `Char` production.
 */
// The `u` flag reads a valid surrogate pair as one code point, so the surrogate range matches a
// lone surrogate only.
// oxlint-disable-next-line eslint/no-control-regex -- the C0 controls XML cannot hold are exactly what this expression finds.
const nonChar = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu;

/**
 * Replace every code unit of a drawn value's strings that XML cannot hold, at every depth.
 *
 * `Arbitrary` draws any UTF-16 string for a `Schema.String` leaf, so many drawn text and attribute
 * values hold U+0000 or a lone surrogate and fail on encode with `InvalidEvent`; the corruptions
 * provoke that reason explicitly. Each offending code unit becomes U+FFFD, one code unit for one,
 * so a length check the drawn string passed still holds. Keys are kept as drawn.
 *
 * @param value - A value `Arbitrary` drew, as plain data.
 * @returns A copy whose strings hold only XML characters.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- a drawn value of any root, rewritten as plain data.
const toXmlChars = (value: unknown): unknown => {
  if (Predicate.isString(value)) {
    return value.replaceAll(nonChar, "\uFFFD");
  }

  if (Array.isArray(value)) {
    return value.map(toXmlChars);
  }

  if (Predicate.isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [key, toXmlChars(field)] as const),
    );
  }

  return value;
};

/**
 * Derive values for one root's decoded type with the fixed seed, size, and run count, with their
 * strings constrained to XML characters by {@link toXmlChars}.
 *
 * @param root - The `src` root.
 * @returns The derivation outcome and the drawn values; a root `Arbitrary.schema` cannot derive
 *   draws none.
 */
const draw = (root: SrcRoot): { readonly derivation: Derivation; readonly values: unknown[] } =>
  Effect.runSync(
    Effect.try({
      catch: messageOf,
      try: () => Arbitrary.schema(Schema.toType(root)),
    }).pipe(
      Effect.flatMap((arbitrary) =>
        Arbitrary.sampleEffect(arbitrary, { count: runs, seed, size }).pipe(
          Effect.mapError((failure) => `${failure._tag} after ${failure.generated} values`),
        ),
      ),
      Effect.match({
        onFailure: (message) => ({ derivation: { message }, values: [] }),
        onSuccess: (values) => ({ derivation: "derived" as const, values: values.map(toXmlChars) }),
      }),
    ),
  );

/**
 * Every root definition with its standard-path copy and record path, in a fixed order.
 */
const definitions: readonly {
  readonly id: RootId;
  readonly roots: Sides<SrcRoot>;
  readonly path: readonly string[];
}[] = [
  ...featureIds.map((id) => ({
    id,
    path: [SrcXml.clark(Option.some(FEATURE), id.toLowerCase())],
    roots: sidesOf(featureRoots[id]),
  })),
  {
    id: "ItemRef",
    path: [SrcXml.clark(Option.some(SrcStreaming.QTI), "qti-assessment-item-ref")],
    roots: sidesOf(SrcStreaming.ItemRef),
  },
  {
    id: "AssessmentTest",
    path: [...SrcStreaming.testPath],
    roots: sidesOf(SrcStreaming.AssessmentTest),
  },
  {
    id: "AssessmentItem",
    path: [SrcXml.clark(Option.some(SrcQti.QTI), "qti-assessment-item")],
    roots: sidesOf(SrcQti.AssessmentItem),
  },
];

/**
 * The drawn values of every root, keyed by root id.
 */
const drawn = new Map(definitions.map(({ id, roots }) => [id, draw(roots.src)] as const));

/**
 * Read a root's draw.
 *
 * @param id - The root id.
 * @returns The derivation outcome and the drawn values.
 * @throws {Error} When the id names no root.
 */
const drawOf = (id: RootId): ReturnType<typeof draw> => {
  const found = drawn.get(id);

  if (found === undefined) {
    throw new Error(`no draw for root ${id}`);
  }

  return found;
};

/**
 * Every root under comparison, in a fixed order: the feature roots, then `ItemRef`,
 * `AssessmentTest`, and `AssessmentItem`.
 */
export const generatedRoots: readonly GeneratedRoot[] = definitions.map((definition) => ({
  ...definition,
  derivation: drawOf(definition.id).derivation,
}));

/**
 * Replace one field of a value, keeping the order of the other keys and appending a new one.
 *
 * @param value - The value to corrupt; anything that is not an object is returned unchanged.
 * @param key - The field to replace or add.
 * @param field - The field's new value.
 * @returns A copy of the value with the field replaced.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- a generated or hand-built value of any root, corrupted as plain data.
const withField = (value: unknown, key: string, field: unknown): unknown =>
  Predicate.isObject(value) ? { ...value, [key]: field } : value;

/**
 * Read an array field of a value.
 *
 * @param value - The value.
 * @param key - The field.
 * @returns The field's items, or none when it is absent or not an array.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a generated or hand-built value of any root, read as plain data.
const itemsOf = (value: unknown, key: string): readonly unknown[] => {
  const items: unknown = Predicate.isObject(value) ? value[key] : undefined;

  return Array.isArray(items) ? items : [];
};

/**
 * One way to corrupt a feature value at one leaf, with the library reason it is built to provoke
 * and the parse options it runs under.
 */
interface Corruptor {
  readonly corruption: Corruption;
  readonly intended?: SrcXml.EncodeErrorReason["_tag"];
  readonly parseOptions?: SchemaAST.ParseOptions;
  // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- a generated or hand-built value of any root, corrupted as plain data.
  readonly apply: (value: unknown) => unknown;
}

/**
 * An open item in a namespace the root's map binds, with an attribute and child the caller sets.
 *
 * @param local - The item's local name.
 * @param attributes - The item's attributes, possibly not strings.
 * @param children - The item's children, possibly not strings or elements.
 * @returns The item as a resolved element.
 */
const openElement = (
  local: string,
  attributes: Readonly<Record<string, number | string>>,
  children: readonly (number | string)[],
) => ({ attributes, children, name: SrcXml.clark(Option.some(FEATURE), local) });

/**
 * The corruptions of each feature root.
 */
const corruptors: Readonly<Record<FeatureId, readonly Corruptor[]>> = {
  Bag: [
    {
      apply: (value) => withField(value, "size", Number.NaN),
      corruption: "finite",
      intended: "EncodeSchemaFailure",
    },
    {
      apply: (value) =>
        withField(value, "*", [
          ...itemsOf(value, "*"),
          openElement("stray", { [SrcXml.clark(Option.some(UNMAPPED), "a")]: "1" }, []),
        ]),
      corruption: "unmapped",
      intended: "UnmappedNamespace",
    },
    {
      apply: (value) =>
        withField(value, "*", [...itemsOf(value, "*"), openElement("stray", {}, ["a\u0000"])]),
      corruption: "nul",
      intended: "InvalidEvent",
    },
  ],
  Catalog: [
    {
      apply: (value) => withField(value, "note", { $text: "x".repeat(checkedMax + 1) }),
      corruption: "check",
      intended: "EncodeSchemaFailure",
    },
    {
      apply: (value) => withField(value, "count", Number.NaN),
      corruption: "finite",
      intended: "EncodeSchemaFailure",
    },
    {
      apply: (value) => withField(value, "p:level", "none"),
      corruption: "literal",
      intended: "EncodeSchemaFailure",
    },
    {
      apply: (value) => withField(value, "title", { $text: "a\u0000b" }),
      corruption: "nul",
      intended: "InvalidEvent",
    },
    {
      apply: (value) => withField(value, "id", "\uD800"),
      corruption: "surrogate",
      intended: "InvalidEvent",
    },
    {
      apply: (value) => withField(value, "stray", "x"),
      corruption: "excess",
      intended: "EncodeSchemaFailure",
      parseOptions: { onExcessProperty: "error" },
    },
  ],
  Doc: [
    {
      apply: (value) =>
        withField(value, "$children", [
          ...itemsOf(value, "$children"),
          { _tag: "*", element: openElement("em", {}, ["declared"]) },
        ]),
      corruption: "member",
      intended: "EncodeSchemaFailure",
    },
    {
      apply: (value) =>
        withField(value, "$children", [
          ...itemsOf(value, "$children"),
          { _tag: "*", element: openElement("span", {}, [42]) },
        ]),
      corruption: "number-child",
      intended: "EncodeSchemaFailure",
    },
    {
      apply: (value) =>
        withField(value, "$children", [
          ...itemsOf(value, "$children"),
          { _tag: "*", element: openElement("span", { plain: 7 }, []) },
        ]),
      corruption: "number-attribute",
      intended: "EncodeSchemaFailure",
    },
    {
      apply: (value) =>
        withField(value, "$children", [
          ...itemsOf(value, "$children"),
          {
            _tag: "*",
            element: openElement("span", { [SrcXml.clark(Option.some(UNMAPPED), "a")]: "1" }, []),
          },
        ]),
      corruption: "unmapped",
      intended: "UnmappedNamespace",
    },
    {
      apply: (value) => withField(value, "p:id", "\uDC00"),
      corruption: "surrogate",
      intended: "InvalidEvent",
    },
  ],
  Node: [
    {
      apply: (value) => withField(value, "label", "\uD800"),
      corruption: "surrogate",
      intended: "InvalidEvent",
    },
  ],
  Para: [
    {
      apply: (value) =>
        withField(value, "$children", [
          ...itemsOf(value, "$children"),
          { _tag: "code", value: { $text: "x", level: "none" } },
        ]),
      corruption: "literal",
      intended: "EncodeSchemaFailure",
    },
    {
      apply: (value) =>
        withField(value, "$children", [
          ...itemsOf(value, "$children"),
          { _tag: "$text", text: "a\u0000" },
        ]),
      corruption: "nul",
      intended: "InvalidEvent",
    },
  ],
};

/**
 * Check whether a root id names a feature root.
 *
 * @param id - The root id.
 * @returns `true` for a feature root.
 */
const isFeature = (id: RootId): id is FeatureId => featureIds.some((feature) => feature === id);

/**
 * The hand-built feature values.
 */
const sampled = samples();

/**
 * Every value input of the suite, with ids of the form `root/origin/index` and, for a corruption,
 * `root/origin/index/corruption`: each generated value and sample, then each corruption of it.
 */
export const encodeInputs: readonly GeneratedEncodeInput[] = generatedRoots.flatMap(
  ({ id, roots }) => {
    const origins = [
      ...drawOf(id).values.map((value) => ({ origin: "generated" as const, value })),
      ...(isFeature(id) ? sampled[id] : []).map((value) => ({ origin: "sample" as const, value })),
    ];

    return origins.flatMap(({ origin, value }, index): GeneratedEncodeInput[] => {
      const base = `${id}/${origin}/${index}`;

      return [
        { id: base, origin, root: id, roots, value },
        ...(isFeature(id) ? corruptors[id] : []).map(
          ({ apply, ...corruptor }): GeneratedEncodeInput => ({
            ...corruptor,
            id: `${base}/${corruptor.corruption}`,
            origin,
            root: id,
            roots,
            value: apply(value),
          }),
        ),
      ];
    });
  },
);

/**
 * Read a root's record path.
 *
 * @param id - The root id.
 * @returns The one-step path of its Clark name.
 * @throws {Error} When the id names no root.
 */
const pathOf = (id: RootId): readonly string[] => {
  const found = generatedRoots.find((root) => root.id === id);

  if (found === undefined) {
    throw new Error(`no root ${id}`);
  }

  return found.path;
};

/**
 * Every text input of the suite: the `src` side's `fromString` encode of each uncorrupted value
 * that encodes, with the same id as its value input.
 */
export const documentInputs: readonly GeneratedDocumentInput[] = encodeInputs.flatMap(
  ({ corruption, id, root, roots, value }): GeneratedDocumentInput[] => {
    if (corruption !== undefined) {
      return [];
    }

    const exit = Schema.encodeUnknownExit(SrcXml.fromString(roots.src))(value);

    return Exit.isSuccess(exit) ? [{ id, path: pathOf(root), root, roots, text: exit.value }] : [];
  },
);

/**
 * The least number of drawn values of a derived root that must encode, and of every root's drawn
 * values together.
 *
 * {@link toXmlChars} lets every drawn value of the feature roots, `ItemRef`, and
 * `AssessmentTest` encode. `AssessmentItem` encodes 3 of its 8: `Arbitrary` draws its `data-*` rest
 * keys as any string, and a key that is not an XML name fails on encode.
 */
export const encodedFloor = { perRoot: 3, total: 40 } as const;

/**
 * The number of drawn values of each derived root, and of them the number that encode: the
 * `generated` value inputs and the text inputs among them.
 */
export const encodedCounts: Readonly<
  Partial<Record<RootId, { readonly drawn: number; readonly encoded: number }>>
> = Object.fromEntries(
  generatedRoots.flatMap(({ derivation, id }) => {
    if (derivation !== "derived") {
      return [];
    }

    const ids = new Set(
      encodeInputs.flatMap(({ corruption, id: input, origin, root }) =>
        root === id && origin === "generated" && corruption === undefined ? [input] : [],
      ),
    );

    return [
      [
        id,
        {
          drawn: ids.size,
          encoded: documentInputs.filter((input) => ids.has(input.id)).length,
        },
      ] as const,
    ];
  }),
);

/**
 * Hold the drawn values to {@link encodedFloor}, so the successful-encode path of every surface is
 * compared on generated values and not only on samples.
 *
 * @throws {Error} When a derived root, or every root together, has fewer encoded drawn values than
 *   the floor.
 */
const holdEncodedFloor = (): void => {
  const counts = Object.entries(encodedCounts);
  const total = counts.reduce((sum, [, count]) => sum + (count?.encoded ?? 0), 0);
  const short = counts.filter(([, count]) => (count?.encoded ?? 0) < encodedFloor.perRoot);

  if (short.length > 0 || total < encodedFloor.total) {
    throw new Error(
      `drawn values that encode fall below the floor (${encodedFloor.perRoot} per root, ${encodedFloor.total} in all): ${JSON.stringify(encodedCounts)}`,
    );
  }
};

holdEncodedFloor();
