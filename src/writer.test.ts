import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { Xml } from "effect/encoding";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

import { Element as bare, namespaces } from "./dsl.ts";
import type { Element } from "./dsl.ts";
import type { ResolvedElement } from "./element.ts";
import { isEncodeError } from "./issue.ts";
import { elements, many, mixed, optional, planOf, text } from "./plan.ts";
import { toEvents } from "./resolve.ts";
import { toEventsFrom, writerOf } from "./writer.ts";

/**
 * The default namespace of the vocabulary's root.
 */
const A = "urn:effect-xml:writer:a";

/**
 * A second namespace the root's map binds to the prefix `b`.
 */
const B = "urn:effect-xml:writer:b";

/**
 * A namespace no map binds, so only an element in it can be written, by declaring it on itself.
 */
const Z = "urn:effect-xml:writer:z";

/**
 * The builders bound to the vocabulary's map.
 */
const ab = namespaces({ "": A, b: B });

/**
 * The transformation the `decodeTo` member adds: the element decodes to its text.
 */
const toText = {
  decode: SchemaGetter.transform((leaf: { readonly $text: string }) => leaf.$text),
  encode: SchemaGetter.transform((value: string) => ({ $text: value })),
};

/**
 * A text element in the default namespace.
 */
const Name = ab.Element("name", { content: text(Schema.String) });

/**
 * A text element in namespace `B`, a different namespace from the root.
 */
const Note = ab.Element("b:note", { content: text(Schema.String) });

/**
 * A text element in no namespace, which declares `xmlns=""` under the root's default binding.
 */
const Bare = bare("bare", { content: text(Schema.String) });

/**
 * An attribute-only empty element.
 */
const Flag = ab.Element("flag", { attributes: { "b:why": Schema.String, on: Schema.String } });

/**
 * A `.check`-wrapped child: structural, so its slot holds a nested plain object.
 */
const Checked = ab
  .Element("checked", { content: text(Schema.String) })
  .check(Schema.makeFilter((leaf: { readonly $text: string }) => leaf.$text.length > 0));

/**
 * A structural mixed member.
 */
const Em = ab.Element("em", { content: text(Schema.String) });

/**
 * A `decodeTo`-wrapped mixed member: opaque, so its item holds a resolved element.
 */
const Strong = ab
  .Element("strong", { content: text(Schema.String) })
  .pipe(Schema.decodeTo(Schema.String, toText));

/**
 * Open mixed content over a structural and an opaque member.
 */
const Para = ab.Element("p", { content: mixed([Em, Strong], { open: true }) });

/**
 * Closed mixed content.
 */
const Line = ab.Element("line", { content: mixed([Em]) });

/**
 * A `decodeTo`-wrapped child: opaque, so its slot holds a resolved element.
 */
const Wrapped = ab
  .Element("wrapped", { content: text(Schema.String) })
  .pipe(Schema.decodeTo(Schema.String, toText));

/**
 * An `elements` parent of the opaque child, so the writer's opaque branch is covered by a slot.
 */
const Holder = ab.Element("holder", { content: elements({ wrapped: Wrapped }) });

/**
 * The Type of the recursive `Tree` element.
 */
interface TreeNode {
  readonly label: string;
  readonly kids: readonly TreeNode[];
}

/**
 * A recursive element whose `kids` slot is a `suspend` reference to itself.
 */
const Tree: Element<"tree", TreeNode> = ab.Element("tree", {
  attributes: { label: Schema.String },
  content: elements({ kids: many(ab.suspend("tree", () => Tree)) }),
});

/**
 * The root: declared, namespaced, and `data-*` attributes, every slot cardinality, a namespaced
 * child, a no-namespace child, a checked child, mixed content, recursion, and open content.
 */
const Root = ab.Element("root", {
  attributes: { "b:lang": Schema.String, "data-*": Schema.String, id: Schema.String },
  content: elements(
    {
      bare: many(Bare),
      checked: Checked,
      flag: Flag,
      line: Line,
      name: Name,
      note: optional(Note),
      para: Para,
      tree: Tree,
    },
    { open: true },
  ),
});

/**
 * Build a resolved text element.
 *
 * @param name - The Clark name.
 * @param value - The text; empty means no children.
 * @returns The resolved element.
 */
const leaf = (name: string, value: string): ResolvedElement => ({
  attributes: {},
  children: value === "" ? [] : [value],
  name,
});

/**
 * An undeclared child of the root in namespace `Z`, carrying an attribute in namespace `B`.
 */
const extra: ResolvedElement = {
  attributes: { [`{${B}}lang`]: "fr", plain: "y" },
  children: ["x", leaf(`{${A}}inner`, "deep")],
  name: `{${Z}}extra`,
};

/**
 * An undeclared mixed child in namespace `Z`.
 */
const span = leaf(`{${Z}}span`, "z");

/**
 * The resolved `Tree` the root carries: two levels of recursion.
 */
const treeElement: ResolvedElement = {
  attributes: { label: "top" },
  children: [
    {
      attributes: { label: "left" },
      children: [{ attributes: { label: "leaf" }, children: [], name: `{${A}}tree` }],
      name: `{${A}}tree`,
    },
    { attributes: { label: "right" }, children: [], name: `{${A}}tree` },
  ],
  name: `{${A}}tree`,
};

/**
 * The plain encoded object of `treeElement`.
 */
const treePlain = {
  kids: [
    { kids: [{ kids: [], label: "leaf" }], label: "left" },
    { kids: [], label: "right" },
  ],
  label: "top",
};

/**
 * The resolved root every shape row decodes.
 */
const rootElement: ResolvedElement = {
  attributes: { [`{${B}}lang`]: "en", "data-x": "1", "data-y": "2", id: "r1" },
  children: [
    leaf(`{${A}}name`, "Ada"),
    leaf(`{${B}}note`, "hi"),
    leaf("bare", "one"),
    leaf("bare", ""),
    { attributes: { [`{${B}}why`]: "test", on: "yes" }, children: [], name: `{${A}}flag` },
    leaf(`{${A}}checked`, "ok"),
    {
      attributes: {},
      children: [
        "Hello ",
        leaf(`{${A}}em`, "big"),
        " and ",
        leaf(`{${A}}strong`, "bold"),
        " ",
        span,
        "  ",
      ],
      name: `{${A}}p`,
    },
    { attributes: {}, children: ["a ", leaf(`{${A}}em`, "b")], name: `{${A}}line` },
    treeElement,
    extra,
  ],
  name: `{${A}}root`,
};

/**
 * The plain encoded object of `rootElement`: structural children as nested plain objects, opaque
 * children and open content as resolved elements.
 */
const rootPlain = {
  "*": [extra],
  "b:lang": "en",
  bare: [{ $text: "one" }, { $text: "" }],
  checked: { $text: "ok" },
  "data-x": "1",
  "data-y": "2",
  flag: { "b:why": "test", on: "yes" },
  id: "r1",
  line: {
    $children: [
      { _tag: "$text", text: "a " },
      { _tag: "em", value: { $text: "b" } },
    ],
  },
  name: { $text: "Ada" },
  note: { $text: "hi" },
  para: {
    $children: [
      { _tag: "$text", text: "Hello " },
      { _tag: "em", value: { $text: "big" } },
      { _tag: "$text", text: " and " },
      { _tag: "strong", value: leaf(`{${A}}strong`, "bold") },
      { _tag: "$text", text: " " },
      { _tag: "*", element: span },
      { _tag: "$text", text: "  " },
    ],
  },
  tree: treePlain,
};

/**
 * The plain encoded object of the root with its `optional` slot absent and its `many` and open
 * slots empty.
 */
const { note: _note, ...withoutNote } = rootPlain;

/**
 * The root's plain object with no `note` key, no `bare` elements, and no open content.
 */
const emptySlotsPlain = { ...withoutNote, "*": [], bare: [] };

/**
 * One event-equality row: a definition, the resolved element its value decodes from, and the
 * plain encoded object the structural codec gives for that value.
 */
interface Row {
  readonly title: string;
  readonly def: Schema.Codec<unknown, ResolvedElement>;
  readonly element: ResolvedElement;
  readonly plain: unknown;
}

/**
 * Narrow a definition to the codec the rows run.
 *
 * @param def - A vocabulary element whose schemas require no services.
 * @returns The same codec, typed with no services.
 */
const codec = (def: Schema.Top): Schema.Codec<unknown, ResolvedElement> =>
  // SAFETY: every vocabulary schema is built from `Schema.String` and needs no services; the
  // Encoded side of an element codec is a resolved element.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- services exist only at the type level.
  def as Schema.Codec<unknown, ResolvedElement>;

/**
 * The event-equality rows.
 */
const rows: readonly Row[] = [
  { def: codec(Root), element: rootElement, plain: rootPlain, title: "the full vocabulary" },
  {
    def: codec(Root),
    element: {
      ...rootElement,
      children: rootElement.children.filter(
        (c) => Predicate.isString(c) || ![extra.name, "bare", `{${B}}note`].includes(c.name),
      ),
    },
    plain: emptySlotsPlain,
    title: "the root with optional, many, and open slots empty",
  },
  { def: codec(Name), element: leaf(`{${A}}name`, "Ada"), plain: { $text: "Ada" }, title: "text" },
  { def: codec(Name), element: leaf(`{${A}}name`, ""), plain: { $text: "" }, title: "empty text" },
  { def: codec(Bare), element: leaf("bare", "b"), plain: { $text: "b" }, title: "no namespace" },
  { def: codec(Note), element: leaf(`{${B}}note`, "n"), plain: { $text: "n" }, title: "prefixed" },
  {
    def: codec(Flag),
    element: { attributes: { [`{${B}}why`]: "w", on: "1" }, children: [], name: `{${A}}flag` },
    plain: { "b:why": "w", on: "1" },
    title: "attributes only",
  },
  { def: codec(Tree), element: treeElement, plain: treePlain, title: "recursion" },
  {
    def: codec(Holder),
    element: { attributes: {}, children: [leaf(`{${A}}wrapped`, "w")], name: `{${A}}holder` },
    plain: { wrapped: leaf(`{${A}}wrapped`, "w") },
    title: "an opaque elements slot",
  },
];

/**
 * Write a definition's value with today's path: encode to a resolved element, then `toEvents`.
 *
 * @param row - The row to write.
 * @param declaration - Whether a declaration leads.
 * @returns An effect yielding today's events.
 */
const today = (row: Row, declaration: boolean) =>
  Effect.gen(function* todayEvents() {
    const plan = planOf(row.def);

    expect(plan).toBeDefined();

    const value = yield* Schema.decodeUnknownEffect(row.def)(row.element);
    const encoded = yield* Schema.encodeEffect(row.def)(value);

    return yield* toEvents(encoded, { declaration, prefixes: plan?.prefixes ?? {} });
  });

/**
 * Write a plain object with the plan-driven writer for a definition.
 *
 * @param def - The definition.
 * @param plain - The plain encoded object.
 * @param declaration - Whether a declaration leads.
 * @returns The events, or `undefined` for a refusal.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- plain data, possibly of the wrong shape; the writer's refusal is under test.
const fast = (def: Schema.Top, plain: unknown, declaration: boolean) => {
  const plan = planOf(def);

  expect(plan).toBeDefined();

  return plan === undefined
    ? undefined
    : toEventsFrom(writerOf(plan, plan.prefixes), plain, { declaration });
};

describe("toEventsFrom: event equality with toEvents", () => {
  it("compares at least one row per declaration setting", () => {
    expect(rows.length).toBeGreaterThan(0);
  });

  for (const declaration of [true, false]) {
    it.effect.each(rows)(`writes $title (declaration ${declaration})`, (row) =>
      Effect.gen(function* writesRow() {
        const events = yield* today(row, declaration);

        expect(events.length).toBeGreaterThan(0);
        expect(JSON.stringify(fast(row.def, row.plain, declaration))).toBe(JSON.stringify(events));
      }),
    );
  }
});

describe("toEventsFrom: refusals", () => {
  it("refuses a text leaf that is not a string", () => {
    expect(fast(Name, { $text: 3 }, true)).toBeUndefined();
  });

  it("refuses an attribute that is not a string", () => {
    expect(fast(Flag, { "b:why": "w", on: 1 }, true)).toBeUndefined();
  });

  it("refuses a data-* attribute that is not a string", () => {
    expect(fast(Root, { ...rootPlain, "data-x": 1 }, true)).toBeUndefined();
  });

  it("refuses a mixed text item that is not a string", () => {
    expect(fast(Line, { $children: [{ _tag: "$text", text: 1 }] }, true)).toBeUndefined();
  });

  it.effect("refuses an open element whose attribute namespace no prefix spells", () =>
    Effect.gen(function* refusesUnmapped() {
      const unmapped: ResolvedElement = { ...extra, attributes: { [`{${Z}}code`]: "c" } };

      const element = {
        ...rootElement,
        children: rootElement.children.map((c) => (c === extra ? unmapped : c)),
      };

      const failure = yield* today(
        { def: codec(Root), element, plain: undefined, title: "unmapped" },
        true,
      ).pipe(Effect.flip);

      expect(isEncodeError(failure) ? failure.reason._tag : failure._tag).toBe("UnmappedNamespace");
      expect(fast(Root, { ...rootPlain, "*": [unmapped] }, true)).toBeUndefined();
    }),
  );
});

/**
 * Declared attributes in an order that is neither alphabetical nor the plain object's, one of
 * them prefixed, so the direct attribute path's key order is visible.
 */
const Ordered = ab.Element("ordered", {
  // oxlint-disable-next-line sort-keys -- the declaration order is the order under test.
  attributes: { zeta: Schema.String, "b:mid": Schema.String, alpha: Schema.String },
});

/**
 * Declared, prefixed, and `data-*` attributes, so the per-element attribute path's key order is
 * visible.
 */
const Tagged = ab.Element("tagged", {
  attributes: { "b:lang": Schema.String, "data-*": Schema.String, id: Schema.String },
});

/**
 * An element with an attribute named `__proto__` between two ordinary ones.
 */
const Proto = ab.Element("proto", {
  // oxlint-disable-next-line sort-keys -- the declaration order is the order under test.
  attributes: { zeta: Schema.String, ["__proto__"]: Schema.String, alpha: Schema.String },
});

/**
 * Read the attribute keys of a write's first start tag, in record order.
 *
 * @param events - The events of a write with no declaration, or a refusal.
 * @returns The keys, or `undefined` when the first event is not a start tag.
 */
const startKeys = (events: readonly Xml.Event[] | undefined): readonly string[] | undefined => {
  const first = events?.[0];

  return first?._tag === "StartElement" ? Object.keys(first.attributes) : undefined;
};

describe("toEventsFrom: attribute key order", () => {
  it.effect("writes xmlns declarations, then declared attributes in plan order", () =>
    Effect.gen(function* writesDeclaredOrder() {
      const row: Row = {
        def: codec(Ordered),
        element: {
          attributes: { alpha: "a", [`{${B}}mid`]: "m", zeta: "z" },
          children: [],
          name: `{${A}}ordered`,
        },
        plain: { alpha: "a", "b:mid": "m", zeta: "z" },
        title: "declared order",
      };

      const events = fast(row.def, row.plain, false);

      expect(startKeys(events)).toStrictEqual(["xmlns", "xmlns:b", "zeta", "b:mid", "alpha"]);
      expect(JSON.stringify(events)).toBe(JSON.stringify(yield* today(row, false)));
    }),
  );

  it.effect("writes data-* keys after declared attributes, in the plain object's order", () =>
    Effect.gen(function* writesDataOrder() {
      const row: Row = {
        def: codec(Tagged),
        element: {
          attributes: Object.fromEntries([
            ["data-y", "2"],
            ["id", "i"],
            ["data-x", "1"],
            [`{${B}}lang`, "en"],
          ]),
          children: [],
          name: `{${A}}tagged`,
        },
        plain: Object.fromEntries([
          ["data-y", "2"],
          ["id", "i"],
          ["data-x", "1"],
          ["b:lang", "en"],
        ]),
        title: "data order",
      };

      const events = fast(row.def, row.plain, false);

      expect(startKeys(events)).toStrictEqual([
        "xmlns",
        "xmlns:b",
        "b:lang",
        "id",
        "data-y",
        "data-x",
      ]);
      expect(JSON.stringify(events)).toBe(JSON.stringify(yield* today(row, false)));
    }),
  );

  it("writes an attribute named __proto__ as no key and keeps the record ordinary", () => {
    const plain = Object.fromEntries([
      ["zeta", "z"],
      ["__proto__", "p"],
      ["alpha", "a"],
    ]);

    expect(planOf(Proto)?.attributes.map((a) => a.name)).toStrictEqual([
      "zeta",
      "__proto__",
      "alpha",
    ]);

    const events = fast(Proto, plain, false);
    const first = events?.[0];

    expect(startKeys(events)).toStrictEqual(["xmlns", "xmlns:b", "zeta", "alpha"]);
    expect(events).toStrictEqual([
      {
        _tag: "StartElement",
        attributes: { alpha: "a", xmlns: A, "xmlns:b": B, zeta: "z" },
        name: "proto",
      },
      { _tag: "EndElement", name: "proto" },
    ]);
    expect(
      first?._tag === "StartElement" &&
        Object.getPrototypeOf(first.attributes) === Object.prototype,
    ).toBe(true);
  });
});
