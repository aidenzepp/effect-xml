import { describe, expect, it } from "@effect/vitest";
import * as Brand from "effect/Brand";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";

import { Element, namespaces, suspend } from "./dsl.ts";
import { elements, mixed, planOf, text } from "./plan.ts";
import { carriedChecks, compiledLinks, structuralPlan } from "./structural-slot.ts";

/**
 * The element every row wraps: a text element whose Type is `{ $text: string }`.
 */
const Leaf = Element("leaf", { content: text(Schema.String) });

/**
 * A recursive reference to `Leaf`, the form a `suspend` slot takes.
 */
const LeafRef = suspend("leaf", () => Leaf);

/**
 * The check every `.check` row adds: the leaf text is not empty.
 */
const nonEmpty = Schema.makeFilter((leaf: { readonly $text: string }) => leaf.$text.length > 0);

/**
 * The transformation every `decodeTo` row adds: the leaf decodes to its text.
 */
const toText = {
  decode: SchemaGetter.transform((leaf: { readonly $text: string }) => leaf.$text),
  encode: SchemaGetter.transform((value: string) => ({ $text: value })),
};

/**
 * The leaf plan every structural row returns.
 */
const plan = planOf(Leaf);

describe("structuralPlan", () => {
  const structural: readonly (readonly [string, Schema.Top])[] = [
    ["a bare element", Leaf],
    ["an annotated element", Leaf.annotate({ title: "leaf" })],
    ["a branded element", Leaf.pipe(Schema.brand("Leaf"))],
    ["a suspend reference", LeafRef],
    ["an annotated suspend reference", LeafRef.annotate({ title: "leaf" })],
    ["a branded suspend reference", LeafRef.pipe(Schema.brand("Leaf"))],
    ["a checked element", Leaf.check(nonEmpty)],
    ["a suspend reference to a checked element", suspend("leaf", () => Leaf.check(nonEmpty))],
  ];

  it.each(structural)("gives the plan of %s", (_, schema) => {
    expect(plan).toBeDefined();
    expect(structuralPlan(schema)).toBe(plan);
  });

  // `planOf` sees through each of these, so a `planOf`-based predicate would call them structural.
  const wrapped: readonly (readonly [string, Schema.Top])[] = [
    ["an element decoded to a model", Leaf.pipe(Schema.decodeTo(Schema.String, toText))],
    [
      "an element decoded from its encoded side",
      Schema.toEncoded(Leaf).pipe(Schema.decodeTo(Leaf)),
    ],
    [
      "a suspend reference to an element decoded to a model",
      suspend("leaf", () => Leaf.pipe(Schema.decodeTo(Schema.String, toText))),
    ],
    [
      "a suspend reference decoded from its encoded side",
      Schema.toEncoded(LeafRef).pipe(Schema.decodeTo(LeafRef)),
    ],
  ];

  it.each(wrapped)("gives undefined for %s that planOf reads as an element", (_, schema) => {
    expect(planOf(schema)).toBeDefined();
    expect(structuralPlan(schema)).toBeUndefined();
  });

  const opaque: readonly (readonly [string, Schema.Top])[] = [
    ["an element annotated with parseOptions", Leaf.annotate({ parseOptions: { errors: "all" } })],
    [
      "a suspend reference annotated with parseOptions",
      LeafRef.annotate({ parseOptions: { errors: "all" } }),
    ],
    ["a schema that is not an element", Schema.String],
  ];

  it.each(opaque)("gives undefined for %s", (_, schema) => {
    expect(structuralPlan(schema)).toBeUndefined();
  });
});

describe("structuralPlan on ambiguous mixed members", () => {
  /**
   * A `p` member in `urn:a`.
   */
  const PA = namespaces({ "": "urn:a" }).Element("p", { content: text(Schema.String) });

  /**
   * A `p` member in `urn:b`: the wire tag of {@link PA} under another Clark name.
   */
  const PB = namespaces({ "": "urn:b" }).Element("p", { content: text(Schema.String) });

  /**
   * A mixed element listing one wire tag under two Clark names.
   */
  const Wire = Element("r", { content: mixed([PA, PB]) });

  /**
   * A mixed element listing one Clark name twice.
   */
  const Clark = Element("r", { content: mixed([Leaf, Leaf.annotate({ title: "leaf" })]) });

  const ambiguous: readonly (readonly [string, Schema.Top])[] = [
    ["one wire tag in two namespaces", Wire],
    ["one Clark name twice", Clark],
    ["a checked element with one wire tag twice", Wire.check(Schema.makeFilter(() => true))],
    ["a suspend reference to one", suspend("r", () => Wire)],
  ];

  it.each(ambiguous)("gives undefined for %s", (_, schema) => {
    expect(planOf(schema)).toBeDefined();
    expect(structuralPlan(schema)).toBeUndefined();
  });

  it("gives the plan of distinct members", () => {
    const schema = Element("r", { content: mixed([Leaf, PA]) });

    expect(structuralPlan(schema)).toBe(planOf(schema));
  });

  it("keeps a parent holding an ambiguous slot structural", () => {
    const schema = Element("holder", { content: elements({ body: Wire, leaf: Leaf }) });

    expect(structuralPlan(schema)).toBe(planOf(schema));
  });
});

describe("carriedChecks", () => {
  /**
   * The brand constructor the `fromBrand` row applies: the leaf text is not empty.
   */
  const NonEmptyLeaf = Brand.check<{ readonly $text: string } & Brand.Brand<"NonEmptyLeaf">>(
    nonEmpty,
  );

  const checked: readonly (readonly [string, Schema.Top])[] = [
    ["a checked element", Leaf.check(nonEmpty)],
    ["a checked, annotated element", Leaf.check(nonEmpty).annotate({ title: "leaf" })],
    ["a checked, branded element", Leaf.check(nonEmpty).pipe(Schema.brand("Leaf"))],
    ["a Schema.fromBrand element", Leaf.pipe(Schema.fromBrand("NonEmptyLeaf", NonEmptyLeaf))],
    ["a suspend reference to a checked element", suspend("leaf", () => Leaf.check(nonEmpty))],
  ];

  it.each(checked)("gives the user's own filter for %s", (_, schema) => {
    const [check] = carriedChecks(schema) ?? [];

    expect(structuralPlan(schema)).toBe(plan);
    expect(carriedChecks(schema)).toHaveLength(1);
    expect(check?._tag === "Filter" && check.run).toBe(nonEmpty.run);
  });

  const unchecked: readonly (readonly [string, Schema.Top])[] = [
    ["a bare element", Leaf],
    ["a branded element", Leaf.pipe(Schema.brand("Leaf"))],
    ["a suspend reference", LeafRef],
    ["an element decoded to a model", Leaf.pipe(Schema.decodeTo(Schema.String, toText))],
    ["a schema that is not an element", Schema.String],
  ];

  it.each(unchecked)("gives undefined for %s", (_, schema) => {
    expect(carriedChecks(schema)).toBeUndefined();
  });

  it("keeps a checked element annotated with parseOptions opaque", () => {
    const schema = Leaf.check(nonEmpty).annotate({ parseOptions: { errors: "all" } });

    expect(structuralPlan(schema)).toBeUndefined();
    expect(carriedChecks(schema)).toBeUndefined();
  });
});

describe("compiledLinks", () => {
  const [link] = Leaf.ast.encoding ?? [];

  it("registers the one encoding link compile builds", () => {
    expect(Leaf.ast.encoding).toHaveLength(1);
    expect(link !== undefined && compiledLinks.has(link)).toBe(true);
  });

  it("keeps the registered link through annotate and brand", () => {
    expect(Leaf.annotate({ title: "leaf" }).ast.encoding?.[0]).toBe(link);
    expect(Leaf.pipe(Schema.brand("Leaf")).ast.encoding?.[0]).toBe(link);
  });
});
