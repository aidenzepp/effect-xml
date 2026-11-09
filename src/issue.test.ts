import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Xml from "effect/encoding/Xml";
import * as Result from "effect/Result";
import * as SchemaIssue from "effect/SchemaIssue";
import { expectTypeOf } from "vitest";

import { compile } from "./compile.ts";
import { XML_NAMESPACE, isResolvedElement } from "./element.ts";
import type { ResolvedElement } from "./element.ts";
import {
  EncodeSchemaFailure,
  InvalidEvent,
  Limit,
  SchemaFailure,
  UndeclaredPrefix,
  UnmappedNamespace,
  WellFormedness,
  XmlDecodeError,
  XmlEncodeError,
  decodeError,
  formatMessage,
  isDecodeError,
  isEncodeError,
  limitMessage,
  limitParts,
  parserError,
  toDecodeError,
  toEncodeError,
  translate,
  undeclaredParts,
  wellFormednessParts,
  withPosition,
  xpath,
} from "./issue.ts";
import type { DecodeErrorReason, EncodeErrorReason, Unsupported } from "./issue.ts";
import { XML, elements, lower, many, mixed, text } from "./plan.ts";
import type { Element } from "./dsl.ts";
import type { Attributes, Content, Plan, Spec } from "./plan.ts";

const xmlError = new Xml.XmlError({ kind: "InvalidEvent", message: "mismatched end tag" });

const schemaError = Effect.flip(Schema.decodeUnknownEffect(Schema.String)(1));

describe("XmlDecodeError reasons", () => {
  it.effect("constructs each reason", () =>
    Effect.gen(function* body() {
      const cause = yield* schemaError;

      expect(new SchemaFailure({ cause, elementPath: [] })._tag).toBe("SchemaFailure");
      expect(
        new UndeclaredPrefix({
          elementPath: [{ index: 0, local: "b" }],
          prefix: "x",
          where: "element x:b",
        }).prefix,
      ).toBe("x");
      expect(new WellFormedness({ cause: xmlError }).cause).toBe(xmlError);
    }),
  );

  it.effect("catchReason selects UndeclaredPrefix", () =>
    Effect.gen(function* body() {
      const failure = Effect.fail(
        new XmlDecodeError({
          message: "prefix x is unbound at /a/x:b",
          path: "/a/x:b",
          reason: new UndeclaredPrefix({
            elementPath: [
              { index: 0, local: "a" },
              { index: 0, local: "b" },
            ],
            prefix: "x",
            where: "element x:b",
          }),
        }),
      );

      const handled = yield* failure.pipe(
        Effect.catchReason("XmlDecodeError", "UndeclaredPrefix", (reason) =>
          Effect.succeed(reason),
        ),
      );

      expect(handled.prefix).toBe("x");
      expect(handled.elementPath).toEqual([
        { index: 0, local: "a" },
        { index: 0, local: "b" },
      ]);
    }),
  );

  it.effect("passes a SchemaFailure reason through", () =>
    Effect.gen(function* body() {
      const cause = yield* schemaError;

      const failure = Effect.fail(
        new XmlDecodeError({
          message: "m",
          path: "/a",
          reason: new SchemaFailure({ cause, elementPath: [] }),
        }),
      );

      const error = yield* Effect.flip(
        failure.pipe(
          Effect.catchReason("XmlDecodeError", "UndeclaredPrefix", () => Effect.succeed("handled")),
        ),
      );

      expect(error.reason._tag).toBe("SchemaFailure");
    }),
  );
});

describe("XmlEncodeError reasons", () => {
  it.effect("constructs each reason", () =>
    Effect.gen(function* body() {
      const cause = yield* schemaError;

      expect(new EncodeSchemaFailure({ cause })._tag).toBe("EncodeSchemaFailure");
      expect(new UnmappedNamespace({ namespace: "urn:x", what: "element b" }).namespace).toBe(
        "urn:x",
      );
      expect(new InvalidEvent({ cause: xmlError }).cause).toBe(xmlError);
    }),
  );

  it.effect("catchReason selects UnmappedNamespace", () =>
    Effect.gen(function* body() {
      const failure = Effect.fail(
        new XmlEncodeError({
          message: "namespace urn:x has no prefix at /a/b",
          path: "/a/b",
          reason: new UnmappedNamespace({ namespace: "urn:x", what: "element b" }),
        }),
      );

      const handled = yield* failure.pipe(
        Effect.catchReason("XmlEncodeError", "UnmappedNamespace", (reason) =>
          Effect.succeed(reason.namespace),
        ),
      );

      expect(handled).toBe("urn:x");
    }),
  );

  it.effect("passes an InvalidEvent reason through", () =>
    Effect.gen(function* body() {
      const failure = Effect.fail(
        new XmlEncodeError({
          message: "m",
          path: "/a",
          reason: new InvalidEvent({ cause: xmlError }),
        }),
      );

      const error = yield* Effect.flip(
        failure.pipe(
          Effect.catchReason("XmlEncodeError", "UnmappedNamespace", () =>
            Effect.succeed("handled"),
          ),
        ),
      );

      expect(error.reason._tag).toBe("InvalidEvent");
    }),
  );
});

describe("xpath", () => {
  it("prints elements, positions, text items, and attributes", () => {
    expect(
      xpath([
        { kind: "element", name: "a" },
        { index: 2, kind: "element", name: "b" },
        { kind: "attribute", name: "c" },
      ]),
    ).toBe("/a/b[2]/@c");
    expect(
      xpath([
        { kind: "element", name: "a" },
        { index: 1, kind: "text" },
      ]),
    ).toBe("/a/text()[1]");
  });

  it("prints namespaced attributes and the empty path", () => {
    expect(
      xpath([
        { kind: "element", name: "a" },
        { kind: "attribute", name: "{http://www.w3.org/XML/1998/namespace}lang" },
      ]),
    ).toBe("/a/@xml:lang");
    expect(
      xpath([
        { kind: "element", name: "a" },
        { kind: "attribute", name: "{u}x" },
      ]),
    ).toBe("/a/@{u}x");
    expect(xpath([])).toBe("/");
  });

  it("prints a resolver-level string segment verbatim and drops the element namespace", () => {
    expect(xpath(["root", "foo:bar"])).toBe("/root/foo:bar");
    expect(xpath([{ kind: "element", name: "{u}p" }])).toBe("/p");
  });
});

describe("formatMessage", () => {
  const messages = [
    formatMessage({
      expectation: "expected a finite number",
      path: "/choiceInteraction",
      repair: "write max-choices as a number such as 1",
      what: 'attribute max-choices="x"',
    }),
    formatMessage({
      expectation: "prefix foo is not declared",
      path: xpath(["root", "foo:bar"]),
      repair: "declare xmlns:foo on this element or an ancestor",
      what: "element <foo:bar>",
    }),
    formatMessage({
      expectation: "mismatched end tag",
      path: "/",
      repair: "close every start tag, then decode again",
      what: "the document",
    }),
  ];

  it("joins what, path, expectation, and repair", () => {
    expect(messages[0]).toBe(
      'attribute max-choices="x" at /choiceInteraction: expected a finite number; write max-choices as a number such as 1',
    );
    expect(messages[1]).toBe(
      "element <foo:bar> at /root/foo:bar: prefix foo is not declared; declare xmlns:foo on this element or an ancestor",
    );
    expect(messages[2]).toBe(
      "the document at /: mismatched end tag; close every start tag, then decode again",
    );
  });

  it("never says invalid input", () => {
    for (const message of messages) {
      expect(message).not.toContain("invalid input");
    }
  });
});

const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

/**
 * The XML Schema instance namespace, which `xsi:schemaLocation` belongs to.
 */
const XSI = "http://www.w3.org/2001/XMLSchema-instance";

/**
 * Lower a QTI element declaration under the default QTI namespace.
 *
 * @param name - The authored element name.
 * @param spec - The element declaration.
 * @returns The element plan.
 */
const plan = (name: string, spec: Spec<Attributes, Content>): Plan =>
  Result.getOrThrow(lower(name, spec, { "": QTI }));

/**
 * Compile a plan, narrowing its services to `never`.
 *
 * @param target - The plan to compile.
 * @returns The compiled codec, typed without services.
 */
// SAFETY: services exist only at the type level; every schema in these definitions requires none.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- no runtime guard can observe services.
const define = (target: Plan) => compile(target) as Element<string, unknown>;

const Prompt = define(plan("qti-prompt", {}));

const Choice = define(
  plan("qti-simple-choice", {
    attributes: { identifier: Schema.String, n: Schema.optionalKey(Schema.Int) },
  }),
);

const interactionPlan = plan("qti-choice-interaction", {
  attributes: { "max-choices": Schema.Int },
  content: elements({ choices: many(Choice), prompt: Prompt }),
});

const Interaction = define(interactionPlan);

/**
 * Build a resolved element in the QTI namespace.
 *
 * @param local - The local name.
 * @param attributes - The element's attributes.
 * @param children - The element's children.
 * @returns The resolved element.
 */
const qti = (
  local: string,
  attributes: Readonly<Record<string, string>> = {},
  children: ResolvedElement["children"] = [],
): ResolvedElement => ({ attributes, children, name: `{${QTI}}${local}` });

/**
 * Decode `input` with the interaction definition expecting a failure and translate it.
 *
 * @param input - The element to decode.
 * @returns The translated `XmlDecodeError`.
 */
const decodeFailure = (input: ResolvedElement) =>
  Schema.decodeUnknownEffect(Interaction)(input).pipe(
    Effect.flip,
    Effect.map((error) => toDecodeError(interactionPlan, input, error)),
  );

/**
 * Decode `input` with the codec of `target` expecting a failure and translate it.
 *
 * @param target - The plan of the codec under test.
 * @param input - The element to decode.
 * @returns The translated `XmlDecodeError` and the leaf `translate` returns.
 */
const failureOf = (target: Plan, input: ResolvedElement) =>
  Schema.decodeUnknownEffect(define(target))(input).pipe(
    Effect.flip,
    Effect.map((failure) => ({
      error: toDecodeError(target, input, failure),
      leaf: translate(target, input, failure.issue).leaf,
    })),
  );

describe("translate and toDecodeError", () => {
  it.effect("points a bad attribute at @name and names a finite number", () =>
    Effect.gen(function* badAttribute() {
      const error = yield* decodeFailure(
        qti("qti-choice-interaction", { "max-choices": "x" }, [qti("qti-prompt")]),
      );

      expect(error).toBeInstanceOf(XmlDecodeError);
      expect(error.reason._tag).toBe("SchemaFailure");
      expect(error.path).toBe("/qti-choice-interaction/@max-choices");
      expect(error.message).toContain("finite number");
      expect(error.message).toContain("/qti-choice-interaction/@max-choices");
      expect(error.message).toContain('max-choices="x"');
    }),
  );

  it.effect("keeps the parent path for a missing child and names its wire name", () =>
    Effect.gen(function* missingChild() {
      const error = yield* decodeFailure(qti("qti-choice-interaction", { "max-choices": "1" }));

      expect(error.path).toBe("/qti-choice-interaction");
      expect(error.message).toContain("qti-prompt");
      expect(error.message).not.toContain("Missing key");
    }),
  );

  it.effect("names the expected set for an unknown child", () =>
    Effect.gen(function* unknownChild() {
      const error = yield* decodeFailure(
        qti("qti-choice-interaction", { "max-choices": "1" }, [qti("qti-prompt"), qti("video")]),
      );

      expect(error.path).toBe("/qti-choice-interaction");
      expect(error.message).toContain("declared children: qti-simple-choice, qti-prompt");
    }),
  );

  it.effect("indexes the second of two many children", () =>
    Effect.gen(function* secondChoice() {
      const error = yield* decodeFailure(
        qti("qti-choice-interaction", { "max-choices": "1" }, [
          qti("qti-prompt"),
          qti("qti-simple-choice", { identifier: "a" }),
          qti("qti-simple-choice", { identifier: "b", n: "x" }),
        ]),
      );

      expect(error.path).toBe("/qti-choice-interaction/qti-simple-choice[2]/@n");
      expect(error.message).toContain("finite number");
    }),
  );

  it.effect("prints a sole many child without an index", () =>
    Effect.gen(function* soleChoice() {
      const error = yield* decodeFailure(
        qti("qti-choice-interaction", { "max-choices": "1" }, [
          qti("qti-prompt"),
          qti("qti-simple-choice", { identifier: "a", n: "x" }),
        ]),
      );

      expect(error.path).toBe("/qti-choice-interaction/qti-simple-choice/@n");
    }),
  );

  it.effect("returns the segments and the leaf issue", () =>
    Effect.gen(function* segments() {
      const input = qti("qti-choice-interaction", { "max-choices": "x" }, [qti("qti-prompt")]);
      const error = yield* Effect.flip(Schema.decodeUnknownEffect(Interaction)(input));
      const translated = translate(interactionPlan, input, error.issue);

      expect(translated.segments).toEqual([
        { kind: "element", name: `{${QTI}}qti-choice-interaction` },
        { kind: "attribute", name: "max-choices", spelled: "max-choices" },
      ]);
      expect(translated.leaf._tag).not.toBe("Pointer");
    }),
  );
});

describe("toEncodeError", () => {
  it.effect("builds an XmlEncodeError with reason Schema and a path", () =>
    Effect.gen(function* encodeFailure() {
      const error = yield* Schema.encodeUnknownEffect(Interaction)({
        choices: [],
        "max-choices": 1.5,
        prompt: {},
      }).pipe(
        Effect.flip,
        Effect.map((failure) => toEncodeError(interactionPlan, failure)),
      );

      expect(error).toBeInstanceOf(XmlEncodeError);
      expect(error.reason._tag).toBe("EncodeSchemaFailure");
      expect(error.path).toBe("/qti-choice-interaction/@max-choices");
      expect(error.message).toContain("integer");
    }),
  );
});

describe("translate: undeclared and name-keyed attributes", () => {
  it.effect("states one next action for an undeclared attribute", () =>
    Effect.gen(function* undeclaredAttribute() {
      const error = yield* decodeFailure(
        qti("qti-choice-interaction", { "max-choices": "1", zz: "1" }, [qti("qti-prompt")]),
      );

      expect(error.path).toBe("/qti-choice-interaction/@zz");
      expect(error.message).toMatch(/Remove the attribute or declare it on the element\.$/u);
      expect(error.message).not.toContain("change or remove");
    }),
  );

  it.effect("points a failing attribute keyed name at @name", () =>
    Effect.gen(function* nameAttribute() {
      const namedPlan = plan("qti-named", { attributes: { name: Schema.Int } });
      const input = qti("qti-named", { name: "x" });

      const error = yield* Schema.decodeUnknownEffect(define(namedPlan))(input).pipe(
        Effect.flip,
        Effect.map((failure) => toDecodeError(namedPlan, input, failure)),
      );

      expect(error.path).toBe("/qti-named/@name");
      expect(error.message).toContain("finite number");
    }),
  );

  it.effect("spells an undeclared namespaced attribute with the definition's prefix", () =>
    Effect.gen(function* prefixedAttribute() {
      const target = Result.getOrThrow(lower("qti-prompt", {}, { "": QTI, xsi: XSI }));
      const input = qti("qti-prompt", { [`{${XSI}}schemaLocation`]: "x" });
      const { error } = yield* failureOf(target, input);

      expect(error.path).toMatch(/\/@xsi:schemaLocation$/u);
      expect(error.message).not.toContain(`{${XSI}}`);
    }),
  );

  it.effect("spells an undeclared attribute in the XML namespace as xml:", () =>
    Effect.gen(function* xmlAttribute() {
      const target = Result.getOrThrow(lower("qti-prompt", {}, { "": QTI, xsi: XSI }));
      const input = qti("qti-prompt", { [`{${XML_NAMESPACE}}lang`]: "en" });
      const { error } = yield* failureOf(target, input);

      expect(error.path).toMatch(/\/@xml:lang$/u);
    }),
  );

  it.effect("names both namespaces for a mixed child that differs from a member in namespace", () =>
    Effect.gen(function* namespaceMismatch() {
      const member = Result.getOrThrow(
        lower("p", { content: text(Schema.String) }, { "": "urn:q" }),
      );

      const target = Result.getOrThrow(
        lower("body", { content: mixed([define(member)]) }, { "": "urn:q" }),
      );

      const input: ResolvedElement = {
        attributes: {},
        children: [{ attributes: {}, children: ["x"], name: "p" }],
        name: "{urn:q}body",
      };

      const { error } = yield* failureOf(target, input);

      expect(error.message).toMatch(/no namespace/u);
      expect(error.message).toMatch(/urn:q/u);
    }),
  );

  it.effect("spells a mixed member in its own definition's prefixes", () =>
    Effect.gen(function* memberPrefixes() {
      const member = Result.getOrThrow(
        lower("math", { content: text(Schema.String) }, { "": "urn:m" }),
      );

      const target = Result.getOrThrow(
        lower("body", { content: mixed([define(member)]) }, { "": "urn:q" }),
      );

      const input: ResolvedElement = {
        attributes: {},
        children: [{ attributes: {}, children: [], name: "{urn:q}video" }],
        name: "{urn:q}body",
      };

      const { error } = yield* failureOf(target, input);

      const declared = /declared members: (?<members>[^.]*)\./u.exec(error.message)?.groups
        ?.members;

      expect(declared).toMatch(/^math$/u);
      expect(declared).not.toContain("{");
    }),
  );
});

/**
 * Count the leaves of an issue tree: every node that is not a `Pointer`, `Filter`, `Encoding`,
 * `Composite`, or `AnyOf` wrapper.
 *
 * @param issue - The issue tree.
 * @returns The number of leaves.
 */
const leafCount = (issue: SchemaIssue.Issue): number => {
  if (issue._tag === "Pointer" || issue._tag === "Filter" || issue._tag === "Encoding") {
    return leafCount(issue.issue);
  }

  if (issue._tag === "Composite" || issue._tag === "AnyOf") {
    return issue.issues.reduce((total, inner) => total + leafCount(inner), 0);
  }

  return 1;
};

/**
 * Build a `suspend` member by hand: a `Schema.suspend` carrying the referenced element's marker,
 * so `lower` reads its name and wire without forcing the thunk.
 *
 * @param local - The local name of the referenced element in the QTI namespace.
 * @param target - Returns the referenced plan, which the thunk compiles when it is forced.
 * @returns The suspended member codec.
 */
const reference = (local: string, target: () => Plan): Element<string, unknown> =>
  // SAFETY: `Schema.suspend` keeps the thunk's codec type; only the phantom name is added.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the phantom name is type-level only.
  Schema.suspend(() => define(target())).annotate({
    [XML]: { name: `{${QTI}}${local}`, plan: target, wire: local },
  });

const Para = define(plan("p", { attributes: { n: Schema.Int }, content: text(Schema.String) }));

const BodyInteraction = define(
  plan("qti-choice-interaction", { attributes: { "max-choices": Schema.Int } }),
);

/**
 * Build `blockquote` as `mixed([P, suspend("div")])` over the given `div` plan.
 *
 * @param div - Returns the `div` plan.
 * @returns The `blockquote` codec.
 */
const blockquoteOver = (div: () => Plan) =>
  define(plan("blockquote", { content: mixed([Para, reference("div", div)]) }));

const divPlan: Plan = plan("div", {
  content: mixed([Para, blockquoteOver(() => divPlan), reference("div", () => divPlan)]),
});

const DivRef = reference("div", () => divPlan);

const bodyPlan = plan("qti-item-body", { content: mixed([Para, BodyInteraction]) });

const fallbackBodyPlan = plan("qti-item-body", {
  content: mixed([Para, BodyInteraction, DivRef]),
});

/**
 * Wrap a body plan in an `elements` root `qti-assessment-item`.
 *
 * @param body - The body plan.
 * @returns The root plan.
 */
const itemPlanOf = (body: Plan): Plan =>
  plan("qti-assessment-item", { content: elements({ body: define(body) }) });

const itemPlan = itemPlanOf(bodyPlan);

const fallbackItemPlan = itemPlanOf(fallbackBodyPlan);

/**
 * Build an assessment item around a body holding `children`.
 *
 * @param children - The body's children.
 * @returns The item element.
 */
const item = (children: ResolvedElement["children"]) =>
  qti("qti-assessment-item", {}, [qti("qti-item-body", {}, children)]);

describe("translate: mixed content", () => {
  it.effect(
    "points a bad attribute inside a mixed body at the member and names a finite number",
    () =>
      Effect.gen(function* mixedAttribute() {
        const { error, leaf } = yield* failureOf(
          itemPlan,
          item(["a ", qti("qti-choice-interaction", { "max-choices": "x" })]),
        );

        expect(error.path).toBe(
          "/qti-assessment-item/qti-item-body/qti-choice-interaction/@max-choices",
        );
        expect(error.message).toContain("finite number");
        expect(leafCount(leaf)).toBe(1);
      }),
  );

  it.effect("indexes the second of two same-named members", () =>
    Effect.gen(function* secondPara() {
      const { error } = yield* failureOf(
        itemPlan,
        item([qti("p", { n: "1" }, ["a"]), " ", qti("p", { n: "x" }, ["b"])]),
      );

      expect(error.path).toBe("/qti-assessment-item/qti-item-body/p[2]/@n");
    }),
  );

  it.effect("prints a sole member without an index", () =>
    Effect.gen(function* solePara() {
      const { error } = yield* failureOf(itemPlan, item(["a ", qti("p", { n: "x" }, ["b"])]));

      expect(error.path).toBe("/qti-assessment-item/qti-item-body/p/@n");
    }),
  );

  it("prints a text item one-based among the text children", () => {
    const body = qti("qti-item-body", {}, [qti("p", { n: "1" }, ["a"]), "b", qti("p"), "c"]);

    const first = translate(
      bodyPlan,
      body,
      new SchemaIssue.Pointer(["$children", 1], new SchemaIssue.InvalidValue({ message: "text" })),
    );

    const second = translate(
      bodyPlan,
      body,
      new SchemaIssue.Pointer(["$children", 3], new SchemaIssue.InvalidValue({ message: "text" })),
    );

    expect(xpath(first.segments)).toBe("/qti-item-body/text()[1]");
    expect(xpath(second.segments)).toBe("/qti-item-body/text()[2]");
    expect(leafCount(first.leaf)).toBe(1);
  });

  it.effect("drops the suspend branch at each level of div > blockquote > p", () =>
    Effect.gen(function* nested() {
      const { error, leaf } = yield* failureOf(
        divPlan,
        qti("div", {}, [qti("blockquote", {}, [qti("p", { n: "x" }, ["t"])])]),
      );

      expect(error.path).toBe("/div/blockquote/p/@n");
      expect(error.message).toContain("finite number");
      expect(leafCount(leaf)).toBe(1);
    }),
  );

  for (const [label, target] of [
    ["without a suspend member", itemPlan],
    ["with a suspend member", fallbackItemPlan],
  ] as const) {
    it.effect(`names an unknown element and the member set ${label}`, () =>
      Effect.gen(function* unknownMember() {
        const { error, leaf } = yield* failureOf(
          target,
          item(["a ", qti("p", { n: "1" }, ["b"]), qti("video")]),
        );

        expect(error.path).toBe("/qti-assessment-item/qti-item-body/video");
        expect(error.message).toMatch(/<video> is not a member/u);
        expect(error.message).not.toContain(`{${QTI}}`);
        expect(error.message).toContain("p, qti-choice-interaction");
        expect(leafCount(leaf)).toBe(1);
      }),
    );
  }

  it.effect("indexes an unknown element among its same-named siblings", () =>
    Effect.gen(function* unknownSibling() {
      const { error } = yield* failureOf(itemPlan, item([qti("video"), qti("video")]));

      expect(error.path).toBe("/qti-assessment-item/qti-item-body/video[1]");
    }),
  );
});

describe("position on XmlDecodeError", () => {
  const at = { column: 3, line: 23 };

  it("formatMessage renders the position once between the path and the colon", () => {
    const parts = { expectation: "bad", path: "/a/b", what: "element b" };

    expect(formatMessage({ ...parts, position: at })).toMatch(/ at \S+ \(line 23, column 3\): /u);
    expect(formatMessage({ ...parts, position: at }).match(/\(line/gu)).toHaveLength(1);
    expect(formatMessage(parts)).toMatch(/ at \S+: /u);
    expect(formatMessage(parts)).not.toContain("(line");
  });

  it.effect("withPosition keeps reason and path and re-renders a Schema error", () =>
    Effect.gen(function* schemaCase() {
      const cause = yield* schemaError;
      const base = toDecodeError(interactionPlan, qti("qti-choice-interaction"), cause);
      const positioned = withPosition(base, { column: 9, line: 4 });

      expect(positioned.reason).toBe(base.reason);
      expect(positioned.path).toBe(base.path);
      expect(positioned.position).toEqual({ column: 9, line: 4 });
      expect(positioned.message).toMatch(/ at \S+ \(line \d+, column \d+\): /u);
      expect(base.message).toMatch(/ at \S+: /u);
    }),
  );

  it.effect("toDecodeError with a record ordinal stamps it and withPosition keeps it once", () =>
    Effect.gen(function* recordCase() {
      const cause = yield* schemaError;
      const element = qti("qti-choice-interaction");
      const plain = toDecodeError(interactionPlan, element, cause);
      const stamped = toDecodeError(interactionPlan, element, cause, 3);
      const positioned = withPosition(stamped, { column: 9, line: 4 });

      expect(plain.record).toBeUndefined();
      expect(plain.message).not.toContain("of record");
      expect(stamped.record).toBe(3);
      expect(stamped.message).toContain("of record 3");
      expect(positioned.record).toBe(3);
      expect(positioned.message.split("of record 3")).toHaveLength(2);
    }),
  );

  it("withPosition on WellFormedness shows the position once", () => {
    const cause = new Xml.XmlError({
      kind: "InvalidEvent",
      message: "bad tag at line 1, column 8",
    });

    const base = new XmlDecodeError({
      message: "x",
      path: "/",
      reason: new WellFormedness({ cause }),
    });

    const { message } = withPosition(base, { column: 8, line: 1 });

    expect(message).toContain(" (line 1, column 8)");
    expect(message.split("line 1")).toHaveLength(2);
    expect(message).toContain("bad tag");
  });

  it("an error built without position has no position key", () => {
    const error = new XmlDecodeError({
      message: "m",
      path: "/",
      reason: new UndeclaredPrefix({
        elementPath: [{ index: 0, local: "b" }],
        prefix: "x",
        where: "element x:b",
      }),
    });

    expect(Object.hasOwn(error, "position")).toBe(false);
    expect(withPosition(error, at).message).toMatch(/ at \S+ \(line 23, column 3\): /u);
  });

  it.effect("catchReason still selects an error with position", () =>
    Effect.gen(function* selects() {
      const cause = yield* schemaError;

      const error = withPosition(
        new XmlDecodeError({
          message: "m",
          path: "/",
          reason: new SchemaFailure({ cause, elementPath: [] }),
        }),
        at,
      );

      const tag = yield* Effect.fail(error).pipe(
        Effect.catchReason("XmlDecodeError", "SchemaFailure", (reason) =>
          Effect.succeed(reason._tag),
        ),
      );

      expect(tag).toBe("SchemaFailure");
    }),
  );
});

describe("one message-parts path for every decode error", () => {
  const at = { column: 9, line: 4 };
  const parenthetical = " (line 4, column 9)";

  const upstream = new Xml.XmlError({
    column: 7,
    kind: "Syntax",
    line: 1,
    message: "end tag </a> does not match <b> at line 1, column 7",
  });

  const limit = { element: "{urn:q}r", limit: "maxElementSize", max: 5, measured: 9 } as const;

  const undeclared = {
    elementPath: [{ index: 0, local: "b" }],
    prefix: "x",
    where: "element <x:b>",
  };

  const namespaceRule = {
    expectation: "the xmlns prefix is reserved and cannot be declared",
    repair: "remove the declaration",
    what: "declaration xmlns:xmlns of <r>",
  };

  /**
   * Builds one decode error per reason through the library's construction paths.
   *
   * @returns The reason name paired with its unpositioned error.
   */
  const built = Effect.gen(function* builtPerReason() {
    const cause = yield* schemaError;

    return [
      ["SchemaFailure", toDecodeError(interactionPlan, qti("qti-choice-interaction"), cause)],
      [
        "UndeclaredPrefix",
        decodeError({
          parts: undeclaredParts(undeclared),
          path: "/a/x:b",
          reason: new UndeclaredPrefix(undeclared),
        }),
      ],
      [
        "WellFormedness (upstream)",
        decodeError({
          parts: wellFormednessParts(upstream),
          path: "/",
          reason: new WellFormedness({ cause: upstream }),
        }),
      ],
      [
        "WellFormedness (namespace rule)",
        decodeError({
          parts: namespaceRule,
          path: "/r",
          reason: new WellFormedness({
            cause: new Xml.XmlError({ kind: "Syntax", message: "synthesized" }),
            elementPath: [{ index: 0, local: "r" }],
          }),
        }),
      ],
      [
        "Limit",
        decodeError({ parts: limitParts(limit), path: "/r", reason: new Limit(limit), record: 1 }),
      ],
    ] as const;
  });

  it.effect("keeps each reason's message, repair included, when positioned", () =>
    Effect.gen(function* keepsRepair() {
      for (const [name, error] of yield* built) {
        const positioned = withPosition(error, at);

        expect(positioned.message, name).toContain(parenthetical);
        expect(positioned.message.replace(parenthetical, ""), name).toBe(error.message);
        expect(error.message, name).toMatch(/; \S/u);
      }
    }),
  );

  it("renders the upstream WellFormedness location once, as the parenthetical", () => {
    const error = decodeError({
      parts: wellFormednessParts(upstream),
      path: "/",
      reason: new WellFormedness({ cause: upstream }),
    });

    expect(withPosition(error, { column: 7, line: 1 }).message).toBe(
      "document at / (line 1, column 7): the text is not well-formed XML (end tag </a> does not match <b>); fix the markup at the reported position",
    );
  });

  it("tells the caller to decode bytes of an unsupported encoding, positioned once", () => {
    const unsupported = new Xml.XmlError({
      kind: "Unsupported",
      message:
        "encoding ISO-8859-1 is not supported for byte input, decode the bytes to text first at line 1, column 1",
    });

    const error = decodeError({
      parts: wellFormednessParts(unsupported),
      path: "/",
      reason: new WellFormedness({ cause: unsupported }),
    });

    const { message } = withPosition(error, { column: 1, line: 1 });

    expect(message).toContain("decode the ISO-8859-1 bytes to text, or supply UTF-8 bytes");
    expect(message).toMatch(/: the parser does not support the input \(encoding ISO-8859-1 /u);
    expect(message).not.toContain("not well-formed");
    expect(message).not.toContain("fix the markup");
    expect(message.split("line 1")).toHaveLength(2);
  });

  it("keeps the Syntax repair", () => {
    const syntax = new Xml.XmlError({ kind: "Syntax", message: "bad tag at line 1, column 2" });

    expect(wellFormednessParts(syntax).repair).toBe("fix the markup at the reported position");
  });

  it.effect("gives an error built outside the library a repair when positioned", () =>
    Effect.gen(function* foreignRepair() {
      const cause = yield* schemaError;

      const reasons = [
        new SchemaFailure({ cause, elementPath: [] }),
        new UndeclaredPrefix(undeclared),
        new WellFormedness({ cause: upstream }),
        new Limit(limit),
      ];

      for (const reason of reasons) {
        const error = new XmlDecodeError({ message: "m", path: "/a", reason });

        expect(withPosition(error, at).message, reason._tag).toMatch(
          / at \/a \(line 4, column 9\): .+; \S/u,
        );
      }
    }),
  );

  it("decodeError omits position and record keys it is not given", () => {
    const error = decodeError({
      parts: undeclaredParts(undeclared),
      path: "/a/x:b",
      reason: new UndeclaredPrefix(undeclared),
    });

    expect(Object.hasOwn(error, "position")).toBe(false);
    expect(Object.hasOwn(error, "record")).toBe(false);
  });
});

describe("record ordinal and the Limit reason", () => {
  const at = { column: 3, line: 23 };
  const parts = { expectation: "bad", path: "/a/b", what: "element b" };

  const limit = new Limit({
    element: "{urn:q}item",
    limit: "maxElementNodes",
    max: 10,
    measured: 11,
  });

  it.effect("catchReason selects a Limit reason", () =>
    Effect.gen(function* selects() {
      const error = new XmlDecodeError({ message: "m", path: "/a", reason: limit, record: 2 });

      const measured = yield* Effect.fail(error).pipe(
        Effect.catchReason("XmlDecodeError", "Limit", (reason) => Effect.succeed(reason.measured)),
      );

      expect(measured).toBe(11);
    }),
  );

  it("formatMessage renders the record before the position", () => {
    expect(formatMessage({ ...parts, position: at, record: 3 })).toMatch(
      / at \S+ of record 3 \(line 23, column 3\): /u,
    );

    expect(formatMessage({ ...parts, record: 3 })).toMatch(/ at \S+ of record 3: /u);
    expect(formatMessage(parts)).toMatch(/ at \S+: /u);
    expect(formatMessage(parts)).not.toContain("record");
  });

  it("withPosition keeps record and renders it once", () => {
    const base = new XmlDecodeError({ message: "m", path: "/a", reason: limit, record: 3 });
    const positioned = withPosition(base, at);

    expect(positioned.record).toBe(3);
    expect(positioned.message).toMatch(/ of record \d+ \(line /u);
    expect(positioned.message.match(/of record/gu)).toHaveLength(1);
  });

  it("an error built without record has no record key", () => {
    const error = new XmlDecodeError({ message: "m", path: "/a", reason: limit });

    expect(Object.hasOwn(error, "record")).toBe(false);
    expect(Object.hasOwn(withPosition(error, at), "record")).toBe(false);
  });
});

describe("limitMessage", () => {
  const nodes = {
    element: "{QTI}qti-assessment-test",
    limit: "maxElementNodes",
    max: 1_000_000,
    measured: 1_000_001,
    path: "/qti-assessment-test",
    record: 1,
  } as const;

  it("renders the lock 5 text", () => {
    expect(limitMessage(nodes)).toBe(
      "element <qti-assessment-test> exceeds maxElementNodes at /qti-assessment-test of record 1: counted 1000001 nodes, limit 1000000; raise maxElementNodes, pass Infinity to disable it, or decode a smaller record path",
    );
  });

  it("counts characters for maxElementSize and names its max", () => {
    const message = limitMessage({ ...nodes, limit: "maxElementSize", max: 64, measured: 65 });

    expect(message).toContain("exceeds maxElementSize at");
    expect(message).toContain("counted 65 characters, limit 64");
    expect(message).not.toContain("nodes");
  });

  it("withPosition renders the position and the record once", () => {
    const { path, record, ...fields } = nodes;

    const error = new XmlDecodeError({
      message: limitMessage(nodes),
      path,
      reason: new Limit(fields),
      record,
    });

    const { message } = withPosition(error, { column: 1, line: 1 });

    expect(message).toContain("at /qti-assessment-test of record 1 (line 1, column 1): counted");
    expect(message.match(/record 1/gu)).toHaveLength(1);
  });
});

/**
 * Read the `elementPath` of a decode error's `SchemaFailure` reason.
 *
 * @param error - A decode error from a schema failure.
 * @returns The element path, or an empty path for any other reason.
 */
const elementPathOf = (error: XmlDecodeError) =>
  error.reason._tag === "SchemaFailure" ? error.reason.elementPath : [];

describe("elementPath on the SchemaFailure reason", () => {
  it.effect("locates a bad attribute by positional indices", () =>
    Effect.gen(function* positional() {
      const interaction = qti("qti-choice-interaction", { "max-choices": "x" });
      const body = qti("qti-item-body", {}, [qti("p", { n: "1" }, ["a"]), "t", interaction]);
      const input = qti("qti-assessment-item", {}, [body]);
      const { error } = yield* failureOf(itemPlan, input);

      expect(elementPathOf(error)).toEqual([
        { index: 0, local: "qti-assessment-item" },
        { index: input.children.filter(isResolvedElement).indexOf(body), local: "qti-item-body" },
        {
          index: body.children.filter(isResolvedElement).indexOf(interaction),
          local: "qti-choice-interaction",
        },
      ]);
    }),
  );

  it.effect("uses the local part of a namespaced element", () =>
    Effect.gen(function* namespaced() {
      const target = Result.getOrThrow(
        lower("p", { attributes: { n: Schema.Int } }, { "": "urn:u" }),
      );

      const input: ResolvedElement = { attributes: { n: "x" }, children: [], name: "{urn:u}p" };
      const { error } = yield* failureOf(target, input);

      expect(elementPathOf(error)).toEqual([{ index: 0, local: "p" }]);
    }),
  );

  it.effect("keeps positional and same-name indices apart for the second of two p", () =>
    Effect.gen(function* second() {
      const { error } = yield* failureOf(
        itemPlan,
        item([
          qti("qti-choice-interaction", { "max-choices": "1" }),
          qti("p", { n: "1" }, ["a"]),
          qti("p", { n: "x" }, ["b"]),
        ]),
      );

      expect(elementPathOf(error).at(-1)).toEqual({ index: 2, local: "p" });
      expect(error.path).toBe("/qti-assessment-item/qti-item-body/p[2]/@n");
    }),
  );

  it.effect("gives a sole p its position and prints it unindexed", () =>
    Effect.gen(function* sole() {
      const { error } = yield* failureOf(
        itemPlan,
        item(["a ", qti("qti-choice-interaction", { "max-choices": "1" }), qti("p", { n: "x" })]),
      );

      expect(elementPathOf(error).at(-1)).toEqual({ index: 1, local: "p" });
      expect(error.path).toBe("/qti-assessment-item/qti-item-body/p/@n");
    }),
  );

  it.effect("ends at the parent for a missing required child", () =>
    Effect.gen(function* missingChild() {
      const error = yield* decodeFailure(qti("qti-choice-interaction", { "max-choices": "1" }));

      expect(elementPathOf(error)).toEqual([{ index: 0, local: "qti-choice-interaction" }]);
    }),
  );

  it.effect("gives a root-level issue a one-step path at index 0", () =>
    Effect.gen(function* rootLevel() {
      const error = yield* decodeFailure(
        qti("qti-choice-interaction", { "max-choices": "x" }, [qti("qti-prompt")]),
      );

      expect(elementPathOf(error)).toEqual([{ index: 0, local: "qti-choice-interaction" }]);
    }),
  );
});

describe("an unknown child of closed mixed content", () => {
  for (const [label, target] of [
    ["without a suspend member", itemPlan],
    ["with a suspend member", fallbackItemPlan],
  ] as const) {
    it.effect(`becomes one Schema issue at the child ${label}`, () =>
      Effect.gen(function* unknownChild() {
        const { error, leaf } = yield* failureOf(
          target,
          item(["a ", qti("p", { n: "1" }, ["b"]), qti("video")]),
        );

        expect(error.reason._tag).toBe("SchemaFailure");
        expect(leafCount(leaf)).toBe(1);
        expect(error.path).toMatch(/\/qti-item-body\/video(?:\[1\])?$/u);
        expect(error.message).toMatch(/video/u);
        expect(error.message).toMatch(/\bp\b.*qti-choice-interaction/u);
        expect(elementPathOf(error).at(-1)?.local).toBe("video");
      }),
    );
  }

  it.effect("reports the first of two unknown children", () =>
    Effect.gen(function* twoUnknown() {
      // Both `video` children are unknown to closed `mixed`, so the first one fails the decode;
      // a closed body has no valid `video` that could precede a failing second one.
      const { error } = yield* failureOf(
        itemPlan,
        item([qti("p", { n: "1" }, ["a"]), qti("video"), qti("video")]),
      );

      expect(error.path).toMatch(/\/qti-item-body\/video\[1\]$/u);
      expect(elementPathOf(error).at(-1)).toEqual({ index: 1, local: "video" });
    }),
  );
});

const openItemPlan = itemPlanOf(
  plan("qti-item-body", { content: mixed([Para, BodyInteraction], { open: true }) }),
);

const openFallbackItemPlan = itemPlanOf(
  plan("qti-item-body", { content: mixed([Para, BodyInteraction, DivRef], { open: true }) }),
);

describe("an open mixed body", () => {
  for (const [label, open, closed] of [
    ["without a suspend member", openItemPlan, itemPlan],
    ["with a suspend member", openFallbackItemPlan, fallbackItemPlan],
  ] as const) {
    it.effect(`points a bad member attribute where the closed body does ${label}`, () =>
      Effect.gen(function* openAttribute() {
        const input = item(["a ", qti("qti-choice-interaction", { "max-choices": "x" })]);
        const opened = yield* failureOf(open, input);
        const shut = yield* failureOf(closed, input);

        expect(opened.error.path).toBe(
          "/qti-assessment-item/qti-item-body/qti-choice-interaction/@max-choices",
        );
        expect(opened.error.path).toBe(shut.error.path);
        expect(opened.error.reason._tag).toBe(shut.error.reason._tag);
        expect(opened.error.message).toMatch(/finite/iu);
        expect(leafCount(opened.leaf)).toBe(1);
      }),
    );

    it.effect(`indexes the second of two same-named members ${label}`, () =>
      Effect.gen(function* openSecondPara() {
        const { error, leaf } = yield* failureOf(
          open,
          item([qti("p", { n: "1" }, ["a"]), " ", qti("p", { n: "x" }, ["b"])]),
        );

        expect(error.path).toBe("/qti-assessment-item/qti-item-body/p[2]/@n");
        expect(leafCount(leaf)).toBe(1);
      }),
    );

    it.effect(`admits an unknown element ${label}`, () =>
      Effect.gen(function* openUnknown() {
        const video = qti("video");

        const value = yield* Schema.decodeUnknownEffect(define(open))(
          item(["a ", qti("p", { n: "1" }, ["b"]), video]),
        );

        expect(value).toEqual({
          body: {
            $children: [
              { _tag: "$text", text: "a " },
              { _tag: "p", value: { $text: "b", n: 1 } },
              { _tag: "*", element: video },
            ],
          },
        });
      }),
    );
  }

  it.effect("collapses a malformed unknown element to the generic member's issue", () =>
    Effect.gen(function* malformedUnknown() {
      // A resolved element always holds string attributes, so only a hand-built input reaches
      // the generic member's own failure; `located` is its well-formed twin for locating.
      const malformed = {
        attributes: {},
        children: [
          {
            attributes: {},
            children: [{ attributes: { n: 1 }, children: [], name: `{${QTI}}video` }],
            name: `{${QTI}}qti-item-body`,
          },
        ],
        name: `{${QTI}}qti-assessment-item`,
      };

      const located = item([qti("video", { n: "1" })]);

      const failure = yield* Schema.decodeUnknownEffect(define(openFallbackItemPlan))(
        malformed,
      ).pipe(Effect.flip);

      const error = toDecodeError(openFallbackItemPlan, located, failure);
      const { leaf } = translate(openFallbackItemPlan, located, failure.issue);

      expect(leafCount(leaf)).toBe(1);
      expect(error.path).toMatch(/\/qti-item-body\/video/u);
      expect(error.message).not.toMatch(/not a member/u);
      expect(error.message).toMatch(/string/iu);
    }),
  );
});

describe("parserError", () => {
  const maxDepth = new Xml.XmlError({
    column: 7,
    kind: "Limit",
    line: 1,
    message: "element nesting exceeds maxDepth of 1 at line 1, column 7",
  });

  it.effect("gives a maxDepth Limit reason Limit with the parser's position", () =>
    Effect.gen(function* limitReason() {
      const error = parserError(maxDepth);
      const { reason } = error;

      expect(reason._tag).toBe("Limit");
      expect(reason).toMatchObject({ limit: "maxDepth", max: 1 });
      expect(Object.hasOwn(reason, "element")).toBe(false);
      expect(Object.hasOwn(reason, "measured")).toBe(false);
      expect(error.path).toBe("/");
      expect(error.position).toStrictEqual({ column: maxDepth.column, line: maxDepth.line });
      expect(error.message.split("line 1")).toHaveLength(2);

      const caught = yield* Effect.fail(error).pipe(
        Effect.catchReason("XmlDecodeError", "Limit", (limit) => Effect.succeed(limit.limit)),
      );

      expect(caught).toBe("maxDepth");
    }),
  );

  it("reads a maxTokenSize of Infinity from the parser message", () => {
    const { reason } = parserError(
      new Xml.XmlError({ kind: "Limit", message: "token exceeds maxTokenSize of Infinity" }),
    );

    expect(reason).toMatchObject({ _tag: "Limit", limit: "maxTokenSize", max: Infinity });
  });

  it.effect("gives an Unsupported parser failure reason Unsupported", () =>
    Effect.gen(function* unsupportedReason() {
      const cause = new Xml.XmlError({
        column: 1,
        kind: "Unsupported",
        line: 1,
        message:
          "encoding ISO-8859-1 is not supported for byte input, decode the bytes to text first at line 1, column 1",
      });

      const error = parserError(cause);

      expect(error.reason._tag).toBe("Unsupported");
      expect(error.position).toStrictEqual({ column: 1, line: 1 });
      expect(error.message).toMatch(
        /: the parser does not support the input \(encoding ISO-8859-1 /u,
      );

      const caught = yield* Effect.fail(error).pipe(
        Effect.catchReason("XmlDecodeError", "Unsupported", (unsupported) =>
          Effect.succeed(unsupported.cause),
        ),
      );

      expect(caught).toBe(cause);
    }),
  );

  it("gives a Syntax failure, and a Limit the parser message does not name, reason WellFormedness", () => {
    const causes = [
      new Xml.XmlError({ kind: "Syntax", message: "bad tag" }),
      new Xml.XmlError({ kind: "Limit", message: "element <r> exceeds maxElementSize of 4" }),
    ];

    for (const cause of causes) {
      const error = parserError(cause);

      expect(error.reason, cause.message).toMatchObject({ _tag: "WellFormedness", cause });
      expect(Object.hasOwn(error, "position"), cause.message).toBe(false);
    }
  });
});

describe("error guards and reason unions", () => {
  it.effect("isDecodeError admits only an XmlDecodeError", () =>
    Effect.gen(function* decodeGuard() {
      const cause = yield* schemaError;

      const fromDecode = toDecodeError(interactionPlan, qti("qti-choice-interaction"), cause);
      const fromEncode = toEncodeError(interactionPlan, cause);

      expect(isDecodeError(fromDecode)).toBe(true);
      expect(isDecodeError(fromEncode)).toBe(false);
      expect(isDecodeError({ _tag: "XmlDecodeError" })).toBe(false);
      expect(isDecodeError("XmlDecodeError")).toBe(false);
    }),
  );

  it.effect("isEncodeError admits only an XmlEncodeError", () =>
    Effect.gen(function* encodeGuard() {
      const cause = yield* schemaError;

      const fromDecode = toDecodeError(interactionPlan, qti("qti-choice-interaction"), cause);
      const fromEncode = toEncodeError(interactionPlan, cause);

      expect(isEncodeError(fromEncode)).toBe(true);
      expect(isEncodeError(fromDecode)).toBe(false);
      expect(isEncodeError({ _tag: "XmlEncodeError" })).toBe(false);
      expect(isEncodeError("XmlEncodeError")).toBe(false);
    }),
  );

  it.effect("catchReason selects the SchemaFailure reason toDecodeError builds", () =>
    Effect.gen(function* selectsSchemaFailure() {
      const cause = yield* schemaError;

      const error = toDecodeError(interactionPlan, qti("qti-choice-interaction"), cause);

      const caught = yield* Effect.fail(error).pipe(
        Effect.catchReason("XmlDecodeError", "SchemaFailure", (reason: SchemaFailure) =>
          Effect.succeed(reason),
        ),
      );

      expect(caught).toBeInstanceOf(SchemaFailure);
      expect(caught.cause).toBe(cause);
    }),
  );

  it("names the decode and encode reason unions", () => {
    expectTypeOf<DecodeErrorReason>().toEqualTypeOf<
      SchemaFailure | UndeclaredPrefix | WellFormedness | Limit | Unsupported
    >();
    expectTypeOf<EncodeErrorReason>().toEqualTypeOf<
      EncodeSchemaFailure | UnmappedNamespace | InvalidEvent
    >();
  });
});

/**
 * Decode `input` with the text-only codec of `name` under `prefixes`, expecting a failure.
 *
 * @param name - The authored root element name.
 * @param prefixes - The prefix-to-namespace map the root is lowered under.
 * @param input - The element to decode.
 * @param record - The record ordinal the error carries, when decoding a stream.
 * @returns The translated `XmlDecodeError`.
 */
const rootMismatch = (
  name: string,
  prefixes: Readonly<Record<string, string>>,
  input: ResolvedElement,
  record?: number,
) => {
  const target = Result.getOrThrow(lower(name, { content: text(Schema.String) }, prefixes));

  return Schema.decodeUnknownEffect(define(target))(input).pipe(
    Effect.flip,
    Effect.map((failure) => toDecodeError(target, input, failure, record)),
  );
};

describe("a root element name mismatch", () => {
  it.effect("ends the path at the root and names the expected element", () =>
    Effect.gen(function* wrongRoot() {
      const error = yield* rootMismatch("i", { "": QTI }, qti("j", {}, ["x"]));

      expect(error.reason._tag).toBe("SchemaFailure");
      expect(error.path).toBe("/j");
      expect(error.message).toMatch(/expected <i>/u);
      expect(error.message).not.toMatch(/\/name/u);
    }),
  );

  it.effect("places the record ordinal after the root path", () =>
    Effect.gen(function* wrongRootInRecord() {
      const error = yield* rootMismatch("i", { "": QTI }, qti("j", {}, ["x"]), 1);

      expect(error.message).toMatch(/ at \/j of record 1: /u);
    }),
  );

  it.effect("shows both namespaces when only the namespace differs", () =>
    Effect.gen(function* wrongNamespace() {
      const input: ResolvedElement = { attributes: {}, children: ["x"], name: "{urn:b}i" };
      const error = yield* rootMismatch("i", { "": "urn:a" }, input);

      expect(error.message).toMatch(/urn:a/u);
      expect(error.message).toMatch(/urn:b/u);
    }),
  );
});
