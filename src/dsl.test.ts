import { describe, expect, it } from "@effect/vitest";
import type * as Brand from "effect/Brand";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import { expectTypeOf } from "vitest";

import { Element, namespaces, suspend } from "./dsl.ts";
import type { MixedItem } from "./dsl.ts";
import type { ResolvedElement } from "./element.ts";
import type { XmlSchema } from "./index.ts";
import {
  DefinitionError,
  elements,
  many,
  markerOf,
  mixed,
  optional,
  planOf,
  text,
} from "./plan.ts";

const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

const XSI = "http://www.w3.org/2001/XMLSchema-instance";

const MATHML = "http://www.w3.org/1998/Math/MathML";

/**
 * Build a resolved element with a Clark name.
 *
 * @param name - The Clark name.
 * @param children - The element's children.
 * @returns The resolved element.
 */
const node = (name: string, children: ResolvedElement["children"] = []): ResolvedElement => ({
  attributes: {},
  children,
  name,
});

const qti = namespaces({ "": QTI, xsi: XSI });

const Value = qti.Element("qti-value", { content: text(Schema.String) });

const mathml = namespaces({ "": QTI, m: MATHML });

const MathElement = mathml.Element("m:math", { content: text(Schema.String) });

const MathRef = mathml.suspend("m:math", () => MathElement);

const Body = mathml.Element("body", { content: mixed([MathElement]) });

const SuspendedBody = mathml.Element("body", { content: mixed([MathRef]) });

const mathBody = node(`{${QTI}}body`, ["a ", node(`{${MATHML}}math`, ["x"])]);

const mathItems = {
  $children: [
    { _tag: "$text", text: "a " },
    { _tag: "m:math", value: { $text: "x" } },
  ],
};

describe("dsl: element", () => {
  it.effect("decodes an element named by the default namespace of its prefix map", () =>
    Effect.gen(function* decodesValue() {
      const value = yield* Schema.decodeUnknownEffect(Value)(node(`{${QTI}}qti-value`, ["7"]));

      expect(value).toEqual({ $text: "7" });
    }),
  );

  it.effect("rejects an element in no namespace, naming the expected Clark name", () =>
    Effect.gen(function* rejectsValue() {
      const message = yield* Schema.decodeUnknownEffect(Value)(node("qti-value", ["7"])).pipe(
        Effect.flip,
        Effect.map((error) => error.message),
      );

      expect(message).toContain(`{${QTI}}qti-value`);
    }),
  );

  it("types a definition whose schemas need no services as a codec with no services", () => {
    expectTypeOf(Value).toExtend<Schema.Codec<{ readonly $text: string }, ResolvedElement>>();
    expectTypeOf(Value.DecodingServices).toEqualTypeOf<never>();
  });
});

describe("dsl: mixed members through element and suspend", () => {
  it.effect("tags a prefixed member by its authored name through element", () =>
    Effect.gen(function* decodesElementMember() {
      const value = yield* Schema.decodeUnknownEffect(Body)(mathBody);

      expect(value).toEqual(mathItems);
    }),
  );

  it.effect("tags a prefixed member by its authored name through suspend", () =>
    Effect.gen(function* decodesSuspendMember() {
      const value = yield* Schema.decodeUnknownEffect(SuspendedBody)(mathBody);

      expect(value).toEqual(mathItems);
    }),
  );

  it("marks a suspend with its wire name and the inner plan", () => {
    expect(markerOf(MathRef)?.wire).toBe("m:math");
    expect(markerOf(MathRef)?.name).toBe(`{${MATHML}}math`);
    expect(planOf(MathRef)).toBe(planOf(MathElement));
  });
});

describe("dsl: definition errors throw at construction", () => {
  it("throws for a child slot that is not an element codec", () => {
    expect(() =>
      Element("qti-choice-interaction", {
        // @ts-expect-error -- a child slot that is not an element codec is the mistake under test.
        content: elements({ prompt: optional(Schema.String) }),
      }),
    ).toThrow(/child "prompt"/u);
  });

  it("throws for an undeclared prefix", () => {
    expect(() => Element("x:a")).toThrow(/x/u);
  });

  it("throws for an undeclared prefix in a suspend name", () => {
    expect(() => suspend("x:a", () => Element("a"))).toThrow(/"x"/u);
  });

  it("throws for a suspend name that is not an XML name", () => {
    expect(() => suspend("$text", () => Element("p"))).toThrow(DefinitionError);
    expect(() => suspend("$text", () => Element("p"))).toThrow(/"\$text".*not an XML name/u);
    expect(() => suspend("a b", () => Element("p"))).toThrow(DefinitionError);
    expect(() => suspend("a b", () => Element("p"))).toThrow(/"a b".*not an XML name/u);
  });

  it("defines a prefixed suspend name under a prefix map that binds the prefix", () => {
    const q = namespaces({ q: QTI });
    const Item = q.Element("q:item");
    const ItemRef = q.suspend("q:item", () => Item);

    expect(markerOf(ItemRef)?.name).toBe(`{${QTI}}item`);
  });

  it("throws for an attribute key that equals an elements slot key", () => {
    expect(() =>
      Element("p", {
        attributes: { prompt: Schema.String },
        content: elements({ prompt: Element("prompt") }),
      }),
    ).toThrow(/"p".*attribute "prompt".*child slot "prompt"/u);
  });

  it("types an attribute keyed text beside text content, which decodes under $text", () => {
    const Para = Element("p", {
      attributes: { text: Schema.String },
      content: text(Schema.String),
    });

    expectTypeOf<(typeof Para)["Type"]>().toEqualTypeOf<{
      readonly text: string;
      readonly $text: string;
    }>();
  });
});

const Identifier = Schema.String.pipe(Schema.brand("Identifier"));

const InferredP = Element("p", {
  attributes: { "data-*": Schema.String },
  content: text(Schema.String),
});

const InferredMath = mathml.Element("m:math", { content: text(Schema.String) });

const Attributed = Element("attributed", {
  attributes: {
    flag: Schema.Boolean,
    id: Identifier,
    max: Schema.Int,
    min: Schema.optionalKey(Schema.Int),
  },
});

const Choice = Element("choice", { content: text(Schema.String) });

const Prompt = Element("prompt", { content: text(Schema.String) });

const Interaction = Element("interaction", {
  content: elements({ choices: many(Choice), prompt: optional(Prompt) }),
});

const Flow = Element("flow", { content: mixed([InferredP, InferredMath]) });

interface Div {
  readonly $children: readonly MixedItem<readonly [typeof InferredP, Element<"div", Div>]>[];
  readonly [key: `data-${string}`]: string;
}

const DivCodec: Element<"div", Div> = Element("div", {
  attributes: { "data-*": Schema.String },
  content: mixed([InferredP, suspend("div", () => DivCodec)]),
});

/**
 * Describe a flow item exhaustively, so a missing `_tag` case fails the type check.
 *
 * @param item - One item of the `Flow` content.
 * @returns The item's tag.
 */
const describeItem = (item: (typeof Flow)["Type"]["$children"][number]): string => {
  switch (item._tag) {
    case "$text": {
      return item.text;
    }

    case "p": {
      return "p";
    }

    case "m:math": {
      return item.value.$text;
    }

    default: {
      return item satisfies never;
    }
  }
};

const OpenFlow = Element("open-flow", {
  content: mixed([InferredP, InferredMath], { open: true }),
});

const OpenInteraction = Element("open-interaction", {
  content: elements({ choices: many(Choice), prompt: optional(Prompt) }, { open: true }),
});

interface OpenDiv {
  readonly $children: readonly MixedItem<
    readonly [typeof InferredP, Element<"open-div", OpenDiv>],
    true
  >[];
}

const OpenDivCodec: Element<"open-div", OpenDiv> = Element("open-div", {
  content: mixed([InferredP, suspend("open-div", () => OpenDivCodec)], { open: true }),
});

/**
 * Describe an open flow item exhaustively, so a missing `_tag` case, the generic member
 * included, fails the type check.
 *
 * @param item - One item of the `OpenFlow` content.
 * @returns The item's text, member tag, or generic element name.
 */
const describeOpenItem = (item: (typeof OpenFlow)["Type"]["$children"][number]): string => {
  switch (item._tag) {
    case "$text": {
      return item.text;
    }

    case "p": {
      return "p";
    }

    case "m:math": {
      return item.value.$text;
    }

    case "*": {
      return item.element.name;
    }

    default: {
      return item satisfies never;
    }
  }
};

/**
 * A service the probe attribute reads while decoding.
 */
class Upper extends Context.Service<Upper, { readonly f: (s: string) => string }>()("Upper") {}

/**
 * A string attribute schema whose decoding requires {@link Upper}.
 */
const Svc = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transformEffect((s) =>
      Effect.gen(function* upper() {
        const u = yield* Upper;

        return u.f(s);
      }),
    ),
    encode: SchemaGetter.passthrough(),
  }),
);

const Probe = Element("p", { attributes: { a: Svc } });

const ProbeParent = Element("parent", { content: elements({ items: many(Probe) }) });

const ProbeFlow = Element("probe-flow", { content: mixed([Probe]) });

describe("dsl: helper types nested under Element", () => {
  it("resolves the attribute, content, and optionality helpers through XmlSchema.Element", () => {
    expectTypeOf<
      XmlSchema.Element.AttributesType<{
        readonly id: typeof Schema.String;
        readonly min: Schema.optionalKey<typeof Schema.Number>;
      }>
    >().toEqualTypeOf<{ readonly id: string; readonly min?: number }>();
    expectTypeOf<
      XmlSchema.Element.ContentType<XmlSchema.text<typeof Schema.String>>
    >().toEqualTypeOf<{
      readonly $text: string;
    }>();
    expectTypeOf<
      XmlSchema.Element.IsOptional<Schema.optionalKey<typeof Schema.Number>>
    >().toEqualTypeOf<true>();
  });

  it("splits the services by direction", () => {
    expectTypeOf<
      XmlSchema.Element.DecodingServices<{ readonly a: typeof Svc }, XmlSchema.Empty>
    >().toEqualTypeOf<Upper>();
    expectTypeOf<
      XmlSchema.Element.EncodingServices<{ readonly a: typeof Svc }, XmlSchema.Empty>
    >().toBeNever();
  });

  it("no longer exports the flat helper names", () => {
    // @ts-expect-error -- the flat helper type is gone; `XmlSchema.Element.AttributesType` replaces it.
    expectTypeOf<XmlSchema.AttributesType<never>>().toBeUnknown();
    // @ts-expect-error -- the attribute constraint lives under `XmlSchema.Element.Attributes`.
    expectTypeOf<XmlSchema.Attributes>().toBeUnknown();
    // @ts-expect-error -- the content constraint lives under `XmlSchema.Element.Content`.
    expectTypeOf<XmlSchema.Content>().toBeUnknown();
  });
});

describe("inference", () => {
  it("threads an attribute's decoding services into the element", () => {
    expectTypeOf<(typeof Probe)["DecodingServices"]>().toEqualTypeOf<Upper>();
    expectTypeOf<(typeof Probe)["EncodingServices"]>().toBeNever();
  });

  it("threads a child slot's and a mixed member's services into the parent", () => {
    expectTypeOf<(typeof ProbeParent)["DecodingServices"]>().toEqualTypeOf<Upper>();
    expectTypeOf<(typeof ProbeFlow)["DecodingServices"]>().toEqualTypeOf<Upper>();
  });

  it("keeps never for a service-free element", () => {
    expectTypeOf<(typeof Attributed)["DecodingServices"]>().toBeNever();
    expectTypeOf<(typeof Interaction)["DecodingServices"]>().toBeNever();
    expectTypeOf<(typeof Flow)["EncodingServices"]>().toBeNever();
  });

  it("keeps a suspended reference's services", () => {
    const ProbeRef = suspend("p", () => Probe);

    expectTypeOf<(typeof ProbeRef)["DecodingServices"]>().toEqualTypeOf<Upper>();
  });

  it("keeps a brand, number, boolean, and optional keys on attributes", () => {
    expectTypeOf<(typeof Attributed)["Type"]["id"]>().toEqualTypeOf<
      string & Brand.Brand<"Identifier">
    >();
    expectTypeOf<(typeof Attributed)["Type"]["max"]>().toEqualTypeOf<number>();
    expectTypeOf<(typeof Attributed)["Type"]["flag"]>().toEqualTypeOf<boolean>();
    expectTypeOf<(typeof Attributed)["Type"]["min"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<keyof (typeof Attributed)["Type"]>().toEqualTypeOf<
      "flag" | "id" | "max" | "min"
    >();
    expectTypeOf<{ readonly min?: number }>().toExtend<Pick<(typeof Attributed)["Type"], "min">>();
    expectTypeOf<Pick<(typeof Attributed)["Type"], "min">>().toExtend<{ readonly min?: number }>();
    expect(describeItem({ _tag: "$text", text: "t" })).toBe("t");
  });

  it("tags a text run $text apart from a member element named text", () => {
    const TextMember = Element("text", { content: text(Schema.String) });
    const TextBody = Element("body", { content: mixed([TextMember]) });

    expectTypeOf<(typeof TextBody)["Type"]["$children"][number]["_tag"]>().toEqualTypeOf<
      "$text" | "text"
    >();
  });

  it("maps a data-* group to template-literal keys", () => {
    expectTypeOf<(typeof InferredP)["Type"]>().toExtend<{
      readonly [k: `data-${string}`]: string;
    }>();
    expectTypeOf<keyof (typeof InferredP)["Type"]>().toEqualTypeOf<`data-${string}` | "$text">();
  });

  it("maps child slots to optional keys and readonly arrays", () => {
    expectTypeOf<(typeof Interaction)["Type"]["choices"]>().toEqualTypeOf<
      readonly { readonly $text: string }[]
    >();
    expectTypeOf<(typeof Interaction)["Type"]["prompt"]>().toEqualTypeOf<
      { readonly $text: string } | undefined
    >();
    expectTypeOf<{ readonly prompt?: { readonly $text: string } }>().toExtend<
      Pick<(typeof Interaction)["Type"], "prompt">
    >();
    expectTypeOf<Pick<(typeof Interaction)["Type"], "prompt">>().toExtend<{
      readonly prompt?: { readonly $text: string };
    }>();
  });

  it("tags mixed content by exactly text and the authored member names", () => {
    expectTypeOf<(typeof Flow)["Type"]["$children"][number]["_tag"]>().toEqualTypeOf<
      "$text" | "p" | "m:math"
    >();
  });

  it("leaves no field unknown", () => {
    expectTypeOf<
      (typeof Attributed)["Type"][keyof (typeof Attributed)["Type"]]
    >().not.toBeUnknown();
    expectTypeOf<
      (typeof Interaction)["Type"][keyof (typeof Interaction)["Type"]]
    >().not.toBeUnknown();
    expectTypeOf<(typeof Flow)["Type"]["$children"]>().not.toBeUnknown();
  });

  it("compiles a recursive element with one named interface and suspend", () => {
    expectTypeOf(DivCodec).toEqualTypeOf<Element<"div", Div>>();
    expectTypeOf<Div["$children"][number]["_tag"]>().toEqualTypeOf<"$text" | "p" | "div">();
  });

  it("rejects a non-element child at the type level", () => {
    // @ts-expect-error -- a plain schema in a child slot is not an element codec.
    expect(() => elements({ value: Schema.String })).not.toThrow();
  });

  it("tags open mixed content by text, the authored member names, and the generic member", () => {
    expectTypeOf<(typeof OpenFlow)["Type"]["$children"][number]["_tag"]>().toEqualTypeOf<
      "$text" | "p" | "m:math" | "*"
    >();
    expectTypeOf<
      Extract<(typeof OpenFlow)["Type"]["$children"][number], { readonly _tag: "*" }>["element"]
    >().toEqualTypeOf<ResolvedElement>();
    expect(describeOpenItem({ _tag: "*", element: node("aside") })).toBe("aside");
  });

  it("keeps the generic member out of closed mixed content", () => {
    expectTypeOf<Extract<(typeof Flow)["Type"]["$children"][number]["_tag"], "*">>().toBeNever();
  });

  it("adds the generic slot to an open elements body beside the declared slots", () => {
    expectTypeOf<(typeof OpenInteraction)["Type"]["*"]>().toEqualTypeOf<
      readonly ResolvedElement[]
    >();
    expectTypeOf<keyof (typeof OpenInteraction)["Type"]>().toEqualTypeOf<
      "choices" | "prompt" | "*"
    >();
    expectTypeOf<(typeof OpenInteraction)["Type"]["choices"]>().toEqualTypeOf<
      (typeof Interaction)["Type"]["choices"]
    >();
  });

  it("has no generic slot on a closed elements body", () => {
    const value: (typeof Interaction)["Type"] = { choices: [] };

    expectTypeOf<keyof (typeof Interaction)["Type"]>().toEqualTypeOf<"choices" | "prompt">();
    // @ts-expect-error -- a closed elements body has no "*" slot.
    expect(value["*"]).toBeUndefined();
  });

  it("compiles a recursive open element through suspend", () => {
    expectTypeOf(OpenDivCodec).toEqualTypeOf<Element<"open-div", OpenDiv>>();
    expectTypeOf<OpenDiv["$children"][number]["_tag"]>().toEqualTypeOf<
      "$text" | "p" | "open-div" | "*"
    >();
  });
});

const Defaulted = Element("defaulted", {
  attributes: {
    kept: Schema.optionalKey(
      Schema.NumberFromString.pipe(Schema.withDecodingDefaultKey(Effect.succeed("0"))),
    ),
    omitted: Schema.NumberFromString.pipe(
      Schema.withDecodingDefaultKey(Effect.succeed("0"), { encodingStrategy: "omit" }),
    ),
  },
});

/**
 * Build a resolved `defaulted` element carrying the given attributes.
 *
 * @param attributes - The attributes, by local name.
 * @returns The resolved element.
 */
const defaulted = (attributes: Record<string, string>): ResolvedElement => ({
  attributes,
  children: [],
  name: "defaulted",
});

describe("dsl: attributes with a decoding default", () => {
  it.effect("applies the default when the attribute is absent and encodes it back", () =>
    Effect.gen(function* appliesDefault() {
      const value = yield* Schema.decodeUnknownEffect(Defaulted)(defaulted({}));

      const encoded = yield* Schema.encodeUnknownEffect(Defaulted)(value);

      expect(value).toEqual({ kept: 0, omitted: 0 });
      expect(encoded).toEqual(defaulted({ kept: "0" }));
    }),
  );

  it.effect("keeps a present value and round-trips it, except under the omit strategy", () =>
    Effect.gen(function* keepsPresent() {
      const value = yield* Schema.decodeUnknownEffect(Defaulted)(
        defaulted({ kept: "5", omitted: "7" }),
      );

      const encoded = yield* Schema.encodeUnknownEffect(Defaulted)(value);

      expect(value).toEqual({ kept: 5, omitted: 7 });
      expect(encoded).toEqual(defaulted({ kept: "5" }));
    }),
  );

  it("types the optionalKey-wrapped default as optional although decoding always supplies it", () => {
    expectTypeOf<(typeof Defaulted)["Type"]["kept"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<(typeof Defaulted)["Type"]["omitted"]>().toEqualTypeOf<number>();
  });
});
