import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import type * as SchemaIssue from "effect/SchemaIssue";

import { compile, isBlank } from "./compile.ts";
import { Element as declare, namespaces } from "./dsl.ts";
import { isResolvedElement } from "./element.ts";
import type { ResolvedElement } from "./element.ts";
import { XML, markerOf, mixed, planOf, text } from "./plan.ts";
import type { Plan } from "./plan.ts";

/**
 * The time budget of the 300,000-element stack-depth regressions. They guard against a call stack
 * overflow, not a duration, and take about 1.3 s alone, so Vitest's 5 s default fails them when the
 * full suite shares a loaded machine.
 */
const STACK_DEPTH_TIMEOUT_MS = 30_000;

const plan: Plan = {
  attributes: [
    { key: "id", name: "id", schema: Schema.String },
    { key: "n", name: "n", schema: Schema.Int },
  ],
  content: { mode: "empty" },
  data: undefined,
  name: "{u}item",
  prefixes: { "": "u" },
  wire: "item",
};

const element = (
  attributes: Readonly<Record<string, string>>,
  children: ResolvedElement["children"] = [],
): ResolvedElement => ({ attributes, children, name: "{u}item" });

/**
 * The compiled codec under test. `compile` types its services as `unknown` because plan schemas
 * are `Schema.Top`; this plan's attribute schemas need none, so the test narrows them to `never`.
 */
// SAFETY: services exist only at the type level; `Schema.String` and `Schema.Int` require none.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- no runtime guard can observe services.
const codec = compile(plan) as Schema.Codec<unknown, ResolvedElement>;

const decode = Schema.decodeUnknownEffect(codec);

/**
 * Decode an element expected to fail and return the rendered error message.
 *
 * @param input - The element to decode.
 * @returns The `SchemaError` message.
 */
const failure = (input: ResolvedElement) =>
  decode(input).pipe(
    Effect.flip,
    Effect.map((error) => error.message),
  );

describe("compile: empty content and attributes", () => {
  it.effect("decodes declared attributes and ignores whitespace-only children", () =>
    Effect.gen(function* decodesAttributes() {
      const value = yield* decode(element({ id: "a", n: "3" }, ["\n  "]));

      expect(value).toEqual({ id: "a", n: 3 });
    }),
  );

  it.effect("encodes back to an element with string attributes and no children", () =>
    Effect.gen(function* encodesAttributes() {
      const encoded = yield* Schema.encodeUnknownEffect(codec)({ id: "a", n: 3 });

      expect(encoded).toEqual({ attributes: { id: "a", n: "3" }, children: [], name: "{u}item" });
    }),
  );

  it.effect("fails a non-numeric attribute naming a finite number", () =>
    Effect.gen(function* failsNumber() {
      const message = yield* failure(element({ id: "a", n: "x" }));

      expect(message).toMatch(/finite/iu);
    }),
  );

  it.effect("fails an undeclared attribute naming the declared set", () =>
    Effect.gen(function* failsUndeclared() {
      const message = yield* failure(element({ extra: "1", id: "a", n: "3" }));

      expect(message).toContain("extra");
      expect(message).toContain("id, n");
    }),
  );

  it.effect("fails a non-blank text child under empty content", () =>
    Effect.gen(function* failsText() {
      const message = yield* failure(element({ id: "a", n: "3" }, ["hello"]));

      expect(message).toMatch(/empty/iu);
    }),
  );
});

describe("compile: marker", () => {
  it("annotates the codec with the plan's name, wire, and plan thunk", () => {
    const compiled = compile(plan);
    const marker = markerOf(compiled);

    expect({ name: marker?.name, wire: marker?.wire }).toEqual({
      name: plan.name,
      wire: plan.wire,
    });
    expect(planOf(compiled)).toBe(plan);
  });
});

/**
 * Narrow a compiled codec's services to `never` for plans whose schemas need none.
 *
 * @param target - The plan to compile.
 * @returns The compiled codec typed without services.
 */
// SAFETY: services exist only at the type level; every schema in these plans requires none.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- no runtime guard can observe services.
const compileTest = (target: Plan) => compile(target) as Schema.Codec<unknown, ResolvedElement>;

/**
 * Build a plan with no attributes for the element `{u}<wire>` and the given content.
 *
 * @param wire - The authored local name.
 * @param content - The content plan.
 * @returns The element plan.
 */
const bare = (wire: string, content: Plan["content"]): Plan => ({
  attributes: [],
  content,
  data: undefined,
  name: `{u}${wire}`,
  prefixes: { "": "u" },
  wire,
});

/**
 * Build a resolved element in the `u` namespace.
 *
 * @param wire - The local name.
 * @param children - The element's children.
 * @param attributes - The element's attributes.
 * @returns The resolved element.
 */
const node = (
  wire: string,
  children: ResolvedElement["children"] = [],
  attributes: Readonly<Record<string, string>> = {},
): ResolvedElement => ({ attributes, children, name: `{u}${wire}` });

/**
 * Decode `input` with `target` expecting a failure and return the rendered message.
 *
 * @param target - The codec under test.
 * @param input - The element to decode.
 * @returns The `SchemaError` message.
 */
const failureOf = (target: Schema.Codec<unknown, ResolvedElement>, input: ResolvedElement) =>
  Schema.decodeUnknownEffect(target)(input).pipe(
    Effect.flip,
    Effect.map((error) => error.message),
  );

const textCodec = compileTest(bare("p", { key: "$text", mode: "text", schema: Schema.String }));

const intCodec = compileTest(bare("n", { key: "$text", mode: "text", schema: Schema.Int }));

describe("compile: text content", () => {
  it.effect("joins string children into the text slot", () =>
    Effect.gen(function* joinsText() {
      const value = yield* Schema.decodeUnknownEffect(textCodec)(node("p", ["a", "b"]));

      expect(value).toEqual({ $text: "ab" });
    }),
  );

  it.effect("keeps a whitespace-only run", () =>
    Effect.gen(function* keepsWhitespace() {
      const value = yield* Schema.decodeUnknownEffect(textCodec)(node("p", [" "]));

      expect(value).toEqual({ $text: " " });
    }),
  );

  it.effect("fails an element child naming the text-only content", () =>
    Effect.gen(function* failsElementChild() {
      const message = yield* failureOf(textCodec, node("p", ["a", node("b")]));

      expect(message).toContain("<b>");
      expect(message).toMatch(/text only/iu);
    }),
  );

  it.effect("decodes the text through the slot schema", () =>
    Effect.gen(function* decodesInt() {
      const value = yield* Schema.decodeUnknownEffect(intCodec)(node("n", ["3"]));

      expect(value).toEqual({ $text: 3 });
    }),
  );

  it.effect("encodes the text slot back to one string child", () =>
    Effect.gen(function* encodesText() {
      const encoded = yield* Schema.encodeUnknownEffect(intCodec)({ $text: 3 });

      expect(encoded).toEqual(node("n", ["3"]));
    }),
  );

  it.effect("encodes an empty text slot with no children", () =>
    Effect.gen(function* encodesEmpty() {
      const encoded = yield* Schema.encodeUnknownEffect(textCodec)({ $text: "" });

      expect(encoded).toEqual(node("p"));
    }),
  );
});

const titleCodec = compileTest(
  bare("title", { key: "$text", mode: "text", schema: Schema.String }),
);

const itemCodec = compileTest({
  ...bare("item", { mode: "empty" }),
  attributes: [{ key: "id", name: "id", schema: Schema.String }],
});

const listCodec = compileTest(
  bare("list", {
    children: [
      {
        cardinality: "optional",
        key: "title",
        name: "{u}title",
        schema: titleCodec,
        wire: "title",
      },
      { cardinality: "many", key: "item", name: "{u}item", schema: itemCodec, wire: "item" },
    ],
    mode: "elements",
    open: false,
  }),
);

/**
 * A codec whose one `many` slot holds empty `<leaf>` elements, sized only by the encoded value.
 */
const bagCodec = compileTest(
  bare("bag", {
    children: [
      {
        cardinality: "many",
        key: "leaf",
        name: "{u}leaf",
        schema: compileTest(bare("leaf", { mode: "empty" })),
        wire: "leaf",
      },
    ],
    mode: "elements",
    open: false,
  }),
);

const list = node("list", [
  "\n  ",
  node("title", ["Hi"]),
  "\n  ",
  node("item", [], { id: "1" }),
  "\n  ",
  node("item", [], { id: "2" }),
  "\n",
]);

describe("compile: elements content", () => {
  it.effect("groups children into typed slots and drops whitespace", () =>
    Effect.gen(function* decodesSlots() {
      const value = yield* Schema.decodeUnknownEffect(listCodec)(list);

      expect(value).toEqual({ item: [{ id: "1" }, { id: "2" }], title: { $text: "Hi" } });
    }),
  );

  it.effect("round-trips to the children in declaration order without whitespace", () =>
    Effect.gen(function* roundTrips() {
      const value = yield* Schema.decodeUnknownEffect(listCodec)(list);
      const encoded = yield* Schema.encodeUnknownEffect(listCodec)(value);

      expect(encoded).toEqual(
        node("list", [
          node("title", ["Hi"]),
          node("item", [], { id: "1" }),
          node("item", [], { id: "2" }),
        ]),
      );
    }),
  );

  it.effect("decodes an absent optional slot and an empty many slot", () =>
    Effect.gen(function* decodesAbsent() {
      const value = yield* Schema.decodeUnknownEffect(listCodec)(node("list", ["\n"]));

      expect(value).toEqual({ item: [] });
    }),
  );

  it.effect("fails non-blank text naming the text", () =>
    Effect.gen(function* failsStray() {
      const message = yield* failureOf(listCodec, node("list", ["stray"]));

      expect(message).toContain("stray");
    }),
  );

  it.effect("fails an unknown child naming the expected wire names", () =>
    Effect.gen(function* failsUnknown() {
      const message = yield* failureOf(listCodec, node("list", [node("other")]));

      expect(message).toContain("<other>");
      expect(message).toContain("title, item");
    }),
  );

  it.effect("fails a second child in an optional slot", () =>
    Effect.gen(function* failsSecond() {
      const message = yield* failureOf(
        listCodec,
        node("list", [node("title", ["a"]), node("title", ["b"])]),
      );

      expect(message).toMatch(/at most one <title>/iu);
    }),
  );

  it.effect("decodes a many slot holding 20000 children", () =>
    Effect.gen(function* decodesMany() {
      const items = Array.from({ length: 20_000 }, (_, i) => node("item", [], { id: String(i) }));
      const value = yield* Schema.decodeUnknownEffect(listCodec)(node("list", items));

      expect(value).toMatchObject({ item: { length: 20_000 } });
    }),
  );

  it.effect(
    "encodes a many slot holding 300000 children",
    () =>
      Effect.gen(function* encodesMany() {
        const value = { leaf: Array.from({ length: 300_000 }, () => ({})) };
        const encoded = yield* Schema.encodeUnknownEffect(bagCodec)(value);

        expect(encoded.children.filter(isResolvedElement)).toHaveLength(300_000);
      }),
    STACK_DEPTH_TIMEOUT_MS,
  );
});

const stringData = compileTest({
  ...bare("item", { mode: "empty" }),
  attributes: [{ key: "id", name: "id", schema: Schema.String }],
  data: Schema.String,
});

const intData = compileTest({ ...bare("item", { mode: "empty" }), data: Schema.Int });

describe("compile: data-* attributes", () => {
  it.effect("decodes a data-* attribute under its own key beside the declared attributes", () =>
    Effect.gen(function* decodesData() {
      const value = yield* Schema.decodeUnknownEffect(stringData)(
        node("item", [], { "data-foo": "1", id: "a" }),
      );

      expect(value).toEqual({ "data-foo": "1", id: "a" });
    }),
  );

  it.effect("encodes every data-* key back to an attribute", () =>
    Effect.gen(function* encodesData() {
      const encoded = yield* Schema.encodeUnknownEffect(stringData)({ "data-foo": "1", id: "a" });

      expect(encoded).toEqual(node("item", [], { "data-foo": "1", id: "a" }));
    }),
  );

  it.effect("decodes a data-* value through the data schema", () =>
    Effect.gen(function* decodesIntData() {
      const value = yield* Schema.decodeUnknownEffect(intData)(node("item", [], { "data-n": "2" }));

      expect(value).toEqual({ "data-n": 2 });
    }),
  );

  it.effect("fails a non-numeric data-* value naming a finite number", () =>
    Effect.gen(function* failsIntData() {
      const message = yield* failureOf(intData, node("item", [], { "data-n": "x" }));

      expect(message).toMatch(/finite/iu);
    }),
  );

  it.effect("rejects a data-* attribute naming the declared set when the plan has no data", () =>
    Effect.gen(function* failsUndeclaredData() {
      const message = yield* failure(element({ "data-foo": "1", id: "a", n: "3" }));

      expect(message).toContain("data-foo");
      expect(message).toContain("id, n");
    }),
  );

  it.effect(
    "lists the data-* group after the declared attributes for an undeclared attribute",
    () =>
      Effect.gen(function* listsDataGroup() {
        const message = yield* failureOf(stringData, node("item", [], { foo: "1", id: "a" }));

        expect(message).toMatch(/declared attributes: id, data-\*/u);
      }),
  );

  it.effect("lists only the data-* group when it is the sole declaration", () =>
    Effect.gen(function* listsOnlyDataGroup() {
      const message = yield* failureOf(intData, node("item", [], { foo: "1" }));

      expect(message).toMatch(/declared attributes: data-\*/u);
      expect(message).not.toMatch(/\(none\)/u);
    }),
  );

  it.effect("omits the data-* group from the declared set when the plan has no data", () =>
    Effect.gen(function* omitsDataGroup() {
      const message = yield* failure(element({ foo: "1", id: "a", n: "3" }));

      expect(message).toMatch(/declared attributes: id, n\./u);
      expect(message).not.toContain("data-*");
    }),
  );
});

const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

const MATHML = "http://www.w3.org/1998/Math/MathML";

/**
 * Build a plan with no attributes in the given namespace.
 *
 * @param uri - The namespace URI.
 * @param local - The local name.
 * @param wire - The authored element name.
 * @param content - The content plan.
 * @returns The element plan.
 */
const named = (uri: string, local: string, wire: string, content: Plan["content"]): Plan => ({
  attributes: [],
  content,
  data: undefined,
  name: `{${uri}}${local}`,
  prefixes: {},
  wire,
});

/**
 * Build a resolved element with a Clark name.
 *
 * @param name - The Clark name.
 * @param children - The element's children.
 * @param attributes - The element's attributes.
 * @returns The resolved element.
 */
const clarkNode = (
  name: string,
  children: ResolvedElement["children"] = [],
  attributes: Readonly<Record<string, string>> = {},
): ResolvedElement => ({ attributes, children, name });

const pPlan = named(QTI, "p", "p", { key: "$text", mode: "text", schema: Schema.String });

const mathPlan = named(MATHML, "math", "m:math", {
  key: "$text",
  mode: "text",
  schema: Schema.String,
});

const pIntPlan: Plan = { ...pPlan, attributes: [{ key: "n", name: "n", schema: Schema.Int }] };

/**
 * Build the `mixed` member entry of a compiled plan.
 *
 * @param target - The member plan.
 * @returns The member entry, keyed by Clark name and tagged by wire name.
 */
const member = (target: Plan) => ({
  name: target.name,
  schema: compileTest(target),
  wire: target.wire,
});

/**
 * Build a `mixed` plan for `{QTI}body` over the given members.
 *
 * @param members - The member entries.
 * @param open - Whether the body admits undeclared child elements.
 * @returns The body plan.
 */
const bodyPlan = (
  members: Extract<Plan["content"], { mode: "mixed" }>["members"],
  open = false,
): Plan => named(QTI, "body", "body", { key: "$children", members, mode: "mixed", open });

const bodyCodec = compileTest(bodyPlan([member(pPlan), member(mathPlan)]));

const divPlan = named(QTI, "div", "div", {
  key: "$children",
  members: [member(pIntPlan)],
  mode: "mixed",
  open: false,
});

const Div = compileTest(divPlan);

const divMember = {
  name: divPlan.name,
  schema: Schema.suspend(() => Div).annotate({
    [XML]: { name: divPlan.name, plan: () => divPlan, wire: divPlan.wire },
  }),
  wire: divPlan.wire,
};

/**
 * One leaf of an issue tree with the path of the pointers above it.
 */
interface Located {
  readonly path: readonly PropertyKey[];
  readonly leaf: SchemaIssue.Leaf;
}

/**
 * Collect every leaf of an issue tree with its pointer path.
 *
 * @param issue - The issue tree.
 * @param path - The path of the pointers above `issue`.
 * @returns The located leaves in tree order.
 */
const leavesOf = (issue: SchemaIssue.Issue, path: readonly PropertyKey[] = []): Located[] => {
  if (issue._tag === "Pointer") {
    return leavesOf(issue.issue, [...path, ...issue.path]);
  }

  if (issue._tag === "Filter" || issue._tag === "Encoding") {
    return leavesOf(issue.issue, path);
  }

  if (issue._tag === "Composite" || issue._tag === "AnyOf") {
    return issue.issues.flatMap((inner) => leavesOf(inner, path));
  }

  return [{ leaf: issue, path }];
};

/**
 * Collect every `AnyOf` node of an issue tree.
 *
 * @param issue - The issue tree.
 * @returns The `AnyOf` nodes in tree order.
 */
const anyOfsOf = (issue: SchemaIssue.Issue): SchemaIssue.AnyOf[] => {
  if (issue._tag === "Pointer" || issue._tag === "Filter" || issue._tag === "Encoding") {
    return anyOfsOf(issue.issue);
  }

  if (issue._tag === "Composite") {
    return issue.issues.flatMap(anyOfsOf);
  }

  return issue._tag === "AnyOf" ? [issue, ...issue.issues.flatMap(anyOfsOf)] : [];
};

/**
 * Decode `input` with `target` expecting a failure and return the issue tree.
 *
 * @param target - The codec under test.
 * @param input - The element to decode.
 * @returns The failure's issue tree.
 */
const issueOf = (target: Schema.Codec<unknown, ResolvedElement>, input: ResolvedElement) =>
  Schema.decodeUnknownEffect(target)(input).pipe(
    Effect.flip,
    Effect.map((error) => error.issue),
  );

/**
 * Render a located leaf as a comparable string: its tag, path, and message.
 *
 * @param located - The located leaf.
 * @returns The rendered leaf.
 */
const render = (located: Located): string =>
  `${located.leaf._tag} ${located.path.map(String).join("/")}`;

const badP = clarkNode(`{${QTI}}p`, ["x"], { n: "x" });

const body = (children: ResolvedElement["children"]) => clarkNode(`{${QTI}}body`, children);

describe("compile: mixed content", () => {
  const children: ResolvedElement["children"] = [
    "a ",
    clarkNode(`{${QTI}}p`, ["para"]),
    " ",
    clarkNode(`{${MATHML}}math`, ["x"]),
  ];

  it.effect("decodes text and members to items tagged by wire name, keeping whitespace", () =>
    Effect.gen(function* decodesMixed() {
      const value = yield* Schema.decodeUnknownEffect(bodyCodec)(body(children));

      expect(value).toEqual({
        $children: [
          { _tag: "$text", text: "a " },
          { _tag: "p", value: { $text: "para" } },
          { _tag: "$text", text: " " },
          { _tag: "m:math", value: { $text: "x" } },
        ],
      });
    }),
  );

  it.effect("encodes the items back to the same children", () =>
    Effect.gen(function* encodesMixed() {
      const value = yield* Schema.decodeUnknownEffect(bodyCodec)(body(children));
      const encoded = yield* Schema.encodeUnknownEffect(bodyCodec)(value);

      expect(encoded).toEqual(body(children));
    }),
  );

  it.effect("tags a text run $text, apart from a member element named text", () =>
    Effect.gen(function* textMember() {
      const textPlan = named(QTI, "text", "text", {
        key: "$text",
        mode: "text",
        schema: Schema.String,
      });

      const textBody = compileTest(bodyPlan([member(textPlan)]));
      const input = body(["run", clarkNode(`{${QTI}}text`, ["el"])]);
      const value = yield* Schema.decodeUnknownEffect(textBody)(input);

      expect(value).toEqual({
        $children: [
          { _tag: "$text", text: "run" },
          { _tag: textPlan.wire, value: { $text: "el" } },
        ],
      });

      const encoded = yield* Schema.encodeUnknownEffect(textBody)(value);

      expect(encoded).toEqual(input);
    }),
  );

  it.effect("R2: a failing named member reports one leaf, from that member only", () =>
    Effect.gen(function* r2Named() {
      const pIntBody = compileTest(bodyPlan([member(pIntPlan), member(mathPlan)]));
      const issue = yield* issueOf(pIntBody, body(["a ", badP]));
      const leaves = leavesOf(issue);

      expect(leaves).toHaveLength(1);
      expect(leaves[0]?.path).toContain("n");
      expect(anyOfsOf(issue).filter((branch) => branch.issues.length > 1)).toEqual([]);
    }),
  );

  it.effect("R2: a suspend member adds at most its own name mismatch, in any authored order", () =>
    Effect.gen(function* r2Suspend() {
      const last = compileTest(bodyPlan([member(pIntPlan), member(mathPlan), divMember]));
      const first = compileTest(bodyPlan([divMember, member(pIntPlan), member(mathPlan)]));

      const valid = body([
        "a ",
        clarkNode(`{${QTI}}p`, ["b"], { n: "1" }),
        clarkNode(`{${QTI}}div`, [clarkNode(`{${QTI}}p`, ["c"], { n: "2" })]),
      ]);

      const lastValue = yield* Schema.decodeUnknownEffect(last)(valid);
      const firstValue = yield* Schema.decodeUnknownEffect(first)(valid);

      expect(firstValue).toEqual(lastValue);
      expect(lastValue).toEqual({
        $children: [
          { _tag: "$text", text: "a " },
          { _tag: "p", value: { $text: "b", n: 1 } },
          { _tag: "div", value: { $children: [{ _tag: "p", value: { $text: "c", n: 2 } }] } },
        ],
      });

      const lastIssue = yield* issueOf(last, body([badP]));
      const firstIssue = yield* issueOf(first, body([badP]));
      const leaves = leavesOf(lastIssue);
      const memberLeaves = leaves.filter((located) => located.path.at(-1) !== "name");
      const branching = anyOfsOf(lastIssue).filter((branch) => branch.issues.length > 1);

      expect(memberLeaves).toHaveLength(1);
      expect(memberLeaves[0]?.path).toContain("n");
      expect(leaves.length).toBeLessThanOrEqual(2);
      expect(branching.length).toBeLessThanOrEqual(1);
      expect(branching.every((branch) => branch.issues.length === 2)).toBe(true);
      expect(leavesOf(firstIssue).map(render)).toEqual(leaves.map(render));
    }),
  );
});

const video = clarkNode(
  `{${QTI}}video`,
  [
    clarkNode(`{${QTI}}source`, [], { src: "a.mp4" }),
    clarkNode(`{${QTI}}source`, [], { src: "a.webm" }),
    clarkNode(`{${QTI}}track`, [], { kind: "captions" }),
  ],
  { controls: "controls" },
);

const openBody = compileTest(bodyPlan([member(pIntPlan)], true));

const closedBody = compileTest(bodyPlan([member(pIntPlan)]));

describe("compile: open mixed content", () => {
  const children: ResolvedElement["children"] = [clarkNode(`{${QTI}}p`, ["a"], { n: "1" }), video];

  it.effect("decodes an undeclared element to a * item holding the whole element", () =>
    Effect.gen(function* decodesOpen() {
      const value = yield* Schema.decodeUnknownEffect(openBody)(body(children));

      expect(value).toEqual({
        $children: [
          { _tag: "p", value: { $text: "a", n: 1 } },
          { _tag: "*", element: video },
        ],
      });
    }),
  );

  it.effect("encodes the * item back to the same element", () =>
    Effect.gen(function* encodesOpen() {
      const value = yield* Schema.decodeUnknownEffect(openBody)(body(children));
      const encoded = yield* Schema.encodeUnknownEffect(openBody)(value);

      expect(encoded).toEqual(body(children));
    }),
  );

  it.effect("the closed body still rejects the undeclared element: no member applies", () =>
    Effect.gen(function* closedRejects() {
      const issue = yield* issueOf(closedBody, body(children));
      const branches = anyOfsOf(issue);

      expect(branches.some((branch) => branch.issues.length === 0)).toBe(true);
    }),
  );

  it.effect("lock 3: a failing declared member keeps its issue beside the guard's", () =>
    Effect.gen(function* lock3() {
      const issue = yield* issueOf(openBody, body([badP]));
      const leaves = leavesOf(issue);
      const branching = anyOfsOf(issue).filter((branch) => branch.issues.length > 1);

      expect(branching).toHaveLength(1);
      expect(branching[0]?.issues).toHaveLength(2);
      expect(leaves.some((located) => located.path.includes("n"))).toBe(true);
      expect(leaves.some((located) => located.path.at(-1) === "name")).toBe(true);
    }),
  );

  it.effect("an unknown element reaches the generic member alone", () =>
    Effect.gen(function* unknownAlone() {
      const value = yield* Schema.decodeUnknownEffect(openBody)(body([video]));

      expect(value).toEqual({ $children: [{ _tag: "*", element: video }] });

      const malformed = { attributes: { n: 1 }, children: [], name: `{${QTI}}video` };
      const input = { attributes: {}, children: [malformed], name: `{${QTI}}body` };

      const issue = yield* Schema.decodeUnknownEffect(openBody)(input).pipe(
        Effect.flip,
        Effect.map((error) => error.issue),
      );

      const branches = anyOfsOf(issue);

      expect(branches.length).toBeGreaterThan(0);
      expect(branches.every((branch) => branch.issues.length <= 1)).toBe(true);
    }),
  );

  it.effect("keeps whitespace-only text under open mixed", () =>
    Effect.gen(function* keepsWhitespace() {
      const value = yield* Schema.decodeUnknownEffect(openBody)(body([" ", video, "\n"]));

      expect(value).toEqual({
        $children: [
          { _tag: "$text", text: " " },
          { _tag: "*", element: video },
          { _tag: "$text", text: "\n" },
        ],
      });
    }),
  );

  it.effect("refuses on encode a * item named after a declared member", () =>
    Effect.gen(function* refusesDeclared() {
      const item = { _tag: "*", element: clarkNode(`{${QTI}}p`, ["a"], { n: "1" }) };

      const error = yield* Schema.encodeUnknownEffect(openBody)({ $children: [item] }).pipe(
        Effect.flip,
      );

      expect(leavesOf(error.issue).some((located) => located.path.at(-1) === "name")).toBe(true);
    }),
  );
});

const aPlan = named(QTI, "a", "a", { mode: "empty" });

/**
 * Build an `elements` plan for `{QTI}group` with the one slot `a`.
 *
 * @param open - Whether the group admits undeclared child elements.
 * @returns The group plan.
 */
const groupPlan = (open: boolean): Plan =>
  named(QTI, "group", "group", {
    children: [
      { cardinality: "one", key: "a", name: aPlan.name, schema: compileTest(aPlan), wire: "a" },
    ],
    mode: "elements",
    open,
  });

const openGroup = compileTest(groupPlan(true));

const closedGroup = compileTest(groupPlan(false));

/**
 * An open `elements` codec with no declared slot, so every child it encodes comes from `*`.
 */
const openBag = compileTest(
  named(QTI, "bag", "bag", { children: [], mode: "elements", open: true }),
);

const group = (children: ResolvedElement["children"]) => clarkNode(`{${QTI}}group`, children);

const a = clarkNode(`{${QTI}}a`);

const z = clarkNode(`{${QTI}}z`, ["zed"], { k: "1" });

const y = clarkNode(`{${QTI}}y`);

describe("compile: open elements content", () => {
  it.effect("decodes undeclared children to the * slot in document order", () =>
    Effect.gen(function* decodesOpen() {
      const value = yield* Schema.decodeUnknownEffect(openGroup)(group([a, z, y]));

      expect(value).toEqual({ "*": [z, y], a: {} });
    }),
  );

  it.effect("encodes the declared slots first, then the * slot in its stored order", () =>
    Effect.gen(function* encodesOpen() {
      const zy = yield* Schema.encodeUnknownEffect(openGroup)({ "*": [z, y], a: {} });
      const yz = yield* Schema.encodeUnknownEffect(openGroup)({ "*": [y, z], a: {} });

      expect(zy.children.map((child) => (Predicate.isString(child) ? child : child.name))).toEqual([
        a.name,
        z.name,
        y.name,
      ]);
      expect(yz).toEqual(group([a, y, z]));
    }),
  );

  it.effect("drops whitespace-only text and leaves the * slot empty", () =>
    Effect.gen(function* dropsWhitespace() {
      const value = yield* Schema.decodeUnknownEffect(openGroup)(group(["\n  ", a, " "]));

      expect(value).toEqual({ "*": [], a: {} });
    }),
  );

  it.effect("fails non-blank text naming the text", () =>
    Effect.gen(function* failsStray() {
      const message = yield* failureOf(openGroup, group(["stray", a]));

      expect(message).toContain("stray");
    }),
  );

  it.effect("the closed group still fails an undeclared child naming the expected set", () =>
    Effect.gen(function* closedRejects() {
      const message = yield* failureOf(closedGroup, group([a, z]));

      expect(message).toContain(z.name);
      expect(message).toMatch(/declared children: a\./u);
    }),
  );

  it.effect(
    "encodes a * slot holding 300000 elements",
    () =>
      Effect.gen(function* encodesOpenMany() {
        const encoded = yield* Schema.encodeUnknownEffect(openBag)({
          "*": Array.from({ length: 300_000 }, () => y),
        });

        expect(encoded.children.filter(isResolvedElement)).toHaveLength(300_000);
      }),
    STACK_DEPTH_TIMEOUT_MS,
  );
});

const XSI = "http://www.w3.org/2001/XMLSchema-instance";

const QTI_NS = "urn:qti";

const qtiItemCodec = compileTest({
  attributes: [{ key: "id", name: "id", schema: Schema.String }],
  content: { mode: "empty" },
  data: undefined,
  name: `{${QTI}}item`,
  prefixes: { "": QTI, xsi: XSI },
  wire: "item",
});

const urnItemPlan: Plan = {
  attributes: [{ key: "id", name: "id", schema: Schema.String }],
  content: { mode: "empty" },
  data: undefined,
  name: `{${QTI_NS}}item`,
  prefixes: { "": QTI_NS },
  wire: "item",
};

const urnParagraphCodec = compileTest({
  attributes: [],
  content: {
    children: [
      {
        cardinality: "one",
        key: "item",
        name: urnItemPlan.name,
        schema: compileTest(urnItemPlan),
        wire: "item",
      },
    ],
    mode: "elements",
    open: false,
  },
  data: undefined,
  name: `{${QTI_NS}}p`,
  prefixes: { "": QTI_NS },
  wire: "p",
});

/**
 * Decode `input` with `target` expecting a failure and return the issue's own message, without the
 * pointer-path line `SchemaError` appends; the caller-facing error renders that path as an XPath.
 *
 * @param target - The codec under test.
 * @param input - The element to decode.
 * @returns The first line of the `SchemaError` message.
 */
const headlineOf = (target: Schema.Codec<unknown, ResolvedElement>, input: ResolvedElement) =>
  failureOf(target, input).pipe(Effect.map((message) => message.split("\n")[0] ?? ""));

describe("compile: names in messages", () => {
  it.effect("spells an undeclared attribute under its authored prefix", () =>
    Effect.gen(function* spellsAttribute() {
      const message = yield* headlineOf(
        qtiItemCodec,
        clarkNode(`{${QTI}}item`, [], { id: "1", [`{${XSI}}schemaLocation`]: "x" }),
      );

      expect(message).toContain("xsi:schemaLocation");
      expect(message).not.toContain(`{${XSI}}`);
    }),
  );

  it.effect("writes out both namespaces when only the namespace tells two children apart", () =>
    Effect.gen(function* spellsNamespaceMismatch() {
      const message = yield* failureOf(
        urnParagraphCodec,
        clarkNode(`{${QTI_NS}}p`, [clarkNode("item", [], { id: "1" })]),
      );

      expect(message).toMatch(/no namespace/u);
      expect(message).toMatch(/urn:qti/u);
    }),
  );
});

describe("compile: reserved content keys", () => {
  it.effect("decodes an attribute keyed text beside the text content under $text", () =>
    Effect.gen(function* attributeBesideText() {
      const Para = declare("p", {
        attributes: { text: Schema.String },
        content: text(Schema.String),
      });

      const input: ResolvedElement = {
        attributes: { text: "ATTR" },
        children: ["BODY"],
        name: "p",
      };

      const value = yield* Schema.decodeUnknownEffect(Para)(input);

      expect(value).toEqual({ $text: "BODY", text: "ATTR" });

      const encoded = yield* Schema.encodeUnknownEffect(Para)(value);

      expect(encoded).toEqual(input);
    }),
  );

  it.effect("tags a mixed text run $text, apart from a member element named text", () =>
    Effect.gen(function* mixedTextRun() {
      const TextMember = declare("text", { content: text(Schema.String) });
      const Body = declare("body", { content: mixed([TextMember]) });

      const input: ResolvedElement = {
        attributes: {},
        children: ["run", { attributes: {}, children: ["el"], name: "text" }],
        name: "body",
      };

      const value = yield* Schema.decodeUnknownEffect(Body)(input);

      expect(value).toEqual({
        $children: [
          { _tag: "$text", text: "run" },
          { _tag: "text", value: { $text: "el" } },
        ],
      });

      const encoded = yield* Schema.encodeUnknownEffect(Body)(value);

      expect(encoded).toEqual(input);
    }),
  );

  it.effect("decodes an attribute keyed children beside the mixed content under $children", () =>
    Effect.gen(function* attributeBesideMixed() {
      const Body = declare("body", {
        attributes: { children: Schema.String },
        content: mixed([]),
      });

      const input: ResolvedElement = {
        attributes: { children: "ATTR" },
        children: ["run"],
        name: "body",
      };

      const value = yield* Schema.decodeUnknownEffect(Body)(input);

      expect(value).toEqual({ $children: [{ _tag: "$text", text: "run" }], children: "ATTR" });

      const encoded = yield* Schema.encodeUnknownEffect(Body)(value);

      expect(encoded).toEqual(input);
    }),
  );
});

/**
 * Decode `input` with `target` synchronously and return the rendered leaves of its failure,
 * or `undefined` when the decode succeeds.
 *
 * @param target - The codec under test.
 * @param input - The element to decode.
 * @returns The rendered leaves of the synchronous failure, or `undefined` on success.
 */
const exitLeavesOf = (target: Schema.Codec<unknown, ResolvedElement>, input: ResolvedElement) => {
  const exit = Schema.decodeUnknownExit(target)(input);

  const schemaError = Exit.isSuccess(exit)
    ? undefined
    : Option.getOrUndefined(Cause.findErrorOption(exit.cause));

  return schemaError === undefined ? undefined : leavesOf(schemaError.issue).map(render);
};

/**
 * Decode `input` with `target` through the fiber run loop expecting a failure and return its
 * rendered leaves.
 *
 * @param target - The codec under test.
 * @param input - The element to decode.
 * @returns The rendered leaves of the failure.
 */
const effectLeavesOf = (target: Schema.Codec<unknown, ResolvedElement>, input: ResolvedElement) =>
  issueOf(target, input).pipe(Effect.map((issue) => leavesOf(issue).map(render)));

/**
 * A codec whose one `one` slot holds a `<list>`, so its items decode two `elements` levels deep.
 */
const docCodec = compileTest(
  bare("doc", {
    children: [
      { cardinality: "one", key: "list", name: "{u}list", schema: listCodec, wire: "list" },
    ],
    mode: "elements",
    open: false,
  }),
);

describe("compile: decoder evaluation", () => {
  const cases = [
    {
      invalid: element({ extra: "1", id: "a", n: "3" }),
      mode: "empty",
      path: "@extra",
      target: codec,
      valid: element({ id: "a", n: "3" }, ["\n  "]),
    },
    {
      invalid: node("n", ["x"]),
      mode: "text",
      path: "$text",
      target: intCodec,
      valid: node("n", ["3"]),
    },
    {
      invalid: node("list", [node("title", ["a"]), node("title", ["b"])]),
      mode: "elements",
      path: "title",
      target: listCodec,
      valid: list,
    },
  ] as const;

  for (const { invalid, mode, path, target, valid } of cases) {
    it.effect(`decodes ${mode} content synchronously to the value the run loop gives`, () =>
      Effect.gen(function* decodesSync() {
        const exit = Schema.decodeUnknownExit(target)(valid);
        const value = yield* Schema.decodeUnknownEffect(target)(valid);

        expect(Exit.isSuccess(exit)).toBe(true);
        expect(Exit.isSuccess(exit) ? exit.value : undefined).toEqual(value);
      }),
    );

    it.effect(`fails ${mode} content synchronously at the run loop's issue path`, () =>
      Effect.gen(function* failsSync() {
        const leaves = yield* effectLeavesOf(target, invalid);

        expect(leaves.map((rendered) => rendered.split(" ")[1])).toContain(path);
        expect(exitLeavesOf(target, invalid)).toEqual(leaves);
      }),
    );
  }

  it.effect("fails an undeclared attribute before an undeclared child", () =>
    Effect.gen(function* failsAttributeFirst() {
      const input = node("list", [node("bogus")], { extra: "1" });
      const leaves = yield* effectLeavesOf(listCodec, input);

      expect(leaves.map((rendered) => rendered.split(" ")[1])).toEqual(["@extra"]);
      expect(exitLeavesOf(listCodec, input)).toEqual(leaves);
    }),
  );

  it.effect("reports the full path of a failure two elements levels deep", () =>
    Effect.gen(function* failsDeep() {
      const input = node("doc", [
        node("list", [node("item", [], { id: "1" }), node("item", [], { bad: "x", id: "2" })]),
      ]);

      const leaves = yield* effectLeavesOf(docCodec, input);

      expect(leaves.map((rendered) => rendered.split(" ")[1])).toEqual(["list/item/1/@bad"]);
      expect(exitLeavesOf(docCodec, input)).toEqual(leaves);
    }),
  );
});

/**
 * A plan with three attributes declared out of alphabetical order, so a failure that lists the
 * declared set shows whether it keeps declaration order.
 */
const unsortedPlan: Plan = {
  ...bare("item", { mode: "empty" }),
  attributes: [
    { key: "z", name: "z", schema: Schema.String },
    { key: "a", name: "a", schema: Schema.String },
    { key: "m", name: "m", schema: Schema.String },
  ],
};

/**
 * Compile a fresh codec for the `<list>` plan `listCodec` uses, sharing no compiled state with it.
 *
 * @returns A new `<list>` codec.
 */
const freshList = () =>
  compileTest(
    bare("list", {
      children: [
        {
          cardinality: "optional",
          key: "title",
          name: "{u}title",
          schema: titleCodec,
          wire: "title",
        },
        { cardinality: "many", key: "item", name: "{u}item", schema: itemCodec, wire: "item" },
      ],
      mode: "elements",
      open: false,
    }),
  );

describe("compile: per-plan decode lookups", () => {
  it("decodes elements in a row with one codec as fresh codecs do", () => {
    const inputs = [
      list,
      node("list", [node("item", [], { id: "1" })], { extra: "1" }),
      node("list", [node("title", ["Other"]), node("item", [], { id: "3" })]),
    ];

    const shared = inputs.map((input) => Schema.decodeUnknownExit(listCodec)(input));
    const separate = inputs.map((input) => Schema.decodeUnknownExit(freshList())(input));

    expect(shared.map(Exit.isSuccess)).toEqual([true, false, true]);
    expect(shared.map((exit) => (Exit.isSuccess(exit) ? exit.value : undefined))).toEqual(
      separate.map((exit) => (Exit.isSuccess(exit) ? exit.value : undefined)),
    );
    expect(inputs.map((input) => exitLeavesOf(listCodec, input))).toEqual(
      inputs.map((input) => exitLeavesOf(freshList(), input)),
    );
  });

  it.effect("lists declared attributes in declaration order in an undeclared failure", () =>
    Effect.gen(function* listsInOrder() {
      const message = yield* failureOf(
        compileTest(unsortedPlan),
        node("item", [], { a: "1", extra: "1", m: "2", z: "3" }),
      );

      expect(message).toContain("declared attributes: z, a, m.");
    }),
  );

  it.effect("drops every string trim removes as blank under elements content", () =>
    Effect.gen(function* dropsBlank() {
      const blanks = ["\u00A0", "\uFEFF", " \t\r\n", "\u2028", "\u2029", "\u000B\u000C", ""];

      const value = yield* Schema.decodeUnknownEffect(listCodec)(
        node("list", [...blanks, node("item", [], { id: "1" }), ...blanks]),
      );

      expect(value).toEqual({ item: [{ id: "1" }] });
    }),
  );

  it.effect("fails text trim keeps, a zero-width space, as non-blank under elements content", () =>
    Effect.gen(function* failsNonBlank() {
      const input = node("list", [" ", "\u200B", node("item", [], { id: "1" })]);
      const leaves = yield* effectLeavesOf(listCodec, input);

      expect(leaves).toEqual(["InvalidValue "]);
    }),
  );
});

/**
 * Read the items union of an element codec's `mixed` content: the rest type of the `$children`
 * field's array.
 *
 * @param schema - An element codec with `mixed` content.
 * @returns The union node.
 */
const itemsUnion = (schema: Schema.Top): SchemaAST.Union => {
  const field = SchemaAST.isObjects(schema.ast)
    ? schema.ast.propertySignatures.find((signature) => signature.name === "$children")?.type
    : undefined;

  const union = field !== undefined && SchemaAST.isArrays(field) ? field.rest[0] : undefined;

  if (union === undefined || !SchemaAST.isUnion(union)) {
    throw new Error("the codec has no mixed items union");
  }

  return union;
};

/**
 * Read the `value` type of each member item of an items union, in union order, skipping the text
 * item.
 *
 * @param union - The items union.
 * @returns The value type node of each member item.
 */
const memberValues = (union: SchemaAST.Union): readonly SchemaAST.AST[] =>
  union.types.flatMap((item) =>
    SchemaAST.isObjects(item)
      ? item.propertySignatures.filter((signature) => signature.name === "value").map((v) => v.type)
      : [],
  );

describe("compile: mixed collision groups", () => {
  const InA = namespaces({ "": "urn:a" });
  const InB = namespaces({ "": "urn:b" });
  const PA = InA.Element("p", { attributes: { x: Schema.optionalKey(Schema.String) } });
  const PB = InB.Element("p", { attributes: { y: Schema.String } });
  const Em = declare("em", { content: text(Schema.String) });
  const Q = declare("q", { attributes: { y: Schema.String } });

  it("compiles content with no group to the default union over each member's own type side", () => {
    const members = [Em, Q, PA];
    const union = itemsUnion(declare("r", { content: mixed(members) }));
    const values = memberValues(union);

    expect(union.options).toBeUndefined();
    expect(values).toHaveLength(members.length);

    for (const [index, entry] of members.entries()) {
      expect(values[index]).toBe(SchemaAST.toType(entry.ast));
    }
  });

  it("compiles content with a group to a oneOf union with exact values for the group alone", () => {
    const union = itemsUnion(declare("r", { content: mixed([PA, Em, PB]) }));
    const [first, em, second] = memberValues(union);

    expect(union.options?.mode).toBe("oneOf");
    expect(em).toBe(SchemaAST.toType(Em.ast));

    for (const [value, owner] of [
      [first, PA],
      [second, PB],
    ] as const) {
      const parameters =
        value !== undefined && SchemaAST.isDeclaration(value) ? value.typeParameters : [];

      expect(parameters).toHaveLength(1);
      expect(parameters[0]).toBe(SchemaAST.toType(owner.ast));
    }
  });
});

describe("compile: isBlank", () => {
  it('equals text.trim() === "" for every UTF-16 code unit and astral string', () => {
    const contexts = [
      (unit: string) => unit,
      (unit: string) => ` \t${unit}`,
      (unit: string) => `${unit}\n\r`,
      (unit: string) => ` ${unit}x`,
    ];

    const astral = ["\u{1F600}", " \u{1F600} ", "\u{10FFFF}", "\uDBFF\uDFFF ", "\u3000\u2028"];
    const differs: string[] = [];

    for (let unit = 0; unit <= 0xff_ff; unit += 1) {
      for (const context of contexts) {
        const sample = context(String.fromCodePoint(unit));

        if (isBlank(sample) !== (sample.trim() === "")) {
          differs.push(sample);
        }
      }
    }

    for (const sample of ["", ...astral]) {
      if (isBlank(sample) !== (sample.trim() === "")) {
        differs.push(sample);
      }
    }

    expect(differs).toStrictEqual([]);
  });
});
