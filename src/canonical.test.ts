import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { canonicalize, normalizedNames } from "./canonical.ts";
import { decodeString, decodeTree, encodeString } from "./codec.ts";
import { namespaces } from "./dsl.ts";
import type { Element } from "./dsl.ts";
import { clark, ResolvedElementSchema } from "./element.ts";
import type { ResolvedElement } from "./element.ts";
import { elements, many, mixed, optional, text, XML } from "./plan.ts";
import type { ContentPlan, Plan } from "./plan.ts";

const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

const MATHML = "http://www.w3.org/1998/Math/MathML";

const q = (local: string): string => clark(Option.some(QTI), local);

const el = (
  name: string,
  attributes: Record<string, string>,
  children: readonly (ResolvedElement | string)[],
): ResolvedElement => ({ attributes, children, name });

/**
 * The normalized set these cases compare under: the QTI item body and the bare `a` compare their
 * children as a set; every other element, the QTI `p` included, compares strictly.
 */
const options = { normalize: new Set([q("qti-item-body"), "a"]) };

describe("canonicalize", () => {
  it("ignores attribute order", () => {
    expect(canonicalize(el(q("a"), { x: "1", y: "2" }, []), options)).toBe(
      canonicalize(el(q("a"), { x: "1", y: "2" }, []), options),
    );
  });

  it("drops whitespace-only children inside the normalized set", () => {
    expect(
      canonicalize(el(q("qti-item-body"), {}, ["\n  ", el(q("p"), {}, ["x"]), "\n"]), options),
    ).toBe(canonicalize(el(q("qti-item-body"), {}, [el(q("p"), {}, ["x"])]), options));
  });

  it("keeps whitespace-only children, normalised, outside the normalized set", () => {
    const spaced = el(q("p"), {}, ["a", el(q("b"), {}, ["b"]), " ", el(q("i"), {}, ["c"])]);
    const tight = el(q("p"), {}, ["a", el(q("b"), {}, ["b"]), el(q("i"), {}, ["c"])]);

    expect(canonicalize(spaced, options)).not.toBe(canonicalize(tight, options));
    expect(
      canonicalize(
        el(q("p"), {}, ["a", el(q("b"), {}, ["b"]), "\n\t ", el(q("i"), {}, ["c"])]),
        options,
      ),
    ).toBe(canonicalize(spaced, options));
  });

  it("normalises text whitespace runs and escapes markup characters", () => {
    expect(canonicalize(el("p", {}, ["a  <\n b"]), options)).toBe("<p>a &lt; b</p>");
    expect(canonicalize(el("a", { q: 'x"y' }, []), options)).toBe('<a q="x&quot;y"></a>');
  });

  it("distinguishes different attribute values and element names", () => {
    expect(canonicalize(el("a", { x: "1" }, []), options)).not.toBe(
      canonicalize(el("a", { x: "2" }, []), options),
    );
    expect(canonicalize(el("a", {}, []), options)).not.toBe(canonicalize(el("b", {}, []), options));
  });

  it("prints Clark names, so equal expanded names are equal whatever prefix spelled them", () => {
    // Resolution already replaced `m:math` and `mml:math` with the same Clark string.
    const viaM = el(clark(Option.some(MATHML), "math"), {}, ["x"]);
    const viaMml = el(clark(Option.some(MATHML), "math"), {}, ["x"]);

    expect(canonicalize(viaM, options)).toBe(`<{${MATHML}}math>x</{${MATHML}}math>`);
    expect(canonicalize(viaM, options)).toBe(canonicalize(viaMml, options));
    expect(canonicalize(viaM, options)).not.toBe(canonicalize(el("math", {}, ["x"]), options));
  });

  it("ignores the order of differently named children inside the normalized set", () => {
    // D1/C3: encode writes `elements` slots in declaration order, so this order is not promised.
    expect(canonicalize(el("a", {}, [el("x", {}, []), el("y", {}, [])]), options)).toBe(
      canonicalize(el("a", {}, [el("y", {}, []), el("x", {}, [])]), options),
    );
  });

  it("keeps the order of same-named children inside the normalized set", () => {
    expect(
      canonicalize(el("a", {}, [el("x", { n: "1" }, []), el("x", { n: "2" }, [])]), options),
    ).not.toBe(
      canonicalize(el("a", {}, [el("x", { n: "2" }, []), el("x", { n: "1" }, [])]), options),
    );
  });

  it("keeps the order of every child outside the normalized set", () => {
    expect(canonicalize(el(q("p"), {}, [el("x", {}, []), el("y", {}, [])]), options)).not.toBe(
      canonicalize(el(q("p"), {}, [el("y", {}, []), el("x", {}, [])]), options),
    );
  });

  it.effect("equates the README Start document with its encoded round trip", () =>
    Effect.gen(function* roundTrip() {
      const { Element } = namespaces({ "": QTI });

      const SimpleChoice = Element("qti-simple-choice", {
        attributes: { identifier: Schema.String },
        content: text(Schema.String),
      });

      const Prompt = Element("qti-prompt", { content: text(Schema.String) });

      const ChoiceInteraction = Element("qti-choice-interaction", {
        attributes: { "max-choices": Schema.Int, "response-identifier": Schema.String },
        content: elements({ choices: many(SimpleChoice), prompt: optional(Prompt) }),
      });

      const xml = `<qti-choice-interaction xmlns="${QTI}" response-identifier="RESPONSE" max-choices="1">
  <qti-prompt>Pick one</qti-prompt>
  <qti-simple-choice identifier="A">First</qti-simple-choice>
  <qti-simple-choice identifier="B">Second</qti-simple-choice>
</qti-choice-interaction>`;

      const value = yield* decodeString(ChoiceInteraction)(xml);
      const first = yield* decodeTree()(xml);
      const second = yield* decodeTree()(yield* encodeString(ChoiceInteraction)(value));
      const normalize = { normalize: normalizedNames(ChoiceInteraction) };

      expect(canonicalize(second, normalize)).toBe(canonicalize(first, normalize));
    }),
  );

  it.effect(
    "keeps the order of mixed children inside an undeclared element under an open root",
    () =>
      Effect.gen(function* undeclaredMixed() {
        const { Element } = namespaces({ "": QTI });
        const Root = Element("qti-item-body", { content: elements({}, { open: true }) });
        const normalize = { normalize: normalizedNames(Root) };

        const first = yield* decodeTree()(
          `<qti-item-body xmlns="${QTI}"><span>x <b>1</b> y <i>2</i></span></qti-item-body>`,
        );

        const second = yield* decodeTree()(
          `<qti-item-body xmlns="${QTI}"><span>x <i>2</i> y <b>1</b></span></qti-item-body>`,
        );

        expect(canonicalize(first, normalize)).not.toBe(canonicalize(second, normalize));
      }),
  );

  it.effect("normalizes declared elements and empty content and keeps text and mixed order", () =>
    Effect.gen(function* declaredModes() {
      const { Element } = namespaces({ "": QTI });
      const Break = Element("br", {});
      const Value = Element("qti-value", { content: text(Schema.String) });
      const Para = Element("p", { content: mixed([Break, Value]) });

      const Body = Element("qti-item-body", {
        content: elements({ breaks: many(Break), paras: many(Para), values: many(Value) }),
      });

      const normalize = { normalize: normalizedNames(Body) };

      const tree = (body: string) =>
        decodeTree()(`<qti-item-body xmlns="${QTI}">${body}</qti-item-body>`);

      expect(canonicalize(yield* tree("<qti-value>1</qti-value>\n  <br/>"), normalize)).toBe(
        canonicalize(yield* tree("<br/><qti-value>1</qti-value>"), normalize),
      );
      expect(canonicalize(yield* tree("<br> \n </br>"), normalize)).toBe(
        canonicalize(yield* tree("<br/>"), normalize),
      );
      expect(canonicalize(yield* tree("<qti-value> a b </qti-value>"), normalize)).not.toBe(
        canonicalize(yield* tree("<qti-value>a b</qti-value>"), normalize),
      );
      expect(
        canonicalize(yield* tree("<p>x <br/> y <qti-value>2</qti-value></p>"), normalize),
      ).not.toBe(canonicalize(yield* tree("<p>x <qti-value>2</qti-value> y <br/></p>"), normalize));
    }),
  );

  it("requires a normalized set, so no vocabulary is assumed", () => {
    // @ts-expect-error -- calling canonicalize without a normalized set is the mistake under test.
    expectTypeOf(canonicalize).toBeCallableWith(el("a", {}, []));
  });
});

/**
 * Build an element codec test double carrying a marker with the given Clark name and plan.
 *
 * @param name - The Clark name, also used as the wire name.
 * @param plan - The thunk the marker returns.
 * @returns The marked resolved-element schema, typed as an element codec.
 */
const marked = (name: string, plan: () => Plan): Element<string, unknown> =>
  // SAFETY: the authored name exists only in types; `normalizedNames` reads only the marker.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test double is type-level only.
  ResolvedElementSchema.annotate({ [XML]: { name, plan, wire: name } }) as Element<string, unknown>;

const planOfContent = (name: string, content: ContentPlan): Plan => ({
  attributes: [],
  content,
  data: undefined,
  name,
  prefixes: {},
  wire: name,
});

describe("normalizedNames", () => {
  it("collects elements and empty elements reached through elements and mixed plans", () => {
    const value = marked(q("qti-value"), () =>
      planOfContent(q("qti-value"), { key: "$text", mode: "text", schema: Schema.String }),
    );

    const br = marked(q("br"), () => planOfContent(q("br"), { mode: "empty" }));

    const p = marked(q("p"), () =>
      planOfContent(q("p"), {
        key: "$children",
        members: [
          { name: q("qti-value"), schema: value, wire: "qti-value" },
          { name: q("br"), schema: br, wire: "br" },
        ],
        mode: "mixed",
        open: false,
      }),
    );

    const wrapper = marked(q("wrapper"), () =>
      planOfContent(q("wrapper"), {
        children: [
          { cardinality: "many", key: "p", name: q("p"), schema: p, wire: "p" },
          {
            cardinality: "one",
            key: "value",
            name: q("qti-value"),
            schema: value,
            wire: "qti-value",
          },
        ],
        mode: "elements",
        open: false,
      }),
    );

    // The item body is mixed content, so it is strict; the `elements` wrapper below it is normalized.
    const body = marked(q("qti-item-body"), () =>
      planOfContent(q("qti-item-body"), {
        key: "$children",
        members: [{ name: q("wrapper"), schema: wrapper, wire: "wrapper" }],
        mode: "mixed",
        open: false,
      }),
    );

    expect(normalizedNames(body)).toEqual(new Set([q("wrapper"), q("br")]));
  });

  it("terminates on a recursive div and lists it once", () => {
    const div: Element<string, unknown> = marked(q("div"), () =>
      planOfContent(q("div"), {
        children: [{ cardinality: "many", key: "div", name: q("div"), schema: div, wire: "div" }],
        mode: "elements",
        open: false,
      }),
    );

    expect([...normalizedNames(div)]).toEqual([q("div")]);
  });

  it("refuses a schema without the effect-xml marker at the type level", () => {
    // @ts-expect-error -- a plain schema is not an element codec, so it has no plans to walk.
    expectTypeOf(normalizedNames).toBeCallableWith(Schema.String);
  });
});
