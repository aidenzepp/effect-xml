/**
 * The feature vocabulary of the generated-value differential suite: element codecs on `src` that
 * together use every declaration export of the public surface. The suite compares each root's
 * fast path with its `standardOf` copy.
 *
 * The roots cover a default and a prefixed namespace, an attribute in the prefixed namespace, a
 * child element in a second namespace the root's map does not declare (the writer declares it
 * below the root), `suspend` recursion, `text`, `elements` with a plain, an `optionalKey`, and an
 * `Array` slot and with `{ open: true }`, `mixed` closed and open, attributes required and
 * optional, the `data-*` rest group, and leaf schemas of four kinds: plain `Schema.String`, the
 * transforming `Schema.Finite`, a checked `Schema.String`, and a `Schema.Literals` enum. This
 * module imports no test runner, so the cases module and child processes reuse it.
 */
import * as Schema from "effect/Schema";

import { XmlSchema as X } from "../../src/index.ts";

/**
 * The default element namespace of every feature root.
 */
export const FEATURE = "urn:effect-xml:feature";

/**
 * The namespace bound to the prefix `p` in the feature roots' map, for prefixed attributes.
 */
export const PREFIXED = "urn:effect-xml:feature:prefixed";

/**
 * The second namespace: a child element lives in it, and no feature root's map declares it.
 */
export const SECOND = "urn:effect-xml:feature:second";

/**
 * The checked leaf: a string of at most {@link checkedMax} characters, so a longer one fails the
 * check on encode.
 */
export const checkedMax = 12;

/**
 * The enum leaf's members, so a value outside them fails on encode.
 */
export const levels = ["low", "mid", "high"] as const;

/**
 * The decoded value of a `node`: a label and its child nodes, the recursion `suspend` closes.
 */
export interface NodeValue {
  readonly label: string;
  readonly child: readonly NodeValue[];
}

/**
 * Build the feature vocabulary on `src`.
 *
 * @returns The feature roots, each an element codec with no services.
 */
export const makeFeatures = () => {
  const feature = X.namespaces({ "": FEATURE, p: PREFIXED });
  const second = X.namespaces({ "": SECOND });

  const Title = feature.Element("title", { content: X.text(Schema.String) });

  const Note = feature.Element("note", {
    content: X.text(Schema.String.check(Schema.isMaxLength(checkedMax))),
  });

  const Entry = feature.Element("entry", {
    attributes: { level: Schema.Literals(levels) },
    content: X.text(Schema.Finite),
  });

  const Extra = second.Element("extra", { content: X.text(Schema.String) });

  const Node: X.Element<"node", NodeValue> = feature.Element("node", {
    attributes: { label: Schema.String },
    content: X.elements({ child: X.Array(feature.suspend("node", () => Node)) }),
  });

  const Catalog = feature.Element("catalog", {
    attributes: {
      count: Schema.optionalKey(Schema.Finite),
      "data-*": Schema.String,
      id: Schema.String,
      "p:level": Schema.Literals(levels),
    },
    content: X.elements({
      entry: X.Array(Entry),
      extra: Extra,
      node: Node,
      note: X.optionalKey(Note),
      title: Title,
    }),
  });

  const Em = feature.Element("em", { content: X.text(Schema.String) });

  const Code = feature.Element("code", {
    attributes: { level: Schema.Literals(levels) },
    content: X.text(Schema.String),
  });

  const Para = feature.Element("para", { content: X.mixed([Em, Code]) });

  const Bag = feature.Element("bag", {
    attributes: { size: Schema.Finite },
    content: X.elements({ title: Title }, { open: true }),
  });

  const Doc = feature.Element("doc", {
    attributes: { "p:id": Schema.String },
    content: X.mixed([Em], { open: true }),
  });

  return { Bag, Catalog, Doc, Node, Para };
};

/**
 * The feature roots, as {@link makeFeatures} builds them.
 */
export type Features = ReturnType<typeof makeFeatures>;

/**
 * The id of each feature root.
 */
export type FeatureId = keyof Features;

/**
 * Every feature root id in a fixed order.
 */
export const featureIds: readonly FeatureId[] = ["Catalog", "Node", "Para", "Bag", "Doc"];

/**
 * Build hand-written typed values for every feature root, so each root has an encoded value even
 * when `Arbitrary.schema` cannot derive it (open content holds `ResolvedElement`s under a
 * `Schema.declare`).
 *
 * The values are plain data and serve the fast and the standard path alike.
 *
 * @returns At least one value per feature root.
 */
export const samples = (): Readonly<Record<FeatureId, readonly unknown[]>> => ({
  Bag: [
    {
      "*": [
        {
          attributes: { [`{${PREFIXED}}tag`]: "kept" },
          children: ["loose ", { attributes: {}, children: ["inner"], name: `{${SECOND}}x` }],
          name: `{${FEATURE}}loose`,
        },
      ],
      size: 2,
      title: { $text: "bag" },
    },
  ],
  Catalog: [
    {
      count: 3,
      "data-kind": "full",
      entry: [
        { $text: 1.5, level: "low" },
        { $text: -2, level: "high" },
      ],
      extra: { $text: "second" },
      id: "c1",
      node: { child: [{ child: [], label: "leaf" }], label: "root" },
      note: { $text: "short" },
      "p:level": "mid",
      title: { $text: "Catalog" },
    },
    {
      entry: [],
      extra: { $text: "" },
      id: "c2",
      node: { child: [], label: "only" },
      "p:level": "low",
      title: { $text: "Bare" },
    },
  ],
  Doc: [
    {
      $children: [
        { _tag: "$text", text: "lead " },
        { _tag: "em", value: { $text: "stress" } },
        {
          _tag: "*",
          element: { attributes: { plain: "1" }, children: ["open"], name: `{${FEATURE}}span` },
        },
        { _tag: "$text", text: " tail" },
      ],
      "p:id": "d1",
    },
  ],
  Node: [{ child: [{ child: [{ child: [], label: "c" }], label: "b" }], label: "a" }],
  Para: [
    {
      $children: [
        { _tag: "$text", text: "see " },
        { _tag: "code", value: { $text: "x < y", level: "high" } },
        { _tag: "em", value: { $text: "now" } },
      ],
    },
  ],
});
