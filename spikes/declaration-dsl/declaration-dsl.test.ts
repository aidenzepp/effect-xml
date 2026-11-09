import { describe, expect, expectTypeOf, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import { Xml } from "effect/encoding";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as A from "./benchmark-a.js";
import * as B from "./benchmark-b.js";
import { canonical } from "./canonical.js";
import * as XmlAnnotations from "./xml-annotations.js";
import * as XmlDsl from "./xml-dsl.js";

type Element = Xml.Element;

const readRoot = (file: string) =>
  Effect.runPromise(
    Stream.make(readFileSync(new URL(`../fixtures/qti/${file}`, import.meta.url), "utf-8")).pipe(
      Stream.pipeThroughChannel(Xml.decodeString()),
      Stream.pipeThroughChannel(Xml.elements(["qti-assessment-item"])),
      Stream.runHead,
      Effect.map(Option.getOrThrow),
    ),
  );

/**
 * Returns a copy of the tree with one attribute set on every element named `target`.
 */
const withAttribute = (element: Element, target: string, name: string, value: string): Element => ({
  name: element.name,
  attributes:
    element.name === target ? { ...element.attributes, [name]: value } : element.attributes,
  children: element.children.map((child) =>
    typeof child === "string" ? child : withAttribute(child, target, name, value),
  ),
});

const failureMessage = <T>(effect: Effect.Effect<T, Schema.SchemaError>) =>
  Effect.runPromise(
    Effect.match(effect, {
      onFailure: (error) => error.message,
      onSuccess: () => "decode unexpectedly succeeded",
    }),
  );

const hotspot = await readRoot("bpig-hotspot.xml");
const trueFalse = await readRoot("bg007-true-false.xml");

const decodeA = Schema.decodeUnknownEffect(A.AssessmentItem);
const decodeB = Schema.decodeUnknownEffect(B.AssessmentItem);

describe("approach A: annotated Schema fields", () => {
  test("decodes bpig-hotspot.xml", async () => {
    const item = await Effect.runPromise(decodeA(hotspot));
    expect(String(item.identifier)).toBe("example-hotspot-bicycle");
    expect(item.timeDependent).toBe(false);
    expect(item.lang).toBe("en-GB");
    expect(item.responseDeclarations[0]?.correctResponse?.values.map((v) => v.text)).toEqual([
      "part-crank",
    ]);
    const interaction = item.body.children.find((c) => c._tag === "qti-hotspot-interaction");
    expect(interaction?._tag).toBe("qti-hotspot-interaction");
    if (interaction?._tag === "qti-hotspot-interaction") {
      expect(interaction.value.maxChoices).toBe(1);
      expect(interaction.value.image.width).toBe(640);
      expect(interaction.value.choices.map((c) => String(c.identifier))).toEqual([
        "part-saddle",
        "part-handlebar",
        "part-hub",
        "part-crank",
      ]);
    }
  });

  test("decodes bg007-true-false.xml", async () => {
    const item = await Effect.runPromise(decodeA(trueFalse));
    expect(item.outcomeDeclarations[0]?.defaultValue?.values.map((v) => v.text)).toEqual(["0"]);
    const interaction = item.body.children.find((c) => c._tag === "qti-choice-interaction");
    if (interaction?._tag === "qti-choice-interaction") {
      expect(interaction.value.maxChoices).toBe(1);
      expect(interaction.value.choices.map((c) => [String(c.identifier), c.text])).toEqual([
        ["statement-true", "True"],
        ["statement-false", "False"],
      ]);
    } else {
      throw new Error("no qti-choice-interaction in body");
    }
  });

  test('rejects max-choices="x" with a Schema issue', async () => {
    const message = await failureMessage(
      decodeA(withAttribute(trueFalse, "qti-choice-interaction", "max-choices", "x")),
    );
    expect(message).toMatch(/finite number/);
    expect(message).toMatch(/maxChoices/);
  });

  test("rejects an unknown attribute", async () => {
    const message = await failureMessage(
      decodeA(withAttribute(trueFalse, "qti-assessment-item", "foo", "1")),
    );
    expect(message).toMatch(/unexpected attribute "foo" on <qti-assessment-item>/);
    expect(message).toMatch(/@foo/);
  });

  test("accepts and types a data-* attribute", async () => {
    const item = await Effect.runPromise(decodeA(withAttribute(trueFalse, "p", "data-note", "x")));
    const p = item.body.children.find((c) => c._tag === "p");
    if (p?._tag !== "p") {
      throw new Error("no <p> in body");
    }
    expect(p.value["data-note"]).toBe("x");
    expectTypeOf(p.value["data-note"]).toEqualTypeOf<string>();
  });

  test("detects an unannotated field at definition time instead of guessing", () => {
    expect(() => XmlAnnotations.element("x", Schema.Struct({ identifier: Schema.String }))).toThrow(
      /field "identifier" has no XML role/,
    );
  });
});

describe("approach B: object-form DSL", () => {
  test("decodes bpig-hotspot.xml", async () => {
    const item = await Effect.runPromise(decodeB(hotspot));
    expect(String(item.identifier)).toBe("example-hotspot-bicycle");
    expect(item["time-dependent"]).toBe(false);
    expect(item["xml:lang"]).toBe("en-GB");
    expect(item.responseDeclarations[0]?.correctResponse?.values.map((v) => v.text)).toEqual([
      "part-crank",
    ]);
    const interaction = item.body.children.find((c) => c._tag === "qti-hotspot-interaction");
    if (interaction?._tag === "qti-hotspot-interaction") {
      expect(interaction.value["max-choices"]).toBe(1);
      expect(interaction.value.image.width).toBe(640);
      expect(interaction.value.choices.map((c) => String(c.identifier))).toEqual([
        "part-saddle",
        "part-handlebar",
        "part-hub",
        "part-crank",
      ]);
    } else {
      throw new Error("no qti-hotspot-interaction in body");
    }
  });

  test("decodes bg007-true-false.xml", async () => {
    const item = await Effect.runPromise(decodeB(trueFalse));
    expect(item.outcomeDeclarations[0]?.defaultValue?.values.map((v) => v.text)).toEqual(["0"]);
    const interaction = item.body.children.find((c) => c._tag === "qti-choice-interaction");
    if (interaction?._tag === "qti-choice-interaction") {
      expect(interaction.value["max-choices"]).toBe(1);
      expect(interaction.value.choices.map((c) => [String(c.identifier), c.text])).toEqual([
        ["statement-true", "True"],
        ["statement-false", "False"],
      ]);
    } else {
      throw new Error("no qti-choice-interaction in body");
    }
  });

  test('rejects max-choices="x" with a Schema issue', async () => {
    const message = await failureMessage(
      decodeB(withAttribute(trueFalse, "qti-choice-interaction", "max-choices", "x")),
    );
    expect(message).toMatch(/finite number/);
    expect(message).toMatch(/max-choices/);
  });

  test("rejects an unknown attribute", async () => {
    const message = await failureMessage(
      decodeB(withAttribute(trueFalse, "qti-assessment-item", "foo", "1")),
    );
    expect(message).toMatch(/unexpected attribute "foo" on <qti-assessment-item>/);
    expect(message).toMatch(/@foo/);
  });

  test("accepts and types a data-* attribute", async () => {
    const item = await Effect.runPromise(decodeB(withAttribute(trueFalse, "p", "data-note", "x")));
    const p = item.body.children.find((c) => c._tag === "p");
    if (p?._tag !== "p") {
      throw new Error("no <p> in body");
    }
    expect(p.value["data-note"]).toBe("x");
    expectTypeOf(p.value["data-note"]).toEqualTypeOf<string>();
  });

  test("rejects a non-element child spec at the type level", () => {
    // @ts-expect-error a plain Schema is not an element codec, so it cannot be a child
    const spec = XmlDsl.elements({ value: Schema.String });
    expect(spec.mode).toBe("elements");
  });
});

describe("round trip through one definition", () => {
  const cases = [
    ["A", A.AssessmentItem as Schema.Codec<unknown, Element>],
    ["B", B.AssessmentItem as Schema.Codec<unknown, Element>],
  ] as const;
  for (const [label, codec] of cases) {
    for (const [file, root] of [
      ["bpig-hotspot.xml", hotspot],
      ["bg007-true-false.xml", trueFalse],
    ] as const) {
      test(`${label}: ${file} encodes back to a canonically equal Element`, async () => {
        const decoded = await Effect.runPromise(Schema.decodeUnknownEffect(codec)(root));
        const encoded = await Effect.runPromise(Schema.encodeEffect(codec)(decoded));
        expect(canonical(encoded)).toBe(canonical(root));
        const again = await Effect.runPromise(Schema.decodeUnknownEffect(codec)(encoded));
        expect(again).toEqual(decoded);
      });
    }
  }
});

describe("type inference (C7)", () => {
  test("A: attributes, children, mixed union, encoded side", () => {
    type Item = typeof A.AssessmentItem.Type;
    expectTypeOf<Item["identifier"]>().toEqualTypeOf<typeof A.Identifier.Type>();
    expectTypeOf<Item["timeDependent"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Item["lang"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<(typeof A.ChoiceInteraction.Type)["maxChoices"]>().toEqualTypeOf<number>();
    expectTypeOf<(typeof A.ChoiceInteraction.Type)["choices"]>().toEqualTypeOf<
      ReadonlyArray<typeof A.SimpleChoice.Type>
    >();
    expectTypeOf<(typeof A.P.Type)["data-anything"]>().toEqualTypeOf<string>();
    expectTypeOf<typeof A.AssessmentItem.Encoded>().toEqualTypeOf<Element>();
    type BodyItem = (typeof A.ItemBody.Type)["children"][number];
    expectTypeOf<BodyItem["_tag"]>().toEqualTypeOf<
      "text" | "p" | "qti-choice-interaction" | "qti-hotspot-interaction" | "div"
    >();
    // Exhaustive: TypeScript rejects this function (TS2366) if a `_tag` case is missing.
    const render = (item: BodyItem): string => {
      switch (item._tag) {
        case "text":
          return item.text;
        case "p":
          return item.value.text;
        case "qti-choice-interaction":
          return item.value.choices.map((c) => c.text).join(", ");
        case "qti-hotspot-interaction":
          return item.value.image.src;
        case "div":
          return item.value.children.map(render).join("");
      }
    };
    expect(render({ _tag: "text", text: "ok" })).toBe("ok");
  });

  test("B: attributes, children, mixed union, encoded side", () => {
    type Item = typeof B.AssessmentItem.Type;
    expectTypeOf<Item>().not.toBeUnknown();
    expectTypeOf<Item["identifier"]>().toEqualTypeOf<typeof B.Identifier.Type>();
    expectTypeOf<Item["time-dependent"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Item["xml:lang"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<(typeof B.ChoiceInteraction.Type)["max-choices"]>().toEqualTypeOf<number>();
    expectTypeOf<(typeof B.ChoiceInteraction.Type)["choices"]>().toEqualTypeOf<
      ReadonlyArray<typeof B.SimpleChoice.Type>
    >();
    expectTypeOf<(typeof B.P.Type)["data-anything"]>().toEqualTypeOf<string>();
    expectTypeOf<typeof B.AssessmentItem.Encoded>().toEqualTypeOf<Element>();
    type BodyItem = (typeof B.ItemBody.Type)["children"][number];
    expectTypeOf<BodyItem["_tag"]>().toEqualTypeOf<
      "text" | "p" | "qti-choice-interaction" | "qti-hotspot-interaction" | "div"
    >();
    const render = (item: BodyItem): string => {
      switch (item._tag) {
        case "text":
          return item.text;
        case "p":
          return item.value.text;
        case "qti-choice-interaction":
          return item.value.choices.map((c) => c.text).join(", ");
        case "qti-hotspot-interaction":
          return item.value.image.src;
        case "div":
          return item.value.children.map(render).join("");
      }
    };
    expect(render({ _tag: "text", text: "ok" })).toBe("ok");
  });

  test("recursive div decodes through suspend in both surfaces", async () => {
    const nested: Element = {
      name: "div",
      attributes: { "data-depth": "0" },
      children: [
        {
          name: "div",
          attributes: {},
          children: [{ name: "p", attributes: {}, children: ["deep"] }],
        },
      ],
    };
    for (const Div of [A.Div, B.Div]) {
      const value = await Effect.runPromise(Schema.decodeUnknownEffect(Div)(nested));
      const inner = value.children[0];
      expect(inner?._tag).toBe("div");
      if (inner?._tag === "div") {
        expect(inner.value.children[0]).toEqual({ _tag: "p", value: { text: "deep" } });
      }
      expect(value["data-depth"]).toBe("0");
    }
  });
});
