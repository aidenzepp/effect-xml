import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

import { Element, namespaces, suspend } from "./dsl.ts";
import type { Element as ElementCodec } from "./dsl.ts";
import type { ResolvedElement } from "./element.ts";
import { elements, many, mixed, optional, planOf, text } from "./plan.ts";
import type { Plan } from "./plan.ts";
import { checkedStructuralOf, structuralOf } from "./structural.ts";
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
 * A plain text element, used as a `many` slot and through a `suspend` member.
 */
const Item = Element("item", { content: text(Schema.String) });

/**
 * A text element in a declared namespace.
 */
const Mark = namespaces({ m: MARK }).Element("m:mark", { content: text(Schema.String) });

/**
 * An empty element whose attribute the checked wrapper constrains.
 */
const Count = Element("count", { attributes: { n: Schema.Int } });

/**
 * `Count` wrapped in a check: the slot stays structural and carries the check, so a zero count
 * fails.
 */
const PositiveCount = Count.check(
  Schema.makeFilter((count: { readonly n: number }) => count.n > 0),
);

/**
 * A text element the wrapped member and slot decode to their text.
 */
const Note = Element("note", { content: text(Schema.String) });

/**
 * `Note` decoded to its text: the user's model is a `string`.
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
 * The decoded value of a `Countdown`.
 */
interface Countdown {
  readonly n: number;
  readonly next: readonly Countdown[];
}

/**
 * A checked recursive element: each `next` child counts lower than its parent, so the check runs
 * at every depth through the `suspend` reference to itself.
 */
const CheckedCountdown: ElementCodec<"countdown", Countdown> = Element("countdown", {
  attributes: { n: Schema.Int },
  content: elements({ next: many(suspend("countdown", () => CheckedCountdown)) }),
}).check(
  Schema.makeFilter((countdown: Countdown) =>
    countdown.next.every((child) => child.n < countdown.n),
  ),
);

/**
 * Every `elements` slot shape: `one`, `many`, `optional`, a namespaced child, a checked child, a
 * `decodeTo` child, and a recursive child.
 */
const Box = Element("box", {
  attributes: { id: Schema.String },
  content: elements({
    count: PositiveCount,
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
 * Closed `mixed` content with a named, a namespaced, a `decodeTo`, and a `suspend` member.
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
 * The resolved `count` child the `Box` element row decodes; the checked slot carries it to the
 * structural codec as the plain object `{ n: "5" }`.
 */
const count = node("count", { n: "5" });

/**
 * The opaque `note` slot as both sides carry it.
 */
const note = node("note", {}, ["N"]);

/**
 * The plain object the builder would emit for the `Box` row.
 */
const boxPlain = {
  count: { n: "5" },
  id: "b1",
  items: [{ $text: "a" }, { $text: "b" }],
  leaf: { $text: "hi", "data-x": "2", n: "1" },
  mark: { $text: "mk" },
  note,
  tree: { kids: [{ kids: [], label: "kid" }], label: "root" },
};

/**
 * The plain object the builder would emit for the `Para` row.
 */
const paraPlain = {
  $children: [
    { _tag: "$text", text: "t1" },
    { _tag: "leaf", value: { $text: "L", n: "2" } },
    { _tag: "$text", text: " " },
    { _tag: "m:mark", value: { $text: "M" } },
    { _tag: "note", value: note },
    { _tag: "item", value: { $text: "I" } },
  ],
};

/**
 * One row per content shape: the element, a resolved element, and the plain object the builder
 * would emit for it.
 */
const rows: readonly (readonly [string, Schema.Top, ResolvedElement, unknown])[] = [
  [
    "elements content with every slot shape",
    Box,
    node("box", { id: "b1" }, [
      node("leaf", { "data-x": "2", n: "1" }, ["hi"]),
      node("item", {}, ["a"]),
      node("item", {}, ["b"]),
      node(`{${MARK}}mark`, {}, ["mk"]),
      count,
      note,
      node("tree", { label: "root" }, [node("tree", { label: "kid" })]),
    ]),
    boxPlain,
  ],
  [
    "open elements content",
    OpenBox,
    node("open-box", {}, [node("leaf", { n: "7" }, ["x"]), node("other", { a: "1" }, ["y"])]),
    { "*": [node("other", { a: "1" }, ["y"])], leaf: { $text: "x", n: "7" } },
  ],
  [
    "closed mixed content",
    Para,
    node("p", {}, [
      "t1",
      node("leaf", { n: "2" }, ["L"]),
      " ",
      node(`{${MARK}}mark`, {}, ["M"]),
      note,
      node("item", {}, ["I"]),
    ]),
    paraPlain,
  ],
  [
    "open mixed content",
    OpenPara,
    node("open-p", {}, ["x", node("leaf", { n: "1" }, ["a"]), node("zz", {}, ["q"])]),
    {
      $children: [
        { _tag: "$text", text: "x" },
        { _tag: "leaf", value: { $text: "a", n: "1" } },
        { _tag: "*", element: node("zz", {}, ["q"]) },
      ],
    },
  ],
];

describe("structuralOf", () => {
  it.effect.each(rows)(
    "decodes and encodes %s as the element codec does",
    ([, def, element, plain]) =>
      Effect.gen(function* roundTrips() {
        const codec = serviceless(structuralOf(planFor(def)));
        const expected = yield* Schema.decodeUnknownEffect(plainElement(def))(element);
        const value = yield* Schema.decodeUnknownEffect(codec)(plain);

        expect(value).toStrictEqual(expected);
        expect(yield* Schema.encodeUnknownEffect(codec)(value)).toStrictEqual(plain);
      }),
  );

  it.effect("keeps the user's model in a wrapped slot and member", () =>
    Effect.gen(function* wrapped() {
      const box = yield* Schema.decodeUnknownEffect(serviceless(structuralOf(planFor(Box))))(
        boxPlain,
      );

      const para = yield* Schema.decodeUnknownEffect(serviceless(structuralOf(planFor(Para))))(
        paraPlain,
      );

      expect(box).toMatchObject({ count: { n: 5 }, note: "N" });
      expect(para).toHaveProperty(["$children", 4], { _tag: "note", value: "N" });
    }),
  );

  it.effect("fails a value the wrapped child's check rejects", () =>
    Effect.gen(function* rejects() {
      const codec = serviceless(structuralOf(planFor(Box)));

      const exit = yield* Schema.decodeUnknownEffect(codec)({
        ...boxPlain,
        count: { n: "0" },
      }).pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("carries a recursive element's check onto every depth", () =>
    Effect.gen(function* recursive() {
      const plan = planFor(CheckedCountdown);
      const codec = serviceless(checkedStructuralOf(CheckedCountdown, plan));

      const element = node("countdown", { n: "3" }, [
        node("countdown", { n: "2" }, [node("countdown", { n: "1" })]),
      ]);

      const expected = yield* Schema.decodeUnknownEffect(plainElement(CheckedCountdown))(element);

      const value = yield* Schema.decodeUnknownEffect(codec)({
        n: "3",
        next: [{ n: "2", next: [{ n: "1", next: [] }] }],
      });

      const deep = yield* Schema.decodeUnknownEffect(codec)({
        n: "3",
        next: [{ n: "2", next: [{ n: "5", next: [] }] }],
      }).pipe(Effect.exit);

      expect(value).toStrictEqual(expected);
      expect(Exit.isFailure(deep)).toBe(true);
      expect(checkedStructuralOf(CheckedCountdown, plan)).toBe(
        checkedStructuralOf(CheckedCountdown, plan),
      );
    }),
  );

  it("caches one codec per plan", () => {
    const plan = planFor(Box);

    expect(structuralOf(plan)).toBe(structuralOf(plan));
  });

  it.each(rows)("leaves the AST of %s untouched", (_, def) => {
    const { ast } = def;
    const { annotations } = ast;

    structuralOf(planFor(def));

    expect(def.ast).toBe(ast);
    expect(def.ast.annotations).toBe(annotations);
  });
});
