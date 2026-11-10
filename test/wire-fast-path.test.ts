/**
 * The proof corpus of the element wire check: every public surface of an element codec accepts
 * and rejects the same inputs, with the same issues, paths, messages, and positions, and every
 * `Schema` derivation of the codec gives the same output, as the codec whose encoded side checks
 * each element with `Schema.Record` and `Schema.Array` of
 * `Schema.Union([Schema.String, ResolvedElementSchema])`. Every expectation below was captured by
 * running that codec, so this file asserts message text (an exception to the repository's test
 * rule, scoped to this file).
 */
import { describe, expect, it } from "@effect/vitest";
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import type * as SchemaIssue from "effect/SchemaIssue";
import * as Stream from "effect/Stream";

import { XmlSchema } from "../src/index.ts";

/**
 * An empty element with one string attribute.
 */
const E = XmlSchema.Element("e", { attributes: { id: Schema.String } });

/**
 * A text element with an optional attribute.
 */
const T = XmlSchema.Element("t", {
  attributes: { n: Schema.optionalKey(Schema.String) },
  content: XmlSchema.text(Schema.String),
});

/**
 * A text element whose text decodes to a finite number.
 */
const V = XmlSchema.Element("v", { content: XmlSchema.text(Schema.Finite) });

/**
 * Closed `elements` content: one `e` and any number of `t`.
 */
const P = XmlSchema.Element("p", {
  attributes: { id: Schema.String },
  content: XmlSchema.elements({ e: E, items: XmlSchema.many(T) }),
});

/**
 * Closed `mixed` content of `e` and `t`.
 */
const M = XmlSchema.Element("m", { content: XmlSchema.mixed([E, T]) });

/**
 * Open `elements` content with an optional `e`.
 */
const OE = XmlSchema.Element("oe", {
  content: XmlSchema.elements({ e: XmlSchema.optionalKey(E) }, { open: true }),
});

/**
 * Open `mixed` content with one member, `e`.
 */
const OM = XmlSchema.Element("om", { content: XmlSchema.mixed([E], { open: true }) });

/**
 * An empty element that declares `data-*` attributes holding finite numbers.
 */
const D = XmlSchema.Element("d", { attributes: { "data-*": Schema.Finite, id: Schema.String } });

/**
 * The document root of the `fromString` and channel cases.
 */
const R = XmlSchema.Element("r", {
  content: XmlSchema.elements({
    d: XmlSchema.optionalKey(D),
    e: XmlSchema.many(E),
    m: XmlSchema.optionalKey(M),
    om: XmlSchema.optionalKey(OM),
    v: XmlSchema.optionalKey(V),
  }),
});

/**
 * The attributes of a hand-built element.
 */
type Attributes = Readonly<Record<string, string>>;

/**
 * A resolved element built by hand.
 *
 * @param name - The element's Clark name.
 * @param attributes - The element's attributes.
 * @param children - The element's children.
 * @returns The element value.
 */
const el = (name: string, attributes: Attributes, children: readonly unknown[] = []) => ({
  attributes,
  children,
  name,
});

/**
 * The element codecs of the direct cases, each with a valid hand-built value.
 */
const codecs = [
  { base: el("e", { id: "1" }), codec: E, label: "empty" },
  { base: el("t", { n: "a" }, ["hi"]), codec: T, label: "text" },
  {
    base: el("p", { id: "p1" }, [el("e", { id: "1" }), el("t", {}, ["x"]), el("t", {}, [])]),
    codec: P,
    label: "elements",
  },
  {
    base: el("m", {}, ["a", el("e", { id: "1" }), " b ", el("t", { n: "z" }, ["y"])]),
    codec: M,
    label: "mixed",
  },
  {
    base: el("oe", {}, [el("e", { id: "1" }), el("zz", { k: "v" }, ["x"])]),
    codec: OE,
    label: "open elements",
  },
  {
    base: el("om", {}, ["x", el("e", { id: "1" }), el("zz", {}, [])]),
    codec: OM,
    label: "open mixed",
  },
  { base: el("d", { "data-x": "2", id: "1" }, []), codec: D, label: "data" },
] as const;

/**
 * The hand-built value of one direct case.
 */
type Base = (typeof codecs)[number]["base"];

/**
 * Copy attributes and add a non-enumerable property whose value is not a string.
 *
 * @param attributes - The enumerable attributes.
 * @returns A copy of `attributes` with the hidden property `h`.
 */
const hidden = (attributes: Attributes) =>
  Object.defineProperty({ ...attributes }, "h", { enumerable: false, value: 1 });

/**
 * Copy attributes onto an object that inherits a property whose value is not a string.
 *
 * @param attributes - The own attributes.
 * @returns A copy of `attributes` whose prototype carries `inherited`.
 */
const inherited = (attributes: Attributes) => {
  const value = { ...attributes };

  Object.setPrototypeOf(value, { inherited: 1 });

  return value;
};

/**
 * Build an array of the given length with no elements.
 *
 * @param length - The array length.
 * @returns A sparse array.
 */
const sparse = (length: number) => {
  const holes: unknown[] = [];

  holes.length = length;

  return holes;
};

/**
 * Build a value without one of its keys.
 *
 * @param base - The valid value.
 * @param key - The key to drop.
 * @returns A copy of `base` without `key`.
 */
const without = (base: Base, key: "attributes" | "children" | "name") =>
  Object.fromEntries(Object.entries(base).filter(([k]) => k !== key));

/**
 * The attributes object `JSON.parse` builds with an own `__proto__` key.
 */
const protoKey: unknown = JSON.parse('{"__proto__":"x"}');

/**
 * The input variants of a direct case, each derived from the codec's valid value.
 *
 * @param base - The codec's valid value.
 * @returns The variant inputs by name.
 */
const variants = (base: Base): readonly (readonly [string, unknown])[] => [
  ["valid", base],
  ["attributes not an object", { ...base, attributes: 5 }],
  ["attributes null", { ...base, attributes: null }],
  ["attributes an array", { ...base, attributes: ["x"] }],
  ["attribute value not a string", { ...base, attributes: { ...base.attributes, q: 1 } }],
  ["attribute __proto__", { ...base, attributes: protoKey }],
  ["attribute symbol key", { ...base, attributes: { ...base.attributes, [Symbol.for("s")]: 1 } }],
  ["attribute non-enumerable", { ...base, attributes: hidden(base.attributes) }],
  ["attribute inherited", { ...base, attributes: inherited(base.attributes) }],
  ["children not an array", { ...base, children: "x" }],
  ["children an object", { ...base, children: {} }],
  ["child a number", { ...base, children: [...base.children, 1] }],
  [
    "child without name",
    { ...base, children: [...base.children, { attributes: {}, children: [] }] },
  ],
  [
    "child with a non-string attribute",
    { ...base, children: [{ ...el("e", {}), attributes: { id: 1 } }] },
  ],
  [
    "child undeclared with a non-string attribute",
    { ...base, children: [{ ...el("zz", {}), attributes: { a: 1 } }] },
  ],
  ["child undefined", { ...base, children: [...base.children, undefined] }],
  ["children sparse", { ...base, children: sparse(2) }],
  ["wrong name", { ...base, name: "zz" }],
  ["name not a string", { ...base, name: 1 }],
  ["missing attributes", without(base, "attributes")],
  ["missing children", without(base, "children")],
  ["missing name", without(base, "name")],
  ["excess key", { ...base, extra: 1 }],
  ["two failures", { ...base, attributes: { q: 1 }, children: [1] }],
  ["not an object", "x"],
  ["null", null],
  ["an array", []],
];

/**
 * The parse options each direct variant runs under.
 */
const optionSets: readonly (readonly [string, SchemaAST.ParseOptions | undefined])[] = [
  ["default", undefined],
  ["errors all", { errors: "all" }],
  ["excess error", { onExcessProperty: "error" }],
];

/**
 * Write an issue tree on one line: each node's `_tag`, the `_tag` of its AST when it has one, a
 * `Pointer`'s path, and its children.
 *
 * @param issue - The root issue.
 * @returns The tree as text.
 */
const treeOf = (issue: SchemaIssue.Issue): string => {
  const ast = "ast" in issue ? `<${issue.ast._tag}>` : "";

  if (issue._tag === "Pointer") {
    return `Pointer[${issue.path.map(String).join(",")}](${treeOf(issue.issue)})`;
  }

  if (issue._tag === "Composite" || issue._tag === "AnyOf") {
    return `${issue._tag}${ast}(${issue.issues.map(treeOf).join(";")})`;
  }

  if (issue._tag === "Encoding" || issue._tag === "Filter") {
    return `${issue._tag}${ast}(${treeOf(issue.issue)})`;
  }

  return `${issue._tag}${ast}`;
};

/**
 * The observable outcome of one direct decode: success, or the failure's issue tree and message.
 */
type Outcome = { readonly ok: true } | { readonly message: string; readonly tree: string };

/**
 * Summarize a direct decode exit.
 *
 * @param exit - The exit of `Schema.decodeUnknownExit` or of a decode effect.
 * @returns The outcome.
 */
const outcomeOf = (exit: Exit.Exit<unknown, Schema.SchemaError>): Outcome =>
  Exit.match(exit, {
    onFailure: (cause) => {
      const failure = cause.reasons.find((reason) => reason._tag === "Fail");

      return failure === undefined
        ? { message: String(cause), tree: "defect" }
        : { message: failure.error.message, tree: treeOf(failure.error.issue) };
    },
    onSuccess: (): Outcome => ({ ok: true }),
  });

/**
 * The fields a caller reads from an XML decode error, the position `"none"` when absent.
 */
interface ErrorSummary {
  readonly _tag: string;
  readonly message: string;
  readonly path: string;
  readonly position: XmlSchema.Position | "none";
  readonly reason: string;
}

/**
 * Summarize an XML decode error by the fields a caller reads.
 *
 * @param error - The XML decode error.
 * @returns Its tag, reason tag, path, message, and position.
 */
const errorOf = (error: XmlSchema.DecodeError): ErrorSummary => ({
  _tag: error._tag,
  message: error.message,
  path: error.path,
  position: error.position ?? "none",
  reason: error.reason._tag,
});

/**
 * The outcome of one whole-document decode: the decoded root, the XML decode error, or the text
 * `"no decode error"` when the failure carries none.
 */
type DocumentOutcome = { readonly value: (typeof R)["Type"] } | ErrorSummary | "no decode error";

/**
 * The outcome of one channel decode: the decoded records, the XML decode error, or `"defect"`.
 */
type ChannelOutcome = { readonly records: readonly (typeof R)["Type"][] } | ErrorSummary | "defect";

/**
 * The direct outcomes captured by running the codec whose encoded side parses `attributes` and
 * `children` with the general Schema parsers, keyed by codec, parse options, and variant.
 */
const DIRECT = new Map<string, Outcome>([
  ["empty | default | valid", { ok: true }],
  [
    "empty | default | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "empty | default | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "empty | default | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "empty | default | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "empty | default | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <e>; declared attributes: id. Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  ["empty | default | attribute symbol key", { ok: true }],
  ["empty | default | attribute non-enumerable", { ok: true }],
  ["empty | default | attribute inherited", { ok: true }],
  [
    "empty | default | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "empty | default | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "empty | default | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "empty | default | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "empty | default | child with a non-string attribute",
    {
      message:
        "<e> must be empty but contains <e>. Remove the content or declare text, element, or mixed content for <e>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "empty | default | child undeclared with a non-string attribute",
    {
      message:
        "<e> must be empty but contains <zz>. Remove the content or declare text, element, or mixed content for <e>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "empty | default | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "empty | default | children sparse",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "empty | default | wrong name",
    {
      message: 'Expected "e"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "empty | default | name not a string",
    {
      message: 'Expected "e"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "empty | default | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "empty | default | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "empty | default | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  ["empty | default | excess key", { ok: true }],
  [
    "empty | default | two failures",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "empty | default | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "empty | default | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "empty | default | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["empty | errors all | valid", { ok: true }],
  [
    "empty | errors all | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "empty | errors all | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "empty | errors all | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "empty | errors all | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "empty | errors all | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <e>; declared attributes: id. Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  ["empty | errors all | attribute symbol key", { ok: true }],
  ["empty | errors all | attribute non-enumerable", { ok: true }],
  ["empty | errors all | attribute inherited", { ok: true }],
  [
    "empty | errors all | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "empty | errors all | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "empty | errors all | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "empty | errors all | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "empty | errors all | child with a non-string attribute",
    {
      message:
        "<e> must be empty but contains <e>. Remove the content or declare text, element, or mixed content for <e>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "empty | errors all | child undeclared with a non-string attribute",
    {
      message:
        "<e> must be empty but contains <zz>. Remove the content or declare text, element, or mixed content for <e>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "empty | errors all | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "empty | errors all | children sparse",
    {
      message:
        'Expected ResolvedElement\n  at ["children"][0]\nExpected ResolvedElement\n  at ["children"][1]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>));Pointer[1](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "empty | errors all | wrong name",
    {
      message: 'Expected "e"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "empty | errors all | name not a string",
    {
      message: 'Expected "e"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "empty | errors all | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "empty | errors all | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "empty | errors all | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  ["empty | errors all | excess key", { ok: true }],
  [
    "empty | errors all | two failures",
    {
      message:
        'Expected string\n  at ["attributes"]["q"]\nExpected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)));Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "empty | errors all | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "empty | errors all | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "empty | errors all | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["empty | excess error | valid", { ok: true }],
  [
    "empty | excess error | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "empty | excess error | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "empty | excess error | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "empty | excess error | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "empty | excess error | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <e>; declared attributes: id. Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  [
    "empty | excess error | attribute symbol key",
    {
      message: 'Expected no excess property\n  at ["attributes"][Symbol(s)]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[Symbol(s)](UnexpectedKey<Objects>)))))",
    },
  ],
  ["empty | excess error | attribute non-enumerable", { ok: true }],
  ["empty | excess error | attribute inherited", { ok: true }],
  [
    "empty | excess error | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "empty | excess error | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "empty | excess error | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "empty | excess error | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "empty | excess error | child with a non-string attribute",
    {
      message:
        "<e> must be empty but contains <e>. Remove the content or declare text, element, or mixed content for <e>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "empty | excess error | child undeclared with a non-string attribute",
    {
      message:
        "<e> must be empty but contains <zz>. Remove the content or declare text, element, or mixed content for <e>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "empty | excess error | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "empty | excess error | children sparse",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "empty | excess error | wrong name",
    {
      message: 'Expected "e"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "empty | excess error | name not a string",
    {
      message: 'Expected "e"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "empty | excess error | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "empty | excess error | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "empty | excess error | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  [
    "empty | excess error | excess key",
    {
      message: 'Expected no excess property\n  at ["extra"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[extra](UnexpectedKey<Objects>)))",
    },
  ],
  [
    "empty | excess error | two failures",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "empty | excess error | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "empty | excess error | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "empty | excess error | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["text | default | valid", { ok: true }],
  [
    "text | default | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "text | default | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "text | default | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "text | default | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "text | default | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <t>; declared attributes: n. Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  ["text | default | attribute symbol key", { ok: true }],
  ["text | default | attribute non-enumerable", { ok: true }],
  ["text | default | attribute inherited", { ok: true }],
  [
    "text | default | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "text | default | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "text | default | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][1]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[1](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "text | default | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][1]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[1](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "text | default | child with a non-string attribute",
    {
      message:
        "<t> holds text only but contains <e>. Remove the element or declare element or mixed content for <t>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "text | default | child undeclared with a non-string attribute",
    {
      message:
        "<t> holds text only but contains <zz>. Remove the element or declare element or mixed content for <t>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "text | default | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][1]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[1](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "text | default | children sparse",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "text | default | wrong name",
    {
      message: 'Expected "t"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "text | default | name not a string",
    {
      message: 'Expected "t"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "text | default | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "text | default | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "text | default | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  ["text | default | excess key", { ok: true }],
  [
    "text | default | two failures",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "text | default | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "text | default | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "text | default | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["text | errors all | valid", { ok: true }],
  [
    "text | errors all | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "text | errors all | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "text | errors all | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "text | errors all | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "text | errors all | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <t>; declared attributes: n. Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  ["text | errors all | attribute symbol key", { ok: true }],
  ["text | errors all | attribute non-enumerable", { ok: true }],
  ["text | errors all | attribute inherited", { ok: true }],
  [
    "text | errors all | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "text | errors all | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "text | errors all | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][1]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[1](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "text | errors all | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][1]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[1](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "text | errors all | child with a non-string attribute",
    {
      message:
        "<t> holds text only but contains <e>. Remove the element or declare element or mixed content for <t>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "text | errors all | child undeclared with a non-string attribute",
    {
      message:
        "<t> holds text only but contains <zz>. Remove the element or declare element or mixed content for <t>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "text | errors all | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][1]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[1](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "text | errors all | children sparse",
    {
      message:
        'Expected ResolvedElement\n  at ["children"][0]\nExpected ResolvedElement\n  at ["children"][1]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>));Pointer[1](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "text | errors all | wrong name",
    {
      message: 'Expected "t"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "text | errors all | name not a string",
    {
      message: 'Expected "t"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "text | errors all | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "text | errors all | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "text | errors all | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  ["text | errors all | excess key", { ok: true }],
  [
    "text | errors all | two failures",
    {
      message:
        'Expected string\n  at ["attributes"]["q"]\nExpected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)));Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "text | errors all | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "text | errors all | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "text | errors all | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["text | excess error | valid", { ok: true }],
  [
    "text | excess error | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "text | excess error | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "text | excess error | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "text | excess error | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "text | excess error | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <t>; declared attributes: n. Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  [
    "text | excess error | attribute symbol key",
    {
      message: 'Expected no excess property\n  at ["attributes"][Symbol(s)]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[Symbol(s)](UnexpectedKey<Objects>)))))",
    },
  ],
  ["text | excess error | attribute non-enumerable", { ok: true }],
  ["text | excess error | attribute inherited", { ok: true }],
  [
    "text | excess error | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "text | excess error | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "text | excess error | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][1]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[1](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "text | excess error | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][1]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[1](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "text | excess error | child with a non-string attribute",
    {
      message:
        "<t> holds text only but contains <e>. Remove the element or declare element or mixed content for <t>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "text | excess error | child undeclared with a non-string attribute",
    {
      message:
        "<t> holds text only but contains <zz>. Remove the element or declare element or mixed content for <t>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "text | excess error | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][1]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[1](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "text | excess error | children sparse",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "text | excess error | wrong name",
    {
      message: 'Expected "t"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "text | excess error | name not a string",
    {
      message: 'Expected "t"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "text | excess error | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "text | excess error | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "text | excess error | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  [
    "text | excess error | excess key",
    {
      message: 'Expected no excess property\n  at ["extra"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[extra](UnexpectedKey<Objects>)))",
    },
  ],
  [
    "text | excess error | two failures",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "text | excess error | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "text | excess error | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "text | excess error | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["elements | default | valid", { ok: true }],
  [
    "elements | default | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "elements | default | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "elements | default | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "elements | default | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "elements | default | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <p>; declared attributes: id. Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  ["elements | default | attribute symbol key", { ok: true }],
  ["elements | default | attribute non-enumerable", { ok: true }],
  ["elements | default | attribute inherited", { ok: true }],
  [
    "elements | default | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "elements | default | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "elements | default | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][3]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[3](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "elements | default | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][3]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[3](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "elements | default | child with a non-string attribute",
    {
      message: 'Expected string\n  at ["e"]["attributes"]["id"]',
      tree: "Composite<Objects>(Pointer[e](Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[id](InvalidType<String>)))))))",
    },
  ],
  [
    "elements | default | child undeclared with a non-string attribute",
    {
      message:
        "<zz> is not a declared child of <p>; declared children: e, t. Remove the element or declare it as a child of <p>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "elements | default | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][3]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[3](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "elements | default | children sparse",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "elements | default | wrong name",
    {
      message: 'Expected "p"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "elements | default | name not a string",
    {
      message: 'Expected "p"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "elements | default | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "elements | default | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "elements | default | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  ["elements | default | excess key", { ok: true }],
  [
    "elements | default | two failures",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "elements | default | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "elements | default | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "elements | default | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["elements | errors all | valid", { ok: true }],
  [
    "elements | errors all | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "elements | errors all | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "elements | errors all | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "elements | errors all | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "elements | errors all | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <p>; declared attributes: id. Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  ["elements | errors all | attribute symbol key", { ok: true }],
  ["elements | errors all | attribute non-enumerable", { ok: true }],
  ["elements | errors all | attribute inherited", { ok: true }],
  [
    "elements | errors all | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "elements | errors all | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "elements | errors all | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][3]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[3](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "elements | errors all | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][3]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[3](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "elements | errors all | child with a non-string attribute",
    {
      message: 'Expected string\n  at ["e"]["attributes"]["id"]',
      tree: "Composite<Objects>(Pointer[e](Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[id](InvalidType<String>)))))))",
    },
  ],
  [
    "elements | errors all | child undeclared with a non-string attribute",
    {
      message:
        "<zz> is not a declared child of <p>; declared children: e, t. Remove the element or declare it as a child of <p>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "elements | errors all | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][3]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[3](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "elements | errors all | children sparse",
    {
      message:
        'Expected ResolvedElement\n  at ["children"][0]\nExpected ResolvedElement\n  at ["children"][1]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>));Pointer[1](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "elements | errors all | wrong name",
    {
      message: 'Expected "p"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "elements | errors all | name not a string",
    {
      message: 'Expected "p"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "elements | errors all | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "elements | errors all | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "elements | errors all | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  ["elements | errors all | excess key", { ok: true }],
  [
    "elements | errors all | two failures",
    {
      message:
        'Expected string\n  at ["attributes"]["q"]\nExpected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)));Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "elements | errors all | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "elements | errors all | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "elements | errors all | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["elements | excess error | valid", { ok: true }],
  [
    "elements | excess error | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "elements | excess error | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "elements | excess error | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "elements | excess error | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "elements | excess error | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <p>; declared attributes: id. Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  [
    "elements | excess error | attribute symbol key",
    {
      message: 'Expected no excess property\n  at ["attributes"][Symbol(s)]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[Symbol(s)](UnexpectedKey<Objects>)))))",
    },
  ],
  ["elements | excess error | attribute non-enumerable", { ok: true }],
  ["elements | excess error | attribute inherited", { ok: true }],
  [
    "elements | excess error | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "elements | excess error | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "elements | excess error | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][3]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[3](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "elements | excess error | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][3]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[3](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "elements | excess error | child with a non-string attribute",
    {
      message: 'Expected string\n  at ["e"]["attributes"]["id"]',
      tree: "Composite<Objects>(Pointer[e](Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[id](InvalidType<String>)))))))",
    },
  ],
  [
    "elements | excess error | child undeclared with a non-string attribute",
    {
      message:
        "<zz> is not a declared child of <p>; declared children: e, t. Remove the element or declare it as a child of <p>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "elements | excess error | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][3]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[3](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "elements | excess error | children sparse",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "elements | excess error | wrong name",
    {
      message: 'Expected "p"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "elements | excess error | name not a string",
    {
      message: 'Expected "p"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "elements | excess error | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "elements | excess error | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "elements | excess error | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  [
    "elements | excess error | excess key",
    {
      message: 'Expected no excess property\n  at ["extra"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[extra](UnexpectedKey<Objects>)))",
    },
  ],
  [
    "elements | excess error | two failures",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "elements | excess error | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "elements | excess error | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "elements | excess error | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["mixed | default | valid", { ok: true }],
  [
    "mixed | default | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "mixed | default | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "mixed | default | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "mixed | default | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "mixed | default | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <m>; declared attributes: (none). Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  ["mixed | default | attribute symbol key", { ok: true }],
  ["mixed | default | attribute non-enumerable", { ok: true }],
  ["mixed | default | attribute inherited", { ok: true }],
  [
    "mixed | default | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "mixed | default | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "mixed | default | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][4]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[4](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "mixed | default | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][4]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[4](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "mixed | default | child with a non-string attribute",
    {
      message: 'Expected string\n  at ["$children"][0]["attributes"]["id"]',
      tree: "Composite<Objects>(Pointer[$children](Composite<Arrays>(Pointer[0](AnyOf<Union>(Encoding<Objects>(Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[id](InvalidType<String>)))))))))))",
    },
  ],
  [
    "mixed | default | child undeclared with a non-string attribute",
    {
      message:
        'Expected string | { readonly "name": "e", ... } | { readonly "name": "t", ... }\n  at ["$children"][0]',
      tree: "Composite<Objects>(Pointer[$children](Composite<Arrays>(Pointer[0](AnyOf<Union>()))))",
    },
  ],
  [
    "mixed | default | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][4]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[4](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "mixed | default | children sparse",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "mixed | default | wrong name",
    {
      message: 'Expected "m"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "mixed | default | name not a string",
    {
      message: 'Expected "m"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "mixed | default | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "mixed | default | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "mixed | default | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  ["mixed | default | excess key", { ok: true }],
  [
    "mixed | default | two failures",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "mixed | default | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "mixed | default | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "mixed | default | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["mixed | errors all | valid", { ok: true }],
  [
    "mixed | errors all | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "mixed | errors all | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "mixed | errors all | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "mixed | errors all | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "mixed | errors all | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <m>; declared attributes: (none). Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  ["mixed | errors all | attribute symbol key", { ok: true }],
  ["mixed | errors all | attribute non-enumerable", { ok: true }],
  ["mixed | errors all | attribute inherited", { ok: true }],
  [
    "mixed | errors all | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "mixed | errors all | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "mixed | errors all | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][4]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[4](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "mixed | errors all | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][4]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[4](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "mixed | errors all | child with a non-string attribute",
    {
      message: 'Expected string\n  at ["$children"][0]["attributes"]["id"]',
      tree: "Composite<Objects>(Pointer[$children](Composite<Arrays>(Pointer[0](AnyOf<Union>(Encoding<Objects>(Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[id](InvalidType<String>)))))))))))",
    },
  ],
  [
    "mixed | errors all | child undeclared with a non-string attribute",
    {
      message:
        'Expected string | { readonly "name": "e", ... } | { readonly "name": "t", ... }\n  at ["$children"][0]',
      tree: "Composite<Objects>(Pointer[$children](Composite<Arrays>(Pointer[0](AnyOf<Union>()))))",
    },
  ],
  [
    "mixed | errors all | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][4]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[4](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "mixed | errors all | children sparse",
    {
      message:
        'Expected ResolvedElement\n  at ["children"][0]\nExpected ResolvedElement\n  at ["children"][1]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>));Pointer[1](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "mixed | errors all | wrong name",
    {
      message: 'Expected "m"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "mixed | errors all | name not a string",
    {
      message: 'Expected "m"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "mixed | errors all | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "mixed | errors all | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "mixed | errors all | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  ["mixed | errors all | excess key", { ok: true }],
  [
    "mixed | errors all | two failures",
    {
      message:
        'Expected string\n  at ["attributes"]["q"]\nExpected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)));Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "mixed | errors all | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "mixed | errors all | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "mixed | errors all | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["mixed | excess error | valid", { ok: true }],
  [
    "mixed | excess error | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "mixed | excess error | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "mixed | excess error | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "mixed | excess error | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "mixed | excess error | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <m>; declared attributes: (none). Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  [
    "mixed | excess error | attribute symbol key",
    {
      message: 'Expected no excess property\n  at ["attributes"][Symbol(s)]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[Symbol(s)](UnexpectedKey<Objects>)))))",
    },
  ],
  ["mixed | excess error | attribute non-enumerable", { ok: true }],
  ["mixed | excess error | attribute inherited", { ok: true }],
  [
    "mixed | excess error | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "mixed | excess error | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "mixed | excess error | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][4]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[4](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "mixed | excess error | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][4]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[4](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "mixed | excess error | child with a non-string attribute",
    {
      message: 'Expected string\n  at ["$children"][0]["attributes"]["id"]',
      tree: "Composite<Objects>(Pointer[$children](Composite<Arrays>(Pointer[0](AnyOf<Union>(Encoding<Objects>(Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[id](InvalidType<String>)))))))))))",
    },
  ],
  [
    "mixed | excess error | child undeclared with a non-string attribute",
    {
      message:
        'Expected string | { readonly "name": "e", ... } | { readonly "name": "t", ... }\n  at ["$children"][0]',
      tree: "Composite<Objects>(Pointer[$children](Composite<Arrays>(Pointer[0](AnyOf<Union>()))))",
    },
  ],
  [
    "mixed | excess error | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][4]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[4](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "mixed | excess error | children sparse",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "mixed | excess error | wrong name",
    {
      message: 'Expected "m"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "mixed | excess error | name not a string",
    {
      message: 'Expected "m"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "mixed | excess error | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "mixed | excess error | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "mixed | excess error | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  [
    "mixed | excess error | excess key",
    {
      message: 'Expected no excess property\n  at ["extra"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[extra](UnexpectedKey<Objects>)))",
    },
  ],
  [
    "mixed | excess error | two failures",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "mixed | excess error | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "mixed | excess error | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "mixed | excess error | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["open elements | default | valid", { ok: true }],
  [
    "open elements | default | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "open elements | default | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "open elements | default | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "open elements | default | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "open elements | default | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <oe>; declared attributes: (none). Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  ["open elements | default | attribute symbol key", { ok: true }],
  ["open elements | default | attribute non-enumerable", { ok: true }],
  ["open elements | default | attribute inherited", { ok: true }],
  [
    "open elements | default | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "open elements | default | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "open elements | default | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][2]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[2](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open elements | default | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][2]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[2](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open elements | default | child with a non-string attribute",
    {
      message: 'Expected string\n  at ["e"]["attributes"]["id"]',
      tree: "Composite<Objects>(Pointer[e](Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[id](InvalidType<String>)))))))",
    },
  ],
  ["open elements | default | child undeclared with a non-string attribute", { ok: true }],
  [
    "open elements | default | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][2]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[2](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open elements | default | children sparse",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open elements | default | wrong name",
    {
      message: 'Expected "oe"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "open elements | default | name not a string",
    {
      message: 'Expected "oe"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "open elements | default | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "open elements | default | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "open elements | default | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  ["open elements | default | excess key", { ok: true }],
  [
    "open elements | default | two failures",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "open elements | default | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "open elements | default | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "open elements | default | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["open elements | errors all | valid", { ok: true }],
  [
    "open elements | errors all | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "open elements | errors all | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "open elements | errors all | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "open elements | errors all | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "open elements | errors all | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <oe>; declared attributes: (none). Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  ["open elements | errors all | attribute symbol key", { ok: true }],
  ["open elements | errors all | attribute non-enumerable", { ok: true }],
  ["open elements | errors all | attribute inherited", { ok: true }],
  [
    "open elements | errors all | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "open elements | errors all | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "open elements | errors all | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][2]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[2](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open elements | errors all | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][2]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[2](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open elements | errors all | child with a non-string attribute",
    {
      message: 'Expected string\n  at ["e"]["attributes"]["id"]',
      tree: "Composite<Objects>(Pointer[e](Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[id](InvalidType<String>)))))))",
    },
  ],
  ["open elements | errors all | child undeclared with a non-string attribute", { ok: true }],
  [
    "open elements | errors all | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][2]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[2](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open elements | errors all | children sparse",
    {
      message:
        'Expected ResolvedElement\n  at ["children"][0]\nExpected ResolvedElement\n  at ["children"][1]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>));Pointer[1](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open elements | errors all | wrong name",
    {
      message: 'Expected "oe"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "open elements | errors all | name not a string",
    {
      message: 'Expected "oe"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "open elements | errors all | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "open elements | errors all | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "open elements | errors all | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  ["open elements | errors all | excess key", { ok: true }],
  [
    "open elements | errors all | two failures",
    {
      message:
        'Expected string\n  at ["attributes"]["q"]\nExpected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)));Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open elements | errors all | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "open elements | errors all | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "open elements | errors all | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["open elements | excess error | valid", { ok: true }],
  [
    "open elements | excess error | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "open elements | excess error | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "open elements | excess error | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "open elements | excess error | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "open elements | excess error | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <oe>; declared attributes: (none). Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  [
    "open elements | excess error | attribute symbol key",
    {
      message: 'Expected no excess property\n  at ["attributes"][Symbol(s)]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[Symbol(s)](UnexpectedKey<Objects>)))))",
    },
  ],
  ["open elements | excess error | attribute non-enumerable", { ok: true }],
  ["open elements | excess error | attribute inherited", { ok: true }],
  [
    "open elements | excess error | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "open elements | excess error | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "open elements | excess error | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][2]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[2](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open elements | excess error | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][2]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[2](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open elements | excess error | child with a non-string attribute",
    {
      message: 'Expected string\n  at ["e"]["attributes"]["id"]',
      tree: "Composite<Objects>(Pointer[e](Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[id](InvalidType<String>)))))))",
    },
  ],
  ["open elements | excess error | child undeclared with a non-string attribute", { ok: true }],
  [
    "open elements | excess error | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][2]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[2](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open elements | excess error | children sparse",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open elements | excess error | wrong name",
    {
      message: 'Expected "oe"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "open elements | excess error | name not a string",
    {
      message: 'Expected "oe"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "open elements | excess error | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "open elements | excess error | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "open elements | excess error | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  [
    "open elements | excess error | excess key",
    {
      message: 'Expected no excess property\n  at ["extra"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[extra](UnexpectedKey<Objects>)))",
    },
  ],
  [
    "open elements | excess error | two failures",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "open elements | excess error | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "open elements | excess error | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "open elements | excess error | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["open mixed | default | valid", { ok: true }],
  [
    "open mixed | default | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "open mixed | default | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "open mixed | default | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "open mixed | default | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "open mixed | default | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <om>; declared attributes: (none). Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  ["open mixed | default | attribute symbol key", { ok: true }],
  ["open mixed | default | attribute non-enumerable", { ok: true }],
  ["open mixed | default | attribute inherited", { ok: true }],
  [
    "open mixed | default | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "open mixed | default | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "open mixed | default | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][3]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[3](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open mixed | default | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][3]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[3](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open mixed | default | child with a non-string attribute",
    {
      message:
        'Expected string\n  at ["$children"][0]["attributes"]["id"]\nExpected string\n  at ["$children"][0]["attributes"]["id"]',
      tree: "Composite<Objects>(Pointer[$children](Composite<Arrays>(Pointer[0](AnyOf<Union>(Encoding<Objects>(Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[id](InvalidType<String>))))));Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[id](InvalidType<String>))))))))))",
    },
  ],
  [
    "open mixed | default | child undeclared with a non-string attribute",
    {
      message: 'Expected string\n  at ["$children"][0]["attributes"]["a"]',
      tree: "Composite<Objects>(Pointer[$children](Composite<Arrays>(Pointer[0](AnyOf<Union>(Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[a](InvalidType<String>))))))))))",
    },
  ],
  [
    "open mixed | default | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][3]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[3](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open mixed | default | children sparse",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open mixed | default | wrong name",
    {
      message: 'Expected "om"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "open mixed | default | name not a string",
    {
      message: 'Expected "om"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "open mixed | default | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "open mixed | default | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "open mixed | default | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  ["open mixed | default | excess key", { ok: true }],
  [
    "open mixed | default | two failures",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "open mixed | default | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "open mixed | default | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "open mixed | default | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["open mixed | errors all | valid", { ok: true }],
  [
    "open mixed | errors all | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "open mixed | errors all | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "open mixed | errors all | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "open mixed | errors all | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "open mixed | errors all | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <om>; declared attributes: (none). Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  ["open mixed | errors all | attribute symbol key", { ok: true }],
  ["open mixed | errors all | attribute non-enumerable", { ok: true }],
  ["open mixed | errors all | attribute inherited", { ok: true }],
  [
    "open mixed | errors all | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "open mixed | errors all | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "open mixed | errors all | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][3]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[3](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open mixed | errors all | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][3]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[3](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open mixed | errors all | child with a non-string attribute",
    {
      message:
        'Expected string\n  at ["$children"][0]["attributes"]["id"]\nExpected string\n  at ["$children"][0]["attributes"]["id"]\n<e> is a declared member of <om>, so the open member does not admit it. Repair the <e> element so its member decodes it, or tag the item "e" instead of "*".\n  at ["$children"][0]["name"]',
      tree: "Composite<Objects>(Pointer[$children](Composite<Arrays>(Pointer[0](AnyOf<Union>(Encoding<Objects>(Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[id](InvalidType<String>))))));Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[id](InvalidType<String>)));Pointer[name](Composite<String>(Filter(InvalidValue))))))))))",
    },
  ],
  [
    "open mixed | errors all | child undeclared with a non-string attribute",
    {
      message: 'Expected string\n  at ["$children"][0]["attributes"]["a"]',
      tree: "Composite<Objects>(Pointer[$children](Composite<Arrays>(Pointer[0](AnyOf<Union>(Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[a](InvalidType<String>))))))))))",
    },
  ],
  [
    "open mixed | errors all | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][3]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[3](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open mixed | errors all | children sparse",
    {
      message:
        'Expected ResolvedElement\n  at ["children"][0]\nExpected ResolvedElement\n  at ["children"][1]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>));Pointer[1](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open mixed | errors all | wrong name",
    {
      message: 'Expected "om"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "open mixed | errors all | name not a string",
    {
      message: 'Expected "om"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "open mixed | errors all | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "open mixed | errors all | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "open mixed | errors all | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  ["open mixed | errors all | excess key", { ok: true }],
  [
    "open mixed | errors all | two failures",
    {
      message:
        'Expected string\n  at ["attributes"]["q"]\nExpected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)));Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open mixed | errors all | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "open mixed | errors all | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "open mixed | errors all | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["open mixed | excess error | valid", { ok: true }],
  [
    "open mixed | excess error | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "open mixed | excess error | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "open mixed | excess error | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "open mixed | excess error | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "open mixed | excess error | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <om>; declared attributes: (none). Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  [
    "open mixed | excess error | attribute symbol key",
    {
      message: 'Expected no excess property\n  at ["attributes"][Symbol(s)]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[Symbol(s)](UnexpectedKey<Objects>)))))",
    },
  ],
  ["open mixed | excess error | attribute non-enumerable", { ok: true }],
  ["open mixed | excess error | attribute inherited", { ok: true }],
  [
    "open mixed | excess error | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "open mixed | excess error | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "open mixed | excess error | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][3]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[3](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open mixed | excess error | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][3]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[3](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open mixed | excess error | child with a non-string attribute",
    {
      message:
        'Expected string\n  at ["$children"][0]["attributes"]["id"]\nExpected string\n  at ["$children"][0]["attributes"]["id"]',
      tree: "Composite<Objects>(Pointer[$children](Composite<Arrays>(Pointer[0](AnyOf<Union>(Encoding<Objects>(Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[id](InvalidType<String>))))));Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[id](InvalidType<String>))))))))))",
    },
  ],
  [
    "open mixed | excess error | child undeclared with a non-string attribute",
    {
      message: 'Expected string\n  at ["$children"][0]["attributes"]["a"]',
      tree: "Composite<Objects>(Pointer[$children](Composite<Arrays>(Pointer[0](AnyOf<Union>(Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[a](InvalidType<String>))))))))))",
    },
  ],
  [
    "open mixed | excess error | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][3]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[3](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open mixed | excess error | children sparse",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "open mixed | excess error | wrong name",
    {
      message: 'Expected "om"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "open mixed | excess error | name not a string",
    {
      message: 'Expected "om"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "open mixed | excess error | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "open mixed | excess error | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "open mixed | excess error | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  [
    "open mixed | excess error | excess key",
    {
      message: 'Expected no excess property\n  at ["extra"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[extra](UnexpectedKey<Objects>)))",
    },
  ],
  [
    "open mixed | excess error | two failures",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "open mixed | excess error | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "open mixed | excess error | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "open mixed | excess error | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["data | default | valid", { ok: true }],
  [
    "data | default | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "data | default | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "data | default | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "data | default | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "data | default | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <d>; declared attributes: id, data-*. Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  ["data | default | attribute symbol key", { ok: true }],
  ["data | default | attribute non-enumerable", { ok: true }],
  ["data | default | attribute inherited", { ok: true }],
  [
    "data | default | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "data | default | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "data | default | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "data | default | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "data | default | child with a non-string attribute",
    {
      message:
        "<d> must be empty but contains <e>. Remove the content or declare text, element, or mixed content for <d>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "data | default | child undeclared with a non-string attribute",
    {
      message:
        "<d> must be empty but contains <zz>. Remove the content or declare text, element, or mixed content for <d>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "data | default | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "data | default | children sparse",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "data | default | wrong name",
    {
      message: 'Expected "d"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "data | default | name not a string",
    {
      message: 'Expected "d"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "data | default | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "data | default | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "data | default | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  ["data | default | excess key", { ok: true }],
  [
    "data | default | two failures",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "data | default | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "data | default | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "data | default | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["data | errors all | valid", { ok: true }],
  [
    "data | errors all | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "data | errors all | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "data | errors all | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "data | errors all | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "data | errors all | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <d>; declared attributes: id, data-*. Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  ["data | errors all | attribute symbol key", { ok: true }],
  ["data | errors all | attribute non-enumerable", { ok: true }],
  ["data | errors all | attribute inherited", { ok: true }],
  [
    "data | errors all | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "data | errors all | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "data | errors all | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "data | errors all | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "data | errors all | child with a non-string attribute",
    {
      message:
        "<d> must be empty but contains <e>. Remove the content or declare text, element, or mixed content for <d>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "data | errors all | child undeclared with a non-string attribute",
    {
      message:
        "<d> must be empty but contains <zz>. Remove the content or declare text, element, or mixed content for <d>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "data | errors all | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "data | errors all | children sparse",
    {
      message:
        'Expected ResolvedElement\n  at ["children"][0]\nExpected ResolvedElement\n  at ["children"][1]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>));Pointer[1](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "data | errors all | wrong name",
    {
      message: 'Expected "d"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "data | errors all | name not a string",
    {
      message: 'Expected "d"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "data | errors all | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "data | errors all | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "data | errors all | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  ["data | errors all | excess key", { ok: true }],
  [
    "data | errors all | two failures",
    {
      message:
        'Expected string\n  at ["attributes"]["q"]\nExpected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)));Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "data | errors all | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "data | errors all | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "data | errors all | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  ["data | excess error | valid", { ok: true }],
  [
    "data | excess error | attributes not an object",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "data | excess error | attributes null",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "data | excess error | attributes an array",
    {
      message: 'Expected object\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](InvalidType<Objects>)))",
    },
  ],
  [
    "data | excess error | attribute value not a string",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "data | excess error | attribute __proto__",
    {
      message:
        'Attribute "__proto__" is not declared on <d>; declared attributes: id, data-*. Remove the attribute or declare it on the element.\n  at ["@__proto__"]',
      tree: "Encoding<Objects>(Pointer[@__proto__](InvalidValue))",
    },
  ],
  [
    "data | excess error | attribute symbol key",
    {
      message: 'Expected no excess property\n  at ["attributes"][Symbol(s)]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[Symbol(s)](UnexpectedKey<Objects>)))))",
    },
  ],
  ["data | excess error | attribute non-enumerable", { ok: true }],
  ["data | excess error | attribute inherited", { ok: true }],
  [
    "data | excess error | children not an array",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "data | excess error | children an object",
    {
      message: 'Expected array\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](InvalidType<Arrays>)))",
    },
  ],
  [
    "data | excess error | child a number",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "data | excess error | child without name",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "data | excess error | child with a non-string attribute",
    {
      message:
        "<d> must be empty but contains <e>. Remove the content or declare text, element, or mixed content for <d>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "data | excess error | child undeclared with a non-string attribute",
    {
      message:
        "<d> must be empty but contains <zz>. Remove the content or declare text, element, or mixed content for <d>.",
      tree: "Encoding<Objects>(Pointer[](InvalidValue))",
    },
  ],
  [
    "data | excess error | child undefined",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "data | excess error | children sparse",
    {
      message: 'Expected ResolvedElement\n  at ["children"][0]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](Composite<Arrays>(Pointer[0](AnyOf<Union>(InvalidType<Declaration>))))))",
    },
  ],
  [
    "data | excess error | wrong name",
    {
      message: 'Expected "d"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "data | excess error | name not a string",
    {
      message: 'Expected "d"\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](InvalidType<Literal>)))",
    },
  ],
  [
    "data | excess error | missing attributes",
    {
      message: 'Missing key\n  at ["attributes"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](MissingKey)))",
    },
  ],
  [
    "data | excess error | missing children",
    {
      message: 'Missing key\n  at ["children"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[children](MissingKey)))",
    },
  ],
  [
    "data | excess error | missing name",
    {
      message: 'Missing key\n  at ["name"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[name](MissingKey)))",
    },
  ],
  [
    "data | excess error | excess key",
    {
      message: 'Expected no excess property\n  at ["extra"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[extra](UnexpectedKey<Objects>)))",
    },
  ],
  [
    "data | excess error | two failures",
    {
      message: 'Expected string\n  at ["attributes"]["q"]',
      tree: "Encoding<Objects>(Composite<Objects>(Pointer[attributes](Composite<Objects>(Pointer[q](InvalidType<String>)))))",
    },
  ],
  [
    "data | excess error | not an object",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "data | excess error | null",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
  [
    "data | excess error | an array",
    { message: "Expected object", tree: "Encoding<Objects>(InvalidType<Objects>)" },
  ],
]);

/**
 * The `fromString` outcomes captured from the same codec, keyed by document.
 */
const DOCUMENT = new Map<string, DocumentOutcome>([
  [
    "valid",
    {
      value: {
        d: { "data-k": 6, id: "5" },
        e: [{ id: "1" }, { id: "2" }],
        m: {
          $children: [
            { _tag: "$text", text: "a" },
            { _tag: "e", value: { id: "4" } },
          ],
        },
        v: { $text: 3 },
      },
    },
  ],
  [
    "undeclared attribute",
    {
      _tag: "XmlDecodeError",
      message:
        'attribute bad="x" at /r/e/@bad (line 2, column 3): Attribute "bad" is not declared on <e>; declared attributes: id. Remove the attribute or declare it on the element.',
      path: "/r/e/@bad",
      position: { column: 3, line: 2 },
      reason: "SchemaFailure",
    },
  ],
  [
    "undeclared child",
    {
      _tag: "XmlDecodeError",
      message:
        "element r at /r (line 1, column 1): <zz> is not a declared child of <r>; declared children: d, e, m, om, v. Remove the element or declare it as a child of <r>.",
      path: "/r",
      position: { column: 1, line: 1 },
      reason: "SchemaFailure",
    },
  ],
  [
    "text value rejected",
    {
      _tag: "XmlDecodeError",
      message:
        "element v at /r/v (line 2, column 3): Expected a string representing a finite number; change the element to match its definition",
      path: "/r/v",
      position: { column: 3, line: 2 },
      reason: "SchemaFailure",
    },
  ],
  [
    "mixed member",
    {
      _tag: "XmlDecodeError",
      message:
        'attribute q="2" at /r/m/e/@q (line 2, column 9): Attribute "q" is not declared on <e>; declared attributes: id. Remove the attribute or declare it on the element.',
      path: "/r/m/e/@q",
      position: { column: 9, line: 2 },
      reason: "SchemaFailure",
    },
  ],
  [
    "open mixed member",
    {
      _tag: "XmlDecodeError",
      message:
        'attribute q="2" at /r/om/e/@q (line 2, column 8): Attribute "q" is not declared on <e>; declared attributes: id. Remove the attribute or declare it on the element.',
      path: "/r/om/e/@q",
      position: { column: 8, line: 2 },
      reason: "SchemaFailure",
    },
  ],
  [
    "data value rejected",
    {
      _tag: "XmlDecodeError",
      message:
        'attribute data-k="x" at /r/d/@data-k (line 2, column 3): Expected a string representing a finite number; change or remove data-k so it meets this expectation',
      path: "/r/d/@data-k",
      position: { column: 3, line: 2 },
      reason: "SchemaFailure",
    },
  ],
]);

/**
 * The channel outcomes captured from the same codec, keyed by `positions` and document; the
 * `decodeSchema` outcome equals the `decodeSchemaString` one.
 */
const CHANNEL = new Map<string, ChannelOutcome>([
  [
    "positions false | valid",
    {
      records: [
        {
          d: { "data-k": 6, id: "5" },
          e: [{ id: "1" }, { id: "2" }],
          m: {
            $children: [
              { _tag: "$text", text: "a" },
              { _tag: "e", value: { id: "4" } },
            ],
          },
          v: { $text: 3 },
        },
      ],
    },
  ],
  [
    "positions false | undeclared attribute",
    {
      _tag: "XmlDecodeError",
      message:
        'attribute bad="x" at /r/e/@bad of record 1: Attribute "bad" is not declared on <e>; declared attributes: id. Remove the attribute or declare it on the element.',
      path: "/r/e/@bad",
      position: "none",
      reason: "SchemaFailure",
    },
  ],
  [
    "positions false | undeclared child",
    {
      _tag: "XmlDecodeError",
      message:
        "element r at /r of record 1: <zz> is not a declared child of <r>; declared children: d, e, m, om, v. Remove the element or declare it as a child of <r>.",
      path: "/r",
      position: "none",
      reason: "SchemaFailure",
    },
  ],
  [
    "positions false | text value rejected",
    {
      _tag: "XmlDecodeError",
      message:
        "element v at /r/v of record 1: Expected a string representing a finite number; change the element to match its definition",
      path: "/r/v",
      position: "none",
      reason: "SchemaFailure",
    },
  ],
  [
    "positions false | mixed member",
    {
      _tag: "XmlDecodeError",
      message:
        'attribute q="2" at /r/m/e/@q of record 1: Attribute "q" is not declared on <e>; declared attributes: id. Remove the attribute or declare it on the element.',
      path: "/r/m/e/@q",
      position: "none",
      reason: "SchemaFailure",
    },
  ],
  [
    "positions false | open mixed member",
    {
      _tag: "XmlDecodeError",
      message:
        'attribute q="2" at /r/om/e/@q of record 1: Attribute "q" is not declared on <e>; declared attributes: id. Remove the attribute or declare it on the element.',
      path: "/r/om/e/@q",
      position: "none",
      reason: "SchemaFailure",
    },
  ],
  [
    "positions false | data value rejected",
    {
      _tag: "XmlDecodeError",
      message:
        'attribute data-k="x" at /r/d/@data-k of record 1: Expected a string representing a finite number; change or remove data-k so it meets this expectation',
      path: "/r/d/@data-k",
      position: "none",
      reason: "SchemaFailure",
    },
  ],
  [
    "positions true | valid",
    {
      records: [
        {
          d: { "data-k": 6, id: "5" },
          e: [{ id: "1" }, { id: "2" }],
          m: {
            $children: [
              { _tag: "$text", text: "a" },
              { _tag: "e", value: { id: "4" } },
            ],
          },
          v: { $text: 3 },
        },
      ],
    },
  ],
  [
    "positions true | undeclared attribute",
    {
      _tag: "XmlDecodeError",
      message:
        'attribute bad="x" at /r/e/@bad of record 1 (line 2, column 3): Attribute "bad" is not declared on <e>; declared attributes: id. Remove the attribute or declare it on the element.',
      path: "/r/e/@bad",
      position: { column: 3, line: 2 },
      reason: "SchemaFailure",
    },
  ],
  [
    "positions true | undeclared child",
    {
      _tag: "XmlDecodeError",
      message:
        "element r at /r of record 1 (line 1, column 1): <zz> is not a declared child of <r>; declared children: d, e, m, om, v. Remove the element or declare it as a child of <r>.",
      path: "/r",
      position: { column: 1, line: 1 },
      reason: "SchemaFailure",
    },
  ],
  [
    "positions true | text value rejected",
    {
      _tag: "XmlDecodeError",
      message:
        "element v at /r/v of record 1 (line 2, column 3): Expected a string representing a finite number; change the element to match its definition",
      path: "/r/v",
      position: { column: 3, line: 2 },
      reason: "SchemaFailure",
    },
  ],
  [
    "positions true | mixed member",
    {
      _tag: "XmlDecodeError",
      message:
        'attribute q="2" at /r/m/e/@q of record 1 (line 2, column 9): Attribute "q" is not declared on <e>; declared attributes: id. Remove the attribute or declare it on the element.',
      path: "/r/m/e/@q",
      position: { column: 9, line: 2 },
      reason: "SchemaFailure",
    },
  ],
  [
    "positions true | open mixed member",
    {
      _tag: "XmlDecodeError",
      message:
        'attribute q="2" at /r/om/e/@q of record 1 (line 2, column 8): Attribute "q" is not declared on <e>; declared attributes: id. Remove the attribute or declare it on the element.',
      path: "/r/om/e/@q",
      position: { column: 8, line: 2 },
      reason: "SchemaFailure",
    },
  ],
  [
    "positions true | data value rejected",
    {
      _tag: "XmlDecodeError",
      message:
        'attribute data-k="x" at /r/d/@data-k of record 1 (line 2, column 3): Expected a string representing a finite number; change or remove data-k so it meets this expectation',
      path: "/r/d/@data-k",
      position: { column: 3, line: 2 },
      reason: "SchemaFailure",
    },
  ],
]);

/**
 * Compare an observed outcome with the outcome captured for its case.
 *
 * @param expected - The captured outcomes of one surface.
 * @param key - The case key within the surface.
 * @param observed - The observed outcome.
 */
const check = <A>(expected: ReadonlyMap<string, A>, key: string, observed: A) => {
  expect(expected.has(key)).toBe(true);
  expect(observed).toStrictEqual(expected.get(key));
};

describe("wire fast path: direct element codecs", () => {
  for (const { base, codec, label } of codecs) {
    it.effect(`${label}: every variant decodes as captured`, () =>
      Effect.gen(function* run() {
        for (const [options, parseOptions] of optionSets) {
          for (const [variant, input] of variants(base)) {
            const exit = Schema.decodeUnknownExit(codec)(input, parseOptions);

            const effect = yield* Effect.exit(
              Schema.decodeUnknownEffect(codec)(input, parseOptions),
            );

            check(DIRECT, `${label} | ${options} | ${variant}`, outcomeOf(exit));
            expect(outcomeOf(effect)).toStrictEqual(outcomeOf(exit));
          }
        }
      }),
    );

    it.effect(`${label}: the decoded valid value encodes back to its input`, () =>
      Effect.gen(function* run() {
        const decoded = yield* Schema.decodeUnknownEffect(codec)(base);

        expect(Schema.encodeUnknownExit(codec)(decoded)).toStrictEqual(Exit.succeed(base));
      }),
    );
  }
});

/**
 * The documents of the `fromString` and channel cases.
 */
const documents = [
  ["valid", '<r><e id="1"/><e id="2"/><v>3</v><m>a<e id="4"/></m><d id="5" data-k="6"/></r>'],
  ["undeclared attribute", '<r>\n  <e id="1" bad="x"/>\n</r>'],
  ["undeclared child", '<r>\n  <e id="1"/>\n  <zz/>\n</r>'],
  ["text value rejected", "<r>\n  <v>abc</v>\n</r>"],
  ["mixed member", '<r>\n  <m>hi <e id="1" q="2"/></m>\n</r>'],
  ["open mixed member", '<r>\n  <om>x<e q="2"/><zz/></om>\n</r>'],
  ["data value rejected", '<r>\n  <d id="1" data-k="x"/>\n</r>'],
] as const;

describe("wire fast path: whole documents", () => {
  for (const [label, xml] of documents) {
    it.effect(`fromString: ${label}`, () =>
      Effect.gen(function* run() {
        const exit = yield* Effect.exit(Schema.decodeUnknownEffect(XmlSchema.fromString(R))(xml));

        const observed = Exit.match(exit, {
          onFailure: (cause): DocumentOutcome => {
            const failure = cause.reasons.find((reason) => reason._tag === "Fail");

            const error =
              failure === undefined
                ? Option.none()
                : XmlSchema.findDecodeErrorOption(failure.error.issue);

            return Option.match(error, {
              onNone: (): DocumentOutcome => "no decode error",
              onSome: errorOf,
            });
          },
          onSuccess: (value): DocumentOutcome => ({ value }),
        });

        check(DOCUMENT, label, observed);
      }),
    );
  }
});

/**
 * Summarize a channel decode exit.
 *
 * @param exit - The exit of collecting the channel's records.
 * @returns The outcome.
 */
const channelOutcomeOf = (
  exit: Exit.Exit<readonly (typeof R)["Type"][], XmlSchema.DecodeError>,
): ChannelOutcome =>
  Exit.match(exit, {
    onFailure: (cause): ChannelOutcome => {
      const failure = cause.reasons.find((reason) => reason._tag === "Fail");

      return failure === undefined ? "defect" : errorOf(failure.error);
    },
    onSuccess: (records): ChannelOutcome => ({ records }),
  });

describe("wire fast path: channels", () => {
  for (const positions of [false, true]) {
    for (const [label, xml] of documents) {
      it.effect(`decodeSchemaString and decodeSchema, positions ${positions}: ${label}`, () =>
        Effect.gen(function* run() {
          const text = yield* Effect.exit(
            Stream.runCollect(
              Stream.make(xml).pipe(
                Stream.pipeThroughChannel(XmlSchema.decodeSchemaString(R, ["r"])({ positions })),
              ),
            ),
          );

          const bytes = yield* Effect.exit(
            Stream.runCollect(
              Stream.make(new TextEncoder().encode(xml)).pipe(
                Stream.pipeThroughChannel(XmlSchema.decodeSchema(R, ["r"])({ positions })),
              ),
            ),
          );

          check(CHANNEL, `positions ${positions} | ${label}`, channelOutcomeOf(text));
          expect(channelOutcomeOf(bytes)).toStrictEqual(channelOutcomeOf(text));
        }),
      );
    }
  }
});

/**
 * Derive an arbitrary for an encoded side: the message of the derivation's failure, or
 * `"derived"` when it succeeds.
 *
 * @param encoded - The encoded side of an element codec.
 * @returns The derivation's outcome.
 */
const arbitraryOf = (encoded: Schema.Top): string =>
  Exit.match(
    Effect.runSyncExit(
      Effect.try({
        catch: (error) => (Predicate.isError(error) ? error.message : String(error)),
        try: () => Arbitrary.schema(encoded),
      }),
    ),
    {
      onFailure: (cause) =>
        String(
          cause.reasons.map((reason) => (reason._tag === "Fail" ? reason.error : reason._tag)),
        ),
      onSuccess: () => "derived",
    },
  );

/**
 * Run every derivation `Schema` offers for an element codec and its encoded side, on the codec's
 * valid value where a derivation takes a value.
 *
 * @param codec - The element codec.
 * @param base - The codec's valid hand-built value.
 * @returns Each derivation's output, keyed by derivation and read as JSON, so a captured literal
 *   compares against it: symbol keys, functions, and `undefined` fields drop out.
 */
const derivationsOf = (
  codec: Schema.Top,
  base: { readonly attributes: Attributes; readonly children: readonly unknown[] },
) => {
  const encoded = Schema.toEncoded(codec);
  const equivalent = Schema.toEquivalence(encoded);
  const format = Schema.toFormatter(encoded);
  const standard = Schema.toStandardJSONSchemaV1(codec)["~standard"].jsonSchema;

  const derivations = {
    arbitrary: arbitraryOf(encoded),
    codecJson: Schema.toRepresentation(Schema.toCodecJson(encoded)),
    encodedJsonSchema: Schema.toJsonSchemaDocument(encoded),
    encodedRepresentation: Schema.toRepresentation(encoded),
    equivalence: [
      equivalent(base, structuredClone(base)),
      equivalent(base, { ...base, children: [...base.children, "q"] }),
      equivalent(base, { ...base, attributes: { ...base.attributes, zz: "1" } }),
    ],
    formatted: [format(base), format({ ...base, attributes: { id: 1 }, children: [1, "x"] })],
    jsonSchema: Schema.toJsonSchemaDocument(codec),
    representation: Schema.toRepresentation(codec),
    standardInput: standard.input({ target: "draft-2020-12" }),
    standardOutput: standard.output({ target: "draft-2020-12" }),
  };

  return Schema.decodeSync(Schema.fromJsonString(Schema.Json))(JSON.stringify(derivations));
};

/**
 * The derivations of each direct codec, captured from the codec whose encoded side is a
 * `Schema.Struct` of `Schema.Record` and `Schema.Array`.
 */
const DERIVATIONS = new Map<string, Schema.Json>([
  [
    "empty",
    {
      arbitrary:
        'Unable to derive an arbitrary for an unsupported Declaration\n  at ["children"][0]',
      codecJson: {
        references: {
          ResolvedElementEncoded: {
            _tag: "Declaration",
            annotations: { expected: "JSON value", "~identifier": "ResolvedElement" },
            checks: [],
            representation: { id: "effect/schema/Json", payload: null },
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElementEncoded", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "e" },
            },
          ],
        },
      },
      encodedJsonSchema: {
        definitions: { ResolvedElementEncoded: {} },
        dialect: "draft-2020-12",
        schema: {
          additionalProperties: true,
          properties: {
            attributes: { additionalProperties: { type: "string" }, type: "object" },
            children: {
              items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
              type: "array",
            },
            name: { enum: ["e"], type: "string" },
          },
          required: ["attributes", "children", "name"],
          type: "object",
        },
      },
      encodedRepresentation: {
        references: {
          ResolvedElement: {
            _tag: "Declaration",
            annotations: { identifier: "ResolvedElement" },
            checks: [],
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElement", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "e" },
            },
          ],
        },
      },
      equivalence: [true, false, false],
      formatted: [
        '{ "attributes": { "id": "1" }, "children": [], "name": "e" }',
        '{ "attributes": { "id": 1 }, "children": [1, "x"], "name": "e" }',
      ],
      jsonSchema: {
        definitions: { ResolvedElementEncoded: {} },
        dialect: "draft-2020-12",
        schema: {
          additionalProperties: true,
          properties: {
            attributes: { additionalProperties: { type: "string" }, type: "object" },
            children: {
              items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
              type: "array",
            },
            name: { enum: ["e"], type: "string" },
          },
          required: ["attributes", "children", "name"],
          type: "object",
        },
      },
      representation: {
        references: {
          ResolvedElement: {
            _tag: "Declaration",
            annotations: { identifier: "ResolvedElement" },
            checks: [],
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElement", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "e" },
            },
          ],
        },
      },
      standardInput: {
        $defs: { ResolvedElementEncoded: {} },
        $schema: "https://json-schema.org/draft/2020-12/schema",
        additionalProperties: true,
        properties: {
          attributes: { additionalProperties: { type: "string" }, type: "object" },
          children: {
            items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
            type: "array",
          },
          name: { enum: ["e"], type: "string" },
        },
        required: ["attributes", "children", "name"],
        type: "object",
      },
      standardOutput: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        additionalProperties: true,
        properties: { id: { type: "string" } },
        required: ["id"],
        type: "object",
      },
    },
  ],
  [
    "text",
    {
      arbitrary:
        'Unable to derive an arbitrary for an unsupported Declaration\n  at ["children"][0]',
      codecJson: {
        references: {
          ResolvedElementEncoded: {
            _tag: "Declaration",
            annotations: { expected: "JSON value", "~identifier": "ResolvedElement" },
            checks: [],
            representation: { id: "effect/schema/Json", payload: null },
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElementEncoded", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "t" },
            },
          ],
        },
      },
      encodedJsonSchema: {
        definitions: { ResolvedElementEncoded: {} },
        dialect: "draft-2020-12",
        schema: {
          additionalProperties: true,
          properties: {
            attributes: { additionalProperties: { type: "string" }, type: "object" },
            children: {
              items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
              type: "array",
            },
            name: { enum: ["t"], type: "string" },
          },
          required: ["attributes", "children", "name"],
          type: "object",
        },
      },
      encodedRepresentation: {
        references: {
          ResolvedElement: {
            _tag: "Declaration",
            annotations: { identifier: "ResolvedElement" },
            checks: [],
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElement", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "t" },
            },
          ],
        },
      },
      equivalence: [true, false, false],
      formatted: [
        '{ "attributes": { "n": "a" }, "children": ["hi"], "name": "t" }',
        '{ "attributes": { "id": 1 }, "children": [1, "x"], "name": "t" }',
      ],
      jsonSchema: {
        definitions: { ResolvedElementEncoded: {} },
        dialect: "draft-2020-12",
        schema: {
          additionalProperties: true,
          properties: {
            attributes: { additionalProperties: { type: "string" }, type: "object" },
            children: {
              items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
              type: "array",
            },
            name: { enum: ["t"], type: "string" },
          },
          required: ["attributes", "children", "name"],
          type: "object",
        },
      },
      representation: {
        references: {
          ResolvedElement: {
            _tag: "Declaration",
            annotations: { identifier: "ResolvedElement" },
            checks: [],
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElement", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "t" },
            },
          ],
        },
      },
      standardInput: {
        $defs: { ResolvedElementEncoded: {} },
        $schema: "https://json-schema.org/draft/2020-12/schema",
        additionalProperties: true,
        properties: {
          attributes: { additionalProperties: { type: "string" }, type: "object" },
          children: {
            items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
            type: "array",
          },
          name: { enum: ["t"], type: "string" },
        },
        required: ["attributes", "children", "name"],
        type: "object",
      },
      standardOutput: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        additionalProperties: true,
        properties: { $text: { type: "string" }, n: { type: "string" } },
        required: ["$text"],
        type: "object",
      },
    },
  ],
  [
    "elements",
    {
      arbitrary:
        'Unable to derive an arbitrary for an unsupported Declaration\n  at ["children"][0]',
      codecJson: {
        references: {
          ResolvedElementEncoded: {
            _tag: "Declaration",
            annotations: { expected: "JSON value", "~identifier": "ResolvedElement" },
            checks: [],
            representation: { id: "effect/schema/Json", payload: null },
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElementEncoded", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "p" },
            },
          ],
        },
      },
      encodedJsonSchema: {
        definitions: { ResolvedElementEncoded: {} },
        dialect: "draft-2020-12",
        schema: {
          additionalProperties: true,
          properties: {
            attributes: { additionalProperties: { type: "string" }, type: "object" },
            children: {
              items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
              type: "array",
            },
            name: { enum: ["p"], type: "string" },
          },
          required: ["attributes", "children", "name"],
          type: "object",
        },
      },
      encodedRepresentation: {
        references: {
          ResolvedElement: {
            _tag: "Declaration",
            annotations: { identifier: "ResolvedElement" },
            checks: [],
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElement", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "p" },
            },
          ],
        },
      },
      equivalence: [true, false, false],
      formatted: [
        '{ "attributes": { "id": "p1" }, "children": [{"attributes":{"id":"1"},"children":[],"name":"e"}, {"attributes":{},"children":["x"],"name":"t"}, {"attributes":{},"children":[],"name":"t"}], "name": "p" }',
        '{ "attributes": { "id": 1 }, "children": [1, "x"], "name": "p" }',
      ],
      jsonSchema: {
        definitions: { ResolvedElementEncoded: {} },
        dialect: "draft-2020-12",
        schema: {
          additionalProperties: true,
          properties: {
            attributes: { additionalProperties: { type: "string" }, type: "object" },
            children: {
              items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
              type: "array",
            },
            name: { enum: ["p"], type: "string" },
          },
          required: ["attributes", "children", "name"],
          type: "object",
        },
      },
      representation: {
        references: {
          ResolvedElement: {
            _tag: "Declaration",
            annotations: { identifier: "ResolvedElement" },
            checks: [],
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElement", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "p" },
            },
          ],
        },
      },
      standardInput: {
        $defs: { ResolvedElementEncoded: {} },
        $schema: "https://json-schema.org/draft/2020-12/schema",
        additionalProperties: true,
        properties: {
          attributes: { additionalProperties: { type: "string" }, type: "object" },
          children: {
            items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
            type: "array",
          },
          name: { enum: ["p"], type: "string" },
        },
        required: ["attributes", "children", "name"],
        type: "object",
      },
      standardOutput: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        additionalProperties: true,
        properties: {
          e: {
            additionalProperties: true,
            properties: { id: { type: "string" } },
            required: ["id"],
            type: "object",
          },
          id: { type: "string" },
          items: {
            items: {
              additionalProperties: true,
              properties: { $text: { type: "string" }, n: { type: "string" } },
              required: ["$text"],
              type: "object",
            },
            type: "array",
          },
        },
        required: ["id", "e", "items"],
        type: "object",
      },
    },
  ],
  [
    "mixed",
    {
      arbitrary:
        'Unable to derive an arbitrary for an unsupported Declaration\n  at ["children"][0]',
      codecJson: {
        references: {
          ResolvedElementEncoded: {
            _tag: "Declaration",
            annotations: { expected: "JSON value", "~identifier": "ResolvedElement" },
            checks: [],
            representation: { id: "effect/schema/Json", payload: null },
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElementEncoded", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "m" },
            },
          ],
        },
      },
      encodedJsonSchema: {
        definitions: { ResolvedElementEncoded: {} },
        dialect: "draft-2020-12",
        schema: {
          additionalProperties: true,
          properties: {
            attributes: { additionalProperties: { type: "string" }, type: "object" },
            children: {
              items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
              type: "array",
            },
            name: { enum: ["m"], type: "string" },
          },
          required: ["attributes", "children", "name"],
          type: "object",
        },
      },
      encodedRepresentation: {
        references: {
          ResolvedElement: {
            _tag: "Declaration",
            annotations: { identifier: "ResolvedElement" },
            checks: [],
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElement", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "m" },
            },
          ],
        },
      },
      equivalence: [true, false, false],
      formatted: [
        '{ "attributes": {}, "children": ["a", {"attributes":{"id":"1"},"children":[],"name":"e"}, " b ", {"attributes":{"n":"z"},"children":["y"],"name":"t"}], "name": "m" }',
        '{ "attributes": { "id": 1 }, "children": [1, "x"], "name": "m" }',
      ],
      jsonSchema: {
        definitions: { ResolvedElementEncoded: {} },
        dialect: "draft-2020-12",
        schema: {
          additionalProperties: true,
          properties: {
            attributes: { additionalProperties: { type: "string" }, type: "object" },
            children: {
              items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
              type: "array",
            },
            name: { enum: ["m"], type: "string" },
          },
          required: ["attributes", "children", "name"],
          type: "object",
        },
      },
      representation: {
        references: {
          ResolvedElement: {
            _tag: "Declaration",
            annotations: { identifier: "ResolvedElement" },
            checks: [],
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElement", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "m" },
            },
          ],
        },
      },
      standardInput: {
        $defs: { ResolvedElementEncoded: {} },
        $schema: "https://json-schema.org/draft/2020-12/schema",
        additionalProperties: true,
        properties: {
          attributes: { additionalProperties: { type: "string" }, type: "object" },
          children: {
            items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
            type: "array",
          },
          name: { enum: ["m"], type: "string" },
        },
        required: ["attributes", "children", "name"],
        type: "object",
      },
      standardOutput: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        additionalProperties: true,
        properties: {
          $children: {
            items: {
              anyOf: [
                {
                  additionalProperties: true,
                  properties: {
                    _tag: { enum: ["$text"], type: "string" },
                    text: { type: "string" },
                  },
                  required: ["_tag", "text"],
                  type: "object",
                },
                {
                  additionalProperties: true,
                  properties: {
                    _tag: { enum: ["e"], type: "string" },
                    value: {
                      additionalProperties: true,
                      properties: { id: { type: "string" } },
                      required: ["id"],
                      type: "object",
                    },
                  },
                  required: ["value", "_tag"],
                  type: "object",
                },
                {
                  additionalProperties: true,
                  properties: {
                    _tag: { enum: ["t"], type: "string" },
                    value: {
                      additionalProperties: true,
                      properties: { $text: { type: "string" }, n: { type: "string" } },
                      required: ["$text"],
                      type: "object",
                    },
                  },
                  required: ["value", "_tag"],
                  type: "object",
                },
              ],
            },
            type: "array",
          },
        },
        required: ["$children"],
        type: "object",
      },
    },
  ],
  [
    "open elements",
    {
      arbitrary:
        'Unable to derive an arbitrary for an unsupported Declaration\n  at ["children"][0]',
      codecJson: {
        references: {
          ResolvedElementEncoded: {
            _tag: "Declaration",
            annotations: { expected: "JSON value", "~identifier": "ResolvedElement" },
            checks: [],
            representation: { id: "effect/schema/Json", payload: null },
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElementEncoded", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "oe" },
            },
          ],
        },
      },
      encodedJsonSchema: {
        definitions: { ResolvedElementEncoded: {} },
        dialect: "draft-2020-12",
        schema: {
          additionalProperties: true,
          properties: {
            attributes: { additionalProperties: { type: "string" }, type: "object" },
            children: {
              items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
              type: "array",
            },
            name: { enum: ["oe"], type: "string" },
          },
          required: ["attributes", "children", "name"],
          type: "object",
        },
      },
      encodedRepresentation: {
        references: {
          ResolvedElement: {
            _tag: "Declaration",
            annotations: { identifier: "ResolvedElement" },
            checks: [],
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElement", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "oe" },
            },
          ],
        },
      },
      equivalence: [true, false, false],
      formatted: [
        '{ "attributes": {}, "children": [{"attributes":{"id":"1"},"children":[],"name":"e"}, {"attributes":{"k":"v"},"children":["x"],"name":"zz"}], "name": "oe" }',
        '{ "attributes": { "id": 1 }, "children": [1, "x"], "name": "oe" }',
      ],
      jsonSchema: {
        definitions: { ResolvedElementEncoded: {} },
        dialect: "draft-2020-12",
        schema: {
          additionalProperties: true,
          properties: {
            attributes: { additionalProperties: { type: "string" }, type: "object" },
            children: {
              items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
              type: "array",
            },
            name: { enum: ["oe"], type: "string" },
          },
          required: ["attributes", "children", "name"],
          type: "object",
        },
      },
      representation: {
        references: {
          ResolvedElement: {
            _tag: "Declaration",
            annotations: { identifier: "ResolvedElement" },
            checks: [],
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElement", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "oe" },
            },
          ],
        },
      },
      standardInput: {
        $defs: { ResolvedElementEncoded: {} },
        $schema: "https://json-schema.org/draft/2020-12/schema",
        additionalProperties: true,
        properties: {
          attributes: { additionalProperties: { type: "string" }, type: "object" },
          children: {
            items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
            type: "array",
          },
          name: { enum: ["oe"], type: "string" },
        },
        required: ["attributes", "children", "name"],
        type: "object",
      },
      standardOutput: {
        $defs: { ResolvedElementEncoded: {} },
        $schema: "https://json-schema.org/draft/2020-12/schema",
        additionalProperties: true,
        properties: {
          "*": { items: { $ref: "#/$defs/ResolvedElementEncoded" }, type: "array" },
          e: {
            additionalProperties: true,
            properties: { id: { type: "string" } },
            required: ["id"],
            type: "object",
          },
        },
        required: ["*"],
        type: "object",
      },
    },
  ],
  [
    "open mixed",
    {
      arbitrary:
        'Unable to derive an arbitrary for an unsupported Declaration\n  at ["children"][0]',
      codecJson: {
        references: {
          ResolvedElementEncoded: {
            _tag: "Declaration",
            annotations: { expected: "JSON value", "~identifier": "ResolvedElement" },
            checks: [],
            representation: { id: "effect/schema/Json", payload: null },
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElementEncoded", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "om" },
            },
          ],
        },
      },
      encodedJsonSchema: {
        definitions: { ResolvedElementEncoded: {} },
        dialect: "draft-2020-12",
        schema: {
          additionalProperties: true,
          properties: {
            attributes: { additionalProperties: { type: "string" }, type: "object" },
            children: {
              items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
              type: "array",
            },
            name: { enum: ["om"], type: "string" },
          },
          required: ["attributes", "children", "name"],
          type: "object",
        },
      },
      encodedRepresentation: {
        references: {
          ResolvedElement: {
            _tag: "Declaration",
            annotations: { identifier: "ResolvedElement" },
            checks: [],
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElement", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "om" },
            },
          ],
        },
      },
      equivalence: [true, false, false],
      formatted: [
        '{ "attributes": {}, "children": ["x", {"attributes":{"id":"1"},"children":[],"name":"e"}, {"attributes":{},"children":[],"name":"zz"}], "name": "om" }',
        '{ "attributes": { "id": 1 }, "children": [1, "x"], "name": "om" }',
      ],
      jsonSchema: {
        definitions: { ResolvedElementEncoded: {} },
        dialect: "draft-2020-12",
        schema: {
          additionalProperties: true,
          properties: {
            attributes: { additionalProperties: { type: "string" }, type: "object" },
            children: {
              items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
              type: "array",
            },
            name: { enum: ["om"], type: "string" },
          },
          required: ["attributes", "children", "name"],
          type: "object",
        },
      },
      representation: {
        references: {
          ResolvedElement: {
            _tag: "Declaration",
            annotations: { identifier: "ResolvedElement" },
            checks: [],
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElement", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "om" },
            },
          ],
        },
      },
      standardInput: {
        $defs: { ResolvedElementEncoded: {} },
        $schema: "https://json-schema.org/draft/2020-12/schema",
        additionalProperties: true,
        properties: {
          attributes: { additionalProperties: { type: "string" }, type: "object" },
          children: {
            items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
            type: "array",
          },
          name: { enum: ["om"], type: "string" },
        },
        required: ["attributes", "children", "name"],
        type: "object",
      },
      standardOutput: {
        $defs: { ResolvedElementEncoded: {} },
        $schema: "https://json-schema.org/draft/2020-12/schema",
        additionalProperties: true,
        properties: {
          $children: {
            items: {
              anyOf: [
                {
                  additionalProperties: true,
                  properties: {
                    _tag: { enum: ["$text"], type: "string" },
                    text: { type: "string" },
                  },
                  required: ["_tag", "text"],
                  type: "object",
                },
                {
                  additionalProperties: true,
                  properties: {
                    _tag: { enum: ["e"], type: "string" },
                    value: {
                      additionalProperties: true,
                      properties: { id: { type: "string" } },
                      required: ["id"],
                      type: "object",
                    },
                  },
                  required: ["value", "_tag"],
                  type: "object",
                },
                {
                  additionalProperties: true,
                  properties: {
                    _tag: { enum: ["*"], type: "string" },
                    element: { $ref: "#/$defs/ResolvedElementEncoded" },
                  },
                  required: ["_tag", "element"],
                  type: "object",
                },
              ],
            },
            type: "array",
          },
        },
        required: ["$children"],
        type: "object",
      },
    },
  ],
  [
    "data",
    {
      arbitrary:
        'Unable to derive an arbitrary for an unsupported Declaration\n  at ["children"][0]',
      codecJson: {
        references: {
          ResolvedElementEncoded: {
            _tag: "Declaration",
            annotations: { expected: "JSON value", "~identifier": "ResolvedElement" },
            checks: [],
            representation: { id: "effect/schema/Json", payload: null },
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElementEncoded", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "d" },
            },
          ],
        },
      },
      encodedJsonSchema: {
        definitions: { ResolvedElementEncoded: {} },
        dialect: "draft-2020-12",
        schema: {
          additionalProperties: true,
          properties: {
            attributes: { additionalProperties: { type: "string" }, type: "object" },
            children: {
              items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
              type: "array",
            },
            name: { enum: ["d"], type: "string" },
          },
          required: ["attributes", "children", "name"],
          type: "object",
        },
      },
      encodedRepresentation: {
        references: {
          ResolvedElement: {
            _tag: "Declaration",
            annotations: { identifier: "ResolvedElement" },
            checks: [],
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElement", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "d" },
            },
          ],
        },
      },
      equivalence: [true, false, false],
      formatted: [
        '{ "attributes": { "data-x": "2", "id": "1" }, "children": [], "name": "d" }',
        '{ "attributes": { "id": 1 }, "children": [1, "x"], "name": "d" }',
      ],
      jsonSchema: {
        definitions: { ResolvedElementEncoded: {} },
        dialect: "draft-2020-12",
        schema: {
          additionalProperties: true,
          properties: {
            attributes: { additionalProperties: { type: "string" }, type: "object" },
            children: {
              items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
              type: "array",
            },
            name: { enum: ["d"], type: "string" },
          },
          required: ["attributes", "children", "name"],
          type: "object",
        },
      },
      representation: {
        references: {
          ResolvedElement: {
            _tag: "Declaration",
            annotations: { identifier: "ResolvedElement" },
            checks: [],
            typeParameters: [],
          },
        },
        representation: {
          _tag: "Objects",
          checks: [],
          indexSignatures: [],
          propertySignatures: [
            {
              isMutable: false,
              isOptional: false,
              name: "attributes",
              type: {
                _tag: "Objects",
                checks: [],
                indexSignatures: [
                  {
                    parameter: { _tag: "String", checks: [] },
                    type: { _tag: "String", checks: [] },
                  },
                ],
                propertySignatures: [],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "children",
              type: {
                _tag: "Arrays",
                checks: [],
                elements: [],
                rest: [
                  {
                    _tag: "Union",
                    checks: [],
                    types: [
                      { _tag: "String", checks: [] },
                      { $ref: "ResolvedElement", _tag: "Reference" },
                    ],
                  },
                ],
              },
            },
            {
              isMutable: false,
              isOptional: false,
              name: "name",
              type: { _tag: "Literal", checks: [], literal: "d" },
            },
          ],
        },
      },
      standardInput: {
        $defs: { ResolvedElementEncoded: {} },
        $schema: "https://json-schema.org/draft/2020-12/schema",
        additionalProperties: true,
        properties: {
          attributes: { additionalProperties: { type: "string" }, type: "object" },
          children: {
            items: { anyOf: [{ type: "string" }, { $ref: "#/$defs/ResolvedElementEncoded" }] },
            type: "array",
          },
          name: { enum: ["d"], type: "string" },
        },
        required: ["attributes", "children", "name"],
        type: "object",
      },
      standardOutput: {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        additionalProperties: true,
        patternProperties: { "^data-[\\s\\S]*?$": { type: "number" } },
        properties: { id: { type: "string" } },
        required: ["id"],
        type: "object",
      },
    },
  ],
]);

describe("wire fast path: Schema derivations", () => {
  for (const { base, codec, label } of codecs) {
    it(`${label}: every derivation of the codec and its encoded side is as captured`, () => {
      check(DERIVATIONS, label, derivationsOf(codec, base));
    });
  }
});
