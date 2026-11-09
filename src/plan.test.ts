import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

import { ResolvedElementSchema, XML_NAMESPACE } from "./element.ts";
import type { ResolvedElement } from "./element.ts";
import {
  DefinitionError,
  elementName,
  elements,
  lower,
  many,
  markerOf,
  mixed,
  optional,
  planOf,
  qname,
  text,
  XML,
} from "./plan.ts";
import { Element } from "./dsl.ts";
import type { AnyElement, Plan } from "./plan.ts";

const plan: Plan = {
  attributes: [],
  content: { mode: "empty" },
  data: undefined,
  name: "{u}a",
  prefixes: {},
  wire: "p:a",
};

describe("DefinitionError", () => {
  const error = new DefinitionError("m");

  it("is a plain Error carrying the message", () => {
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DefinitionError);
    expect(error.name).toBe("DefinitionError");
    expect(error.message).toBe("m");
  });

  it("is not yieldable as an Effect", () => {
    expect(Effect.isEffect(error)).toBe(false);
  });
});

describe("marker readers", () => {
  const annotated = Schema.String.annotate({
    [XML]: { name: "{u}a", plan: () => plan, wire: "p:a" },
  });

  it("reads the three marker fields", () => {
    const marker = markerOf(annotated);

    expect(marker?.name).toBe("{u}a");
    expect(marker?.wire).toBe("p:a");
    expect(marker?.plan()).toBe(plan);
  });

  it("reads the element name", () => {
    expect(elementName(annotated)).toBe("{u}a");
  });

  it("returns the plan the marker yields", () => {
    expect(planOf(annotated)).toBe(plan);
  });

  it("yields undefined for an unannotated schema", () => {
    expect(markerOf(Schema.String)).toBeUndefined();
    expect(elementName(Schema.String)).toBeUndefined();
    expect(planOf(Schema.String)).toBeUndefined();
  });

  it("yields undefined for a marker missing wire", () => {
    const partial = Schema.String.annotate({ [XML]: { name: "{u}a", plan: () => plan } });

    expect(markerOf(partial)).toBeUndefined();
    expect(elementName(partial)).toBeUndefined();
    expect(planOf(partial)).toBeUndefined();
  });
});

describe("qname", () => {
  const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";
  const MATHML = "http://www.w3.org/1998/Math/MathML";

  it("resolves xml: without a map entry", () => {
    expect(qname({})("xml:lang", "attribute")).toEqual({
      name: `{${XML_NAMESPACE}}lang`,
      ok: true,
    });
  });

  it("resolves a declared prefix", () => {
    expect(qname({ "": QTI, m: MATHML })("m:math", "element")).toEqual({
      name: `{${MATHML}}math`,
      ok: true,
    });
  });

  it("puts an unprefixed element in the default namespace", () => {
    expect(qname({ "": QTI })("qti-item-body", "element")).toEqual({
      name: `{${QTI}}qti-item-body`,
      ok: true,
    });
  });

  it("keeps an unprefixed attribute in no namespace under a default binding", () => {
    expect(qname({ "": QTI })("max-choices", "attribute")).toEqual({
      name: "max-choices",
      ok: true,
    });
  });

  it("leaves an unprefixed element in no namespace without a default", () => {
    expect(qname({})("foo", "element")).toEqual({ name: "foo", ok: true });
  });

  it("fails naming the prefix and key for an undeclared prefix", () => {
    const result = qname({})("x:a", "element");

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.message).toContain('"x"');
      expect(result.message).toContain('"x:a"');
    }
  });

  it("leaves an unprefixed element in no namespace under an empty default", () => {
    expect(qname({ "": "" })("foo", "element")).toEqual({ name: "foo", ok: true });
  });

  it("fails a prefix bound to the empty namespace", () => {
    const result = qname({ p: "" })("p:a", "element");

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.message).toContain('"p"');
      expect(result.message).toContain("empty namespace");
    }
  });

  it("reads only own keys of the prefix map", () => {
    const result = qname({})("constructor:x", "element");

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.message).toContain('"constructor"');
    }
  });
});

/**
 * Type a resolved-element schema as an element codec test double.
 *
 * @param schema - The schema to type, marked or deliberately unmarked.
 * @returns The same schema, typed as an element codec with authored name `Name` and type `T`.
 */
const asElement = <Name extends string = string, T = unknown>(
  schema: typeof ResolvedElementSchema,
): Element<Name, T> =>
  // SAFETY: the authored name and decoded type exist only in types; the tests that read them never
  // run the schema, and the tests that run it read only the marker annotation.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test double is type-level only.
  schema as Element<Name, T>;

/**
 * Build an element codec test double carrying a marker with the given Clark and wire names.
 *
 * @param name - The Clark name.
 * @param wire - The authored wire name.
 * @returns A codec that `lower` accepts as a child.
 */
const codec = <Name extends string = string, T = unknown>(
  name: string,
  wire: string,
): Element<Name, T> =>
  asElement<Name, T>(
    ResolvedElementSchema.annotate({
      [XML]: { name, plan: () => ({ ...plan, name, wire }), wire },
    }),
  );

/**
 * Return the plan of a successful lowering, or throw the definition error so the test fails.
 *
 * @param result - The lowering outcome.
 * @returns The plan.
 */
const unwrap = (result: Result.Result<Plan, DefinitionError>): Plan =>
  Result.match(result, {
    onFailure: (error) => {
      throw error;
    },
    onSuccess: (value) => value,
  });

describe("lower", () => {
  const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

  const Prompt = codec(`{${QTI}}qti-prompt`, "qti-prompt");
  const Choice = codec(`{${QTI}}qti-simple-choice`, "qti-simple-choice");

  it("lowers attributes, data, and element children", () => {
    const data = Schema.String;

    const lowered = unwrap(
      lower(
        "qti-choice-interaction",
        {
          attributes: {
            "data-*": data,
            "max-choices": Schema.Int,
            "min-choices": Schema.optionalKey(Schema.Int),
            "response-identifier": Schema.String,
          },
          content: elements({ choices: many(Choice), prompt: optional(Prompt) }),
        },
        { "": QTI },
      ),
    );

    expect(lowered.name).toBe(`{${QTI}}qti-choice-interaction`);
    expect(lowered.wire).toBe("qti-choice-interaction");
    expect(lowered.prefixes).toEqual({ "": QTI });
    expect(lowered.attributes.map((a) => [a.key, a.name])).toEqual([
      ["max-choices", "max-choices"],
      ["min-choices", "min-choices"],
      ["response-identifier", "response-identifier"],
    ]);
    expect(lowered.data).toBe(data);
    expect(lowered.content.mode).toBe("elements");

    if (lowered.content.mode === "elements") {
      expect(lowered.content.children.map((c) => [c.key, c.cardinality, c.name, c.wire])).toEqual([
        ["choices", "many", `{${QTI}}qti-simple-choice`, "qti-simple-choice"],
        ["prompt", "optional", `{${QTI}}qti-prompt`, "qti-prompt"],
      ]);
    }
  });

  it("rejects a declared data- attribute alongside data-*", () => {
    const result = lower(
      "input",
      { attributes: { "data-*": Schema.String, "data-patternmask-message": Schema.Int } },
      {},
    );

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(DefinitionError);
      expect(result.failure.message).toContain("data-patternmask-message");
      expect(result.failure.message).toContain("input");
    }
  });

  it("lowers a declared data- attribute without data-* as an ordinary attribute", () => {
    const lowered = unwrap(lower("input", { attributes: { "data-x": Schema.Int } }, {}));

    expect(lowered.attributes.map((a) => a.key)).toEqual(["data-x"]);
    expect(lowered.data).toBeUndefined();
  });

  it("fills data from data-* alone", () => {
    const data = Schema.String;
    const lowered = unwrap(lower("input", { attributes: { "data-*": data } }, {}));

    expect(lowered.attributes).toEqual([]);
    expect(lowered.data).toBe(data);
  });

  it("lowers a bare child as cardinality one", () => {
    const lowered = unwrap(lower("a", { content: elements({ only: Prompt }) }, {}));

    expect(lowered.content.mode === "elements" && lowered.content.children[0]?.cardinality).toBe(
      "one",
    );
  });

  it("lowers an absent spec to empty content", () => {
    const lowered = unwrap(lower("br", {}, {}));

    expect(lowered.content).toEqual({ mode: "empty" });
    expect(lowered.wire).toBe("br");
    expect(lowered.name).toBe("br");
    expect(lowered.data).toBeUndefined();
  });

  it("lowers text content under the key $text", () => {
    const lowered = unwrap(lower("qti-value", { content: text(Schema.String) }, {}));

    expect(lowered.content).toEqual({ key: "$text", mode: "text", schema: Schema.String });
  });

  it("fails for a child without a marker, naming the parent and slot", () => {
    const result = lower(
      "qti-choice-interaction",
      {
        content: elements({
          prompt: asElement(ResolvedElementSchema),
        }),
      },
      { "": QTI },
    );

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(DefinitionError);
      expect(result.failure.message).toContain('<qti-choice-interaction> child "prompt"');
      expect(result.failure.message).toContain("expected an element codec");
    }
  });

  it("lowers mixed members from their markers, keeping the authored wire name", () => {
    const MATHML = "http://www.w3.org/1998/Math/MathML";
    const P = codec(`{${QTI}}p`, "p");
    const Math = codec(`{${MATHML}}math`, "m:math");

    const lowered = unwrap(
      lower("qti-item-body", { content: mixed([P, Math]) }, { "": QTI, m: MATHML }),
    );

    expect(lowered.content.mode).toBe("mixed");

    if (lowered.content.mode === "mixed") {
      expect(lowered.content.key).toBe("$children");
      expect(lowered.content.members.map((m) => [m.name, m.wire])).toEqual([
        [`{${QTI}}p`, "p"],
        [`{${MATHML}}math`, "m:math"],
      ]);
      expect(lowered.content.members[0]?.schema).toBe(P);
      expect(lowered.content.members[1]?.schema).toBe(Math);
    }
  });

  it("fails for a mixed member without a marker, naming the parent and index", () => {
    const P = codec(`{${QTI}}p`, "p");

    const result = lower(
      "qti-item-body",
      {
        content: mixed([P, asElement(ResolvedElementSchema)]),
      },
      { "": QTI },
    );

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(DefinitionError);
      expect(result.failure.message).toContain("<qti-item-body>");
      expect(result.failure.message).toContain("mixed member 1");
    }
  });

  it("fails for an undeclared prefix on the element name", () => {
    const result = lower("x:a", {}, {});

    expect(Result.isFailure(result) && result.failure.message).toContain('"x:a"');
  });

  it("fails for an undeclared prefix on an attribute", () => {
    const result = lower("a", { attributes: { "x:b": Schema.String } }, {});

    expect(Result.isFailure(result) && result.failure.message).toContain('"x:b"');
  });

  describe("an attribute key shared with a content key", () => {
    const collisions: readonly {
      readonly expected: RegExp;
      readonly label: string;
      readonly spec: Parameters<typeof lower>[1];
    }[] = [
      {
        expected: /"p".*attribute "prompt".*child slot "prompt"/u,
        label: "an elements slot",
        spec: { attributes: { prompt: Schema.String }, content: elements({ prompt: Prompt }) },
      },
    ];

    for (const { expected, label, spec } of collisions) {
      it(`fails for ${label}, naming both declarations`, () => {
        const result = lower("p", spec, { "": QTI });

        expect(Result.isFailure(result)).toBe(true);

        if (Result.isFailure(result)) {
          expect(result.failure).toBeInstanceOf(DefinitionError);
          expect(result.failure.message).toMatch(expected);
        }
      });
    }

    const neighbours: readonly {
      readonly label: string;
      readonly spec: Parameters<typeof lower>[1];
    }[] = [
      {
        label: "text content",
        spec: { attributes: { lang: Schema.String }, content: text(Schema.String) },
      },
      { label: "a mixed body", spec: { attributes: { class: Schema.String }, content: mixed([]) } },
      {
        label: "text content, keyed text since the content decodes under $text",
        spec: { attributes: { text: Schema.String }, content: text(Schema.String) },
      },
      {
        label: "a mixed body, keyed children since the content decodes under $children",
        spec: { attributes: { children: Schema.String }, content: mixed([]) },
      },
      {
        label: "an elements slot",
        spec: { attributes: { id: Schema.String }, content: elements({ prompt: Prompt }) },
      },
      {
        label: "open elements content",
        spec: { attributes: { id: Schema.String }, content: elements({}, { open: true }) },
      },
      {
        label: "content that does not use the key",
        spec: {
          attributes: { children: Schema.String, text: Schema.String },
          content: elements({ prompt: Prompt }),
        },
      },
    ];

    for (const { label, spec } of neighbours) {
      it(`lowers a non-colliding attribute beside ${label}`, () => {
        expect(Result.isSuccess(lower("p", spec, { "": QTI }))).toBe(true);
      });
    }
  });

  describe("an authored name that is not an XML name", () => {
    const XSI = "http://www.w3.org/2001/XMLSchema-instance";

    const rejected: readonly {
      readonly expected: RegExp;
      readonly label: string;
      readonly lowering: () => Result.Result<Plan, DefinitionError>;
    }[] = [
      {
        expected: /^Element "\$text" is not an XML name/u,
        label: "an element named $text",
        lowering: () => lower("$text", {}, {}),
      },
      {
        expected: /^Element "p".*mixed member 0 "\$text".*not an XML name/u,
        label: "a mixed member named $text",
        lowering: () => lower("p", { content: mixed([codec("$text", "$text")]) }, {}),
      },
      {
        expected: /^Element "p".*child "body" as "\$text".*not an XML name/u,
        label: "an elements slot whose hand-written marker is named $text",
        lowering: () => lower("p", { content: elements({ body: codec("$text", "$text") }) }, {}),
      },
      {
        expected: /^Element "p".*attribute "a b".*not an XML name/u,
        label: 'an attribute keyed "a b"',
        lowering: () => lower("p", { attributes: { "a b": Schema.String } }, {}),
      },
      {
        expected: /^Element "p".*attribute "1x".*not an XML name/u,
        label: 'an attribute keyed "1x"',
        lowering: () => lower("p", { attributes: { "1x": Schema.String } }, {}),
      },
      {
        expected: /^Element "p".*attribute "\$text".*not an XML name/u,
        label: "an attribute keyed $text beside text content",
        lowering: () =>
          lower("p", { attributes: { $text: Schema.String }, content: text(Schema.String) }, {}),
      },
      {
        expected: /^Element "p".*attribute "\$children".*not an XML name/u,
        label: "an attribute keyed $children beside mixed content",
        lowering: () =>
          lower("p", { attributes: { $children: Schema.String }, content: mixed([]) }, {}),
      },
      {
        expected: /^Element "p".*attribute "\*".*not an XML name/u,
        label: 'an attribute keyed "*" beside open elements content',
        lowering: () =>
          lower(
            "p",
            { attributes: { "*": Schema.String }, content: elements({}, { open: true }) },
            {},
          ),
      },
    ];

    for (const { expected, label, lowering } of rejected) {
      it(`fails for ${label}, naming the definition and the name`, () => {
        const result = lowering();

        expect(Result.isFailure(result)).toBe(true);

        if (Result.isFailure(result)) {
          expect(result.failure).toBeInstanceOf(DefinitionError);
          expect(result.failure.message).toMatch(expected);
        }
      });
    }

    it("throws from Element() for an element named $text", () => {
      expect(() => Element("$text")).toThrow(DefinitionError);
    });

    const accepted: readonly {
      readonly label: string;
      readonly lowering: () => Result.Result<Plan, DefinitionError>;
    }[] = [
      {
        label: "the reserved xml:lang attribute",
        lowering: () => lower("p", { attributes: { "xml:lang": Schema.String } }, {}),
      },
      {
        label: "a declared xsi:schemaLocation attribute",
        lowering: () =>
          lower("p", { attributes: { "xsi:schemaLocation": Schema.String } }, { xsi: XSI }),
      },
      {
        label: "the data-* group",
        lowering: () => lower("p", { attributes: { "data-*": Schema.String } }, {}),
      },
      {
        label: "element and attribute names with letters beyond ASCII",
        lowering: () =>
          lower("größe", { attributes: { "maß_1.v-x·y": Schema.String } }, { "": QTI }),
      },
      {
        label: "a mixed member with a prefixed name",
        lowering: () =>
          lower("p", { content: mixed([codec("{urn:m}math", "m:math")]) }, { m: "urn:m" }),
      },
    ];

    for (const { label, lowering } of accepted) {
      it(`lowers ${label}`, () => {
        expect(Result.isSuccess(lowering())).toBe(true);
      });
    }
  });
});

describe("names the XML 1.0 section 2.3 productions admit", () => {
  it.effect("defines, decodes, and round-trips an element named with combining marks", () =>
    Effect.gen(function* roundTripsHindi() {
      const Hindi = Element("हिन्दी", { content: text(Schema.String) });
      const input: ResolvedElement = { attributes: {}, children: ["x"], name: "हिन्दी" };
      const value = yield* Schema.decodeUnknownEffect(Hindi)(input);
      const encoded = yield* Schema.encodeUnknownEffect(Hindi)(value);

      expect(value.$text).toBe("x");
      expect(encoded).toEqual(input);
    }),
  );

  it.effect("defines, decodes, and round-trips an attribute keyed with a decomposed accent", () =>
    Effect.gen(function* roundTripsAccent() {
      const Accented = Element("p", { attributes: { "cafe\u0301": Schema.String } });

      const input: ResolvedElement = {
        attributes: { "cafe\u0301": "v" },
        children: [],
        name: "p",
      };

      const value = yield* Schema.decodeUnknownEffect(Accented)(input);
      const encoded = yield* Schema.encodeUnknownEffect(Accented)(value);

      expect(value["cafe\u0301"]).toBe("v");
      expect(encoded).toEqual(input);
    }),
  );
});

/**
 * Lower `content` under a bare element and read its mode and `open` flag.
 *
 * @param content - The content declaration to lower.
 * @returns The lowered mode and the plan's `open` flag, `undefined` for modes without one.
 */
const openOf = (content: Parameters<typeof lower>[1]["content"]) => {
  const result = lower("x", { content }, {});

  if (Result.isFailure(result)) {
    throw new Error("expected lowering to succeed");
  }

  const lowered = result.success.content;

  return lowered.mode === "elements" || lowered.mode === "mixed"
    ? { mode: lowered.mode, open: lowered.open }
    : { mode: lowered.mode, open: undefined };
};

describe("open content", () => {
  it("lowers elements({}, { open: true }) to an open elements plan", () => {
    expect(openOf(elements({}, { open: true }))).toEqual({ mode: "elements", open: true });
  });

  it("lowers mixed([], { open: true }) to an open mixed plan", () => {
    expect(openOf(mixed([], { open: true }))).toEqual({ mode: "mixed", open: true });
  });

  it("lowers the same specs without the option to closed plans", () => {
    expect(openOf(elements({}))).toEqual({ mode: "elements", open: false });
    expect(openOf(mixed([]))).toEqual({ mode: "mixed", open: false });
  });

  it("lowers an explicit open: false to a closed plan", () => {
    expect(openOf(elements({}, { open: false }))).toEqual({ mode: "elements", open: false });
    expect(openOf(mixed([], { open: false }))).toEqual({ mode: "mixed", open: false });
  });

  it("keeps empty and text content free of an open flag", () => {
    expect(openOf({ mode: "empty" })).toEqual({ mode: "empty", open: undefined });
  });
});

/**
 * The constraint that accepts every element codec, whatever its name, type, and services.
 */
type AnyCodec = Element<string, unknown, unknown, unknown>;

/**
 * A two-field model a `decodeTo` element codec decodes into.
 */
class Model extends Schema.Class<Model>("Model")({ count: Schema.Number, label: Schema.String }) {}

/**
 * Read the authored element name of an element codec at the type level.
 *
 * @param _codec - The element codec whose name is inferred.
 * @returns `None`; the inferred `Option` type carries the name.
 */
const nameOf = <N extends string>(
  _codec: Element<N, unknown, unknown, unknown>,
): Option.Option<N> => Option.none();

describe("element codec carrier", () => {
  const Prompt = codec<"prompt", { readonly text: string }>("{u}prompt", "prompt");

  const annotated = Prompt.annotate({});
  const checked = Prompt.pipe(Schema.check(Schema.makeFilter((p) => p.text.length > 0)));
  const branded = Prompt.pipe(Schema.brand("B"));

  const modelled = Prompt.pipe(
    Schema.decodeTo(Model, {
      decode: SchemaGetter.transform((p: { readonly text: string }) => ({
        count: p.text.length,
        label: p.text,
      })),
      encode: SchemaGetter.transform((m: { readonly label: string }) => ({ text: m.label })),
    }),
  );

  it("keeps an annotated codec an element codec", () => {
    expectTypeOf(annotated).toExtend<AnyCodec>();
    expectTypeOf(many).toBeCallableWith(annotated);
    expectTypeOf(optional).toBeCallableWith(annotated);
    expectTypeOf(mixed).toBeCallableWith([annotated]);
  });

  it("keeps a checked codec an element codec", () => {
    expectTypeOf(checked).toExtend<AnyCodec>();
    expectTypeOf(many).toBeCallableWith(checked);
    expectTypeOf(optional).toBeCallableWith(checked);
    expectTypeOf(mixed).toBeCallableWith([checked]);
  });

  it("keeps a branded codec an element codec", () => {
    expectTypeOf(branded).toExtend<AnyCodec>();
    expectTypeOf(many).toBeCallableWith(branded);
    expectTypeOf(optional).toBeCallableWith(branded);
    expectTypeOf(mixed).toBeCallableWith([branded]);
  });

  it("keeps a codec decoded into a class an element codec", () => {
    expectTypeOf(modelled).toExtend<AnyCodec>();
    expectTypeOf(many).toBeCallableWith(modelled);
    expectTypeOf(optional).toBeCallableWith(modelled);
    expectTypeOf(mixed).toBeCallableWith([modelled]);
  });

  it("accepts every element codec in the child-slot builders", () => {
    expectTypeOf(many).parameter(0).toEqualTypeOf<AnyElement>();
    expectTypeOf(optional).parameter(0).toEqualTypeOf<AnyElement>();
  });

  it("infers the authored name after brand and decodeTo", () => {
    expectTypeOf(nameOf(branded)).toEqualTypeOf<Option.Option<"prompt">>();
    expectTypeOf(nameOf(modelled)).toEqualTypeOf<Option.Option<"prompt">>();
  });

  it("rejects schemas whose encoded side carries no element name", () => {
    // @ts-expect-error -- a string schema is not an element codec.
    expectTypeOf(many).toBeCallableWith(Schema.String);
    // @ts-expect-error -- a codec over an unnamed resolved element is not an element codec.
    expectTypeOf<Schema.Codec<string, ResolvedElement>>().toExtend<AnyCodec>();
  });

  it("threads decoding services instead of erasing them", () => {
    expectTypeOf<Element<"x", string, "Svc">>().toExtend<AnyCodec>();
    // @ts-expect-error -- the default parameters admit no services.
    expectTypeOf<Element<"x", string, "Svc">>().toExtend<Element<string, unknown>>();
  });
});
