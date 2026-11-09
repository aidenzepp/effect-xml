/* oxlint-disable sort-keys -- expected objects are written in the builder's key order, which the JSON.stringify comparisons check (M6). */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

import { build } from "./builder.ts";
import { GENERIC, ITEM_VALUE, isData } from "./compile.ts";
import { Element, namespaces, suspend } from "./dsl.ts";
import type { ResolvedElement } from "./element.ts";
import { elements, many, mixed, optional, planOf, text } from "./plan.ts";
import type { Plan } from "./plan.ts";
import { structuralPlan } from "./structural-slot.ts";
import { structuralOf } from "./structural.ts";
import type { Structural } from "./structural.ts";

/**
 * The namespace of the prefixed child.
 */
const MARK = "urn:test:mark";

/**
 * Build a resolved element.
 *
 * @param name - The Clark name.
 * @param attributes - The attributes by Clark name.
 * @param children - The children.
 * @returns The resolved element.
 */
const node = (
  name: string,
  attributes: Readonly<Record<string, string>> = {},
  children: ResolvedElement["children"] = [],
): ResolvedElement => ({ attributes, children, name });

/**
 * A text element with a typed attribute and a `data-*` group.
 */
const Leaf = Element("leaf", {
  attributes: { "data-*": Schema.Int, n: Schema.Int },
  content: text(Schema.String),
});

/**
 * A plain text element with no attributes, used as a `many` slot and through a `suspend` member.
 */
const Item = Element("item", { content: text(Schema.String) });

/**
 * A text element in a declared namespace.
 */
const Mark = namespaces({ m: MARK }).Element("m:mark", { content: text(Schema.String) });

/**
 * An element with `empty` content and one attribute.
 */
const Bare = Element("bare", { attributes: { id: Schema.String } });

/**
 * A text element the wrapped slot and member decode to their text.
 */
const Note = Element("note", { content: text(Schema.String) });

/**
 * `Note` decoded to its text: `decodeTo` keeps the slot and member opaque, so they receive the raw
 * resolved element.
 */
const NoteText = Note.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((note: { readonly $text: string }) => note.$text),
    encode: SchemaGetter.transform((value: string) => ({ $text: value })),
  }),
);

/**
 * The decoded value of a `Tree`.
 */
interface Tree {
  readonly label: string;
  readonly kids: readonly Tree[];
}

/**
 * A recursive element: its `kids` slot is a `suspend` reference to itself.
 */
const TreeCodec: Element<"tree", Tree> = Element("tree", {
  attributes: { label: Schema.String },
  content: elements({ kids: many(suspend("tree", () => TreeCodec)) }),
});

/**
 * Closed `elements` content with every slot shape: `many`, `one`, an optional namespaced child,
 * an opaque `decodeTo` child, and an optional recursive child.
 */
const Box = Element("box", {
  attributes: { id: Schema.String },
  content: elements({
    items: many(Item),
    leaf: Leaf,
    mark: optional(Mark),
    note: NoteText,
    tree: optional(TreeCodec),
  }),
});

/**
 * Open `elements` content.
 */
const OpenBox = Element("open-box", {
  content: elements({ leaf: optional(Leaf) }, { open: true }),
});

/**
 * Closed `mixed` content with a named, a namespaced, an opaque `decodeTo`, and a `suspend` member.
 */
const Para = Element("p", {
  content: mixed([Leaf, Mark, NoteText, suspend("item", () => Item)]),
});

/**
 * Open `mixed` content.
 */
const OpenPara = Element("open-p", { content: mixed([Leaf], { open: true }) });

/**
 * Read the plan of a vocabulary element.
 *
 * @param def - The element codec.
 * @returns Its plan.
 */
const planFor = (def: Schema.Top): Plan => {
  const plan = planOf(def);

  expect(plan).toBeDefined();

  return plan ?? Effect.runSync(Effect.die("no plan"));
};

/**
 * Narrow a structural codec to the services the vocabulary uses.
 *
 * @param codec - The structural codec.
 * @returns The same codec, typed with no services.
 */
const serviceless = (codec: Structural): Schema.Codec<unknown, unknown> =>
  // SAFETY: no schema in this vocabulary requires a decoding or encoding service.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the services are type-level only.
  codec as Schema.Codec<unknown, unknown>;

/**
 * Narrow an element codec to the services the vocabulary uses.
 *
 * @param def - The element codec.
 * @returns The same codec, typed with no services.
 */
const plainElement = (def: Schema.Top): Schema.Codec<unknown, unknown> =>
  // SAFETY: no schema in this vocabulary requires a decoding or encoding service.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the services are type-level only.
  def as Schema.Codec<unknown, unknown>;

/**
 * Collect the keys of a built object that its plan does not declare, at every level the builder
 * shapes. A raw resolved element (an opaque slot or member, or an undeclared element of open
 * content) is not walked: its own schema decodes it whole.
 *
 * @param plan - The plan the object was built for.
 * @param value - The built object.
 * @param path - The path of `value`, for the report.
 * @returns The path of every undeclared key; empty when the object holds only declared keys.
 */
/**
 * Collect the struct keys a plan declares: its attribute keys and its content keys, including
 * `GENERIC` for open `elements` content. Admitted `data-*` names are checked apart with `isData`.
 *
 * @param plan - The element plan.
 * @returns The declared keys.
 */
const declaredKeysOf = (plan: Plan): ReadonlySet<string> => {
  const { content } = plan;
  const declared = new Set(plan.attributes.map((a) => a.key));

  if (content.mode === "text" || content.mode === "mixed") {
    declared.add(content.key);
  }

  if (content.mode === "elements") {
    for (const slot of content.children) {
      declared.add(slot.key);
    }

    if (content.open) {
      declared.add(GENERIC);
    }
  }

  return declared;
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a built object of any shape; a key the plan does not declare is what the walk reports.
const undeclaredKeys = (plan: Plan, value: unknown, path = "$"): readonly string[] => {
  if (!Predicate.isObject(value)) {
    return [`${path} is not an object`];
  }

  const { content } = plan;
  const declared = declaredKeysOf(plan);

  const own = Object.keys(value)
    .filter((key) => !declared.has(key) && !isData(plan, key))
    .map((key) => `${path}.${key}`);

  const nested: string[] = [];

  if (content.mode === "elements") {
    for (const slot of content.children) {
      const child = structuralPlan(slot.schema);
      const raw = value[slot.key];
      const items: readonly unknown[] = Array.isArray(raw) ? raw : [raw];

      if (child !== undefined && raw !== undefined) {
        for (const [index, item] of items.entries()) {
          nested.push(...undeclaredKeys(child, item, `${path}.${slot.key}[${index}]`));
        }
      }
    }
  }

  if (content.mode === "mixed") {
    const raw = value[content.key];
    const items: readonly unknown[] = Array.isArray(raw) ? raw : [];

    for (const [index, item] of items.entries()) {
      const at = `${path}.${content.key}[${index}]`;

      if (!Predicate.isObject(item)) {
        nested.push(`${at} is not an object`);

        continue;
      }

      const member = content.members.find((entry) => entry.wire === item._tag);
      const keys = member === undefined ? ["_tag", "text", "element"] : [ITEM_VALUE, "_tag"];

      nested.push(
        ...Object.keys(item)
          .filter((key) => !keys.includes(key))
          .map((key) => `${at}.${key}`),
      );

      const child = member === undefined ? undefined : structuralPlan(member.schema);

      if (child !== undefined) {
        nested.push(...undeclaredKeys(child, item[ITEM_VALUE], `${at}.${ITEM_VALUE}`));
      }
    }
  }

  return [...own, ...nested];
};

/**
 * The opaque `note` element, as the builder passes it through unchanged.
 */
const note = node("note", {}, ["N"]);

/**
 * A `leaf` child and its built object, with its attributes in the element's order.
 */
const leaf = node("leaf", { n: "1", "data-x": "2" }, ["h", "i"]);

/**
 * The built object of {@link leaf}.
 */
const leafPlain = { n: "1", "data-x": "2", $text: "hi" };

/**
 * The children every valid `box` holds: its `one` slots, `leaf` and `note`.
 */
const boxRequired: ResolvedElement["children"] = [leaf, "\n  ", note];

/**
 * One acceptance row: a label, the element codec, a resolved element today's codec decodes, and
 * the plain object the builder emits for it.
 */
type Accepted = readonly [string, Schema.Top, ResolvedElement, unknown];

/**
 * The acceptance table: one row per shape the structural codec decodes.
 */
const accepted: readonly Accepted[] = [
  ["attributes, data-*, and joined text", Leaf, leaf, leafPlain],
  ["empty text", Item, node("item"), { $text: "" }],
  ["empty content with blank text", Bare, node("bare", { id: "x" }, [" \n\t"]), { id: "x" }],
  [
    "every elements slot shape, children out of slot order",
    Box,
    node("box", { id: "b1" }, [
      node("item", {}, ["a"]),
      " ",
      node(`{${MARK}}mark`, {}, ["mk"]),
      ...boxRequired,
      node("item", {}, ["b"]),
      node("tree", { label: "root" }, [node("tree", { label: "kid" })]),
    ]),
    {
      id: "b1",
      items: [{ $text: "a" }, { $text: "b" }],
      leaf: leafPlain,
      mark: { $text: "mk" },
      note,
      tree: { label: "root", kids: [{ label: "kid", kids: [] }] },
    },
  ],
  [
    "a many slot with zero children and an absent optional slot",
    Box,
    node("box", { id: "b2" }, boxRequired),
    { id: "b2", items: [], leaf: leafPlain, note },
  ],
  [
    "open elements content",
    OpenBox,
    node("open-box", {}, [node("other", { a: "1" }, ["y"]), leaf, node("zz")]),
    { leaf: leafPlain, [GENERIC]: [node("other", { a: "1" }, ["y"]), node("zz")] },
  ],
  ["open elements content with no children", OpenBox, node("open-box"), { [GENERIC]: [] }],
  [
    "closed mixed content with whitespace and empty text runs",
    Para,
    node("p", {}, [
      "t1",
      node("leaf", { n: "2" }, ["L"]),
      " \n ",
      node(`{${MARK}}mark`, {}, ["M"]),
      "",
      note,
      node("item", {}, ["I"]),
    ]),
    {
      $children: [
        { _tag: "$text", text: "t1" },
        { value: { n: "2", $text: "L" }, _tag: "leaf" },
        { _tag: "$text", text: " \n " },
        { value: { $text: "M" }, _tag: "m:mark" },
        { _tag: "$text", text: "" },
        { value: note, _tag: "note" },
        { value: { $text: "I" }, _tag: "item" },
      ],
    },
  ],
  [
    "open mixed content",
    OpenPara,
    node("open-p", {}, ["x", node("leaf", { n: "1" }, ["a"]), node("zz", {}, ["q"])]),
    {
      $children: [
        { _tag: "$text", text: "x" },
        { value: { n: "1", $text: "a" }, _tag: "leaf" },
        { _tag: GENERIC, element: node("zz", {}, ["q"]) },
      ],
    },
  ],
];

/**
 * One refusal row: the receipt C7 row id and form, the element codec, and a resolved element
 * today's codec rejects for that row's reason.
 */
type Refused = readonly [string, Schema.Top, ResolvedElement];

/**
 * The refusal table: every form of receipt C7 rows B1 to B8.
 */
const refused: readonly Refused[] = [
  ["B1 (another local name)", Item, node("other", {}, ["x"])],
  ["B1 (another namespace)", Mark, node("mark", {}, ["x"])],
  ["B2 (undeclared attribute, no data group)", Item, node("item", { a: "1" }, ["x"])],
  ["B2 (data-* attribute, no data group)", Item, node("item", { "data-x": "1" }, ["x"])],
  ["B2 (undeclared attribute beside a data group)", Leaf, node("leaf", { n: "1", z: "2" }, ["x"])],
  ["B3 (text in empty content)", Bare, node("bare", { id: "x" }, [" t "])],
  ["B3 (element child in empty content)", Bare, node("bare", { id: "x" }, [node("item")])],
  ["B4 (element child in text content)", Item, node("item", {}, ["a", node("b"), "c"])],
  ["B5 (text in elements content)", Box, node("box", { id: "b" }, [...boxRequired, "oops"])],
  [
    "B6 (undeclared child of closed elements)",
    Box,
    node("box", { id: "b" }, [...boxRequired, node("zz")]),
  ],
  ["B7 (second child of a one slot)", Box, node("box", { id: "b" }, [...boxRequired, leaf])],
  [
    "B7 (second child of an optional slot)",
    Box,
    node("box", { id: "b" }, [
      ...boxRequired,
      node(`{${MARK}}mark`, {}, ["1"]),
      node(`{${MARK}}mark`, {}, ["2"]),
    ]),
  ],
  ["B8 (undeclared element in closed mixed)", Para, node("p", {}, ["t", node("zz")])],
  [
    "B4 nested in an optional slot",
    Box,
    node("box", { id: "b" }, [...boxRequired, node(`{${MARK}}mark`, {}, [node("x")])]),
  ],
  [
    "B2 nested in a many slot",
    Box,
    node("box", { id: "b" }, [...boxRequired, node("item"), node("item", { a: "1" })]),
  ],
  [
    "B6 nested in a recursive slot",
    Box,
    node("box", { id: "b" }, [...boxRequired, node("tree", { label: "r" }, [node("zz")])]),
  ],
  [
    "B4 nested in a mixed member",
    Para,
    node("p", {}, ["t", node("leaf", { n: "1" }, [node("x")])]),
  ],
  ["B2 nested in a suspend member", Para, node("p", {}, [node("item", { a: "1" })])],
];

describe("build", () => {
  it.effect.each(refused)("refuses %s, which today's codec rejects", ([, def, element]) =>
    Effect.gen(function* refuses() {
      const exit = yield* Schema.decodeUnknownEffect(plainElement(def))(element).pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      expect(build(planFor(def), element)).toBeUndefined();
    }),
  );

  it.each(accepted)("builds %s", (_, def, element, expected) => {
    const built = build(planFor(def), element);

    expect(built).toStrictEqual(expected);
    expect(JSON.stringify(built)).toBe(JSON.stringify(expected));
  });

  it.effect.each(accepted)("decodes the built %s to today's value", ([, def, element]) =>
    Effect.gen(function* decodes() {
      const plan = planFor(def);
      const expected = yield* Schema.decodeUnknownEffect(plainElement(def))(element);

      const value = yield* Schema.decodeUnknownEffect(serviceless(structuralOf(plan)))(
        build(plan, element),
      );

      expect(value).toStrictEqual(expected);
      expect(JSON.stringify(value)).toBe(JSON.stringify(expected));
    }),
  );

  it.each(accepted)("emits only declared keys for %s", (_, def, element) => {
    const plan = planFor(def);

    expect(undeclaredKeys(plan, build(plan, element))).toStrictEqual([]);
  });

  it("reads own attributes only, as Object.entries does", () => {
    const attributes = { n: "1" };

    Reflect.setPrototypeOf(attributes, { z: "2" });

    expect(build(planFor(Leaf), node("leaf", attributes, ["x"]))).toStrictEqual({
      n: "1",
      $text: "x",
    });
  });

  it("returns the same result for a repeated call on one plan", () => {
    const plan = planFor(Box);
    const element = node("box", { id: "b2" }, boxRequired);
    const first = build(plan, element);

    expect(first).toStrictEqual({ id: "b2", items: [], leaf: leafPlain, note });
    expect(build(plan, element)).toStrictEqual(first);
  });
});
