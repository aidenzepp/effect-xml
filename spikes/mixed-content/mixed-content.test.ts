// SPIKE-01: mixed content representation. Runs approaches A, B (and the C
// variant of B) against the fixtures named in docs/rd/spike-plan.md. Run with
// `bun test spikes/mixed-content`.
import { expect, expectTypeOf, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import { Schema } from "effect";
import * as Stream from "effect/Stream";
import { Xml } from "effect/encoding";
import * as A from "./approach-a.ts";
import * as B from "./approach-b.ts";

// ---------------------------------------------------------------------------
// Fixture access and a local comparator (copied shape, nothing imported).

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/qti/${name}`, import.meta.url), "utf-8");

const rootOf = (xml: string, root: string) =>
  Effect.map(
    Stream.make(xml).pipe(
      Stream.pipeThroughChannel(Xml.decodeString()),
      Stream.pipeThroughChannel(Xml.elements([root])),
      Stream.runCollect,
    ),
    (els) => els[0]!,
  );

const findAll = (el: Xml.Element, name: string): Array<Xml.Element> =>
  el.children.flatMap((c) =>
    typeof c === "string" ? [] : c.name === name ? [c] : findAll(c, name),
  );

// Content modes from branches/mixed-content.md: these names are `elements`
// mode, so whitespace-only text between their children is not significant.
// Everything else compared here is `mixed` and keeps every string child.
const elementsMode = new Set([
  "qti-item-body",
  "div",
  "blockquote",
  "video",
  "qti-hottext-interaction",
  "qti-choice-interaction",
]);

const normalize = (el: Xml.Element): Xml.Element => ({
  name: el.name,
  attributes: el.attributes,
  children: el.children.flatMap((c): Array<string | Xml.Element> =>
    typeof c === "string"
      ? elementsMode.has(el.name) && c.trim() === ""
        ? []
        : [c]
      : [normalize(c)],
  ),
});

const equalElement = (a: Xml.Element, b: Xml.Element) =>
  JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

// Reference rendering straight from the upstream tree, in document order. Every
// approach's renderer must reproduce this string.
const renderRaw = (c: string | Xml.Element): string => {
  if (typeof c === "string") return c;
  const inner = c.children.map(renderRaw).join("");
  switch (c.name) {
    case "br":
      return "<br/>";
    case "qti-text-entry-interaction":
      return `[${c.attributes["response-identifier"]}]`;
    case "qti-hottext":
      return `{${c.attributes.identifier}:${inner}}`;
    case "strong":
      return `*${inner}*`;
    default:
      return inner;
  }
};

// ---------------------------------------------------------------------------
// Renderers. The line counts between the markers are the C3 measurement.

// render-A:start
const renderA = (node: A.Inline): string => {
  switch (node._tag) {
    case "text":
      return node.text;
    case "br":
      return "<br/>";
    case "qti-text-entry-interaction":
      return `[${node.attributes["response-identifier"]}]`;
    case "qti-hottext":
      return `{${node.attributes.identifier}:${node.content.map(renderA).join("")}}`;
    case "strong":
      return `*${node.content.map(renderA).join("")}*`;
    default:
      return node satisfies never;
  }
};
// render-A:end

type PB = (typeof B.B.P)["Type"];
type StrongB = PB["strong"][number];
type HottextB = PB["qti-hottext"][number];

// render-B:start
// B keeps no element order. The only rule the shape supports is "text runs by
// `at`, element children in field declaration order", which is what the branch
// file names as B's encode rule.
const childrenB = (p: PB) => [
  ...p.strong.map((n) => `*${n.text.map((t) => t.text).join("")}*`),
  ...p.br.map(() => "<br/>"),
  ...p["qti-text-entry-interaction"].map((n) => `[${n.attributes["response-identifier"]}]`),
  ...p["qti-hottext"].map(
    (n) => `{${n.attributes.identifier}:${n.text.map((t) => t.text).join("")}}`,
  ),
];
const renderB = (p: PB): string => {
  const els = childrenB(p);
  const textAt = (i: number) =>
    p.text
      .filter((t) => t.at === i)
      .map((t) => t.text)
      .join("");
  return els.map((e, i) => textAt(i) + e).join("") + textAt(els.length);
};
// render-B:end

// render-C:start
// C walks `order`; each entry names the field and the index inside it.
const renderC = (p: PB): string =>
  p.order
    .map(([field, i]) => {
      switch (field) {
        case "text":
          return p.text[i]!.text;
        case "br":
          return "<br/>";
        case "strong":
          return `*${renderC(p.strong[i]! as unknown as PB)}*`;
        case "qti-text-entry-interaction":
          return `[${p["qti-text-entry-interaction"][i]!.attributes["response-identifier"]}]`;
        case "qti-hottext":
          return `{${p["qti-hottext"][i]!.attributes.identifier}:${renderC(p["qti-hottext"][i]! as unknown as PB)}}`;
        default:
          return "";
      }
    })
    .join("");
// render-C:end

// ---------------------------------------------------------------------------
// Cases: every `<p>` the plan names, plus the branch file's interleaving example.

const cases = [
  { name: "bg010-missing-word.xml", path: "p", count: 2, interleaved: true },
  { name: "text-entry-cloze.xml", path: "p", count: 1, interleaved: false },
  { name: "hottext.xml", path: "p", count: 1, interleaved: false },
  { name: "bg011-media.xml", path: "p", count: 3, interleaved: false },
] as const;

const run = <T, E>(e: Effect.Effect<T, E>) => Effect.runPromise(e);

const decodeA = Schema.decodeUnknownEffect(A.P);
const encodeA = Schema.encodeEffect(A.P);
const decodeB = Schema.decodeUnknownEffect(B.B.P);
const encodeB = Schema.encodeEffect(B.B.P);
const decodeC = Schema.decodeUnknownEffect(B.C.P);
const encodeC = Schema.encodeEffect(B.C.P);

for (const c of cases) {
  test(`A: ${c.name} renders every <p> in document order and round-trips`, async () => {
    const ps = findAll(await run(rootOf(fixture(c.name), "qti-assessment-item")), c.path);
    expect(ps.length).toBe(c.count);
    for (const p of ps) {
      const value = await run(decodeA(p));
      expect(value.content.map(renderA).join("")).toBe(p.children.map(renderRaw).join(""));
      expect(equalElement(await run(encodeA(value)), p)).toBe(true);
    }
  });

  test(`B: ${c.name} ${c.interleaved ? "loses" : "keeps"} document order`, async () => {
    const ps = findAll(await run(rootOf(fixture(c.name), "qti-assessment-item")), c.path);
    const results = await Promise.all(
      ps.map(async (p) => {
        const value = await run(decodeB(p));
        const ordered = renderB(value) === p.children.map(renderRaw).join("");
        const roundTrips = equalElement(await run(encodeB(value)), p);
        return ordered && roundTrips;
      }),
    );
    // Every `<p>` without interleaved element names survives; the blockquote
    // `<p>` in bg010 (br, interaction, br, br) does not.
    expect(results.every(Boolean)).toBe(!c.interleaved);
  });

  test(`C: ${c.name} renders every <p> in document order and round-trips`, async () => {
    const ps = findAll(await run(rootOf(fixture(c.name), "qti-assessment-item")), c.path);
    for (const p of ps) {
      const value = await run(decodeC(p));
      expect(renderC(value)).toBe(p.children.map(renderRaw).join(""));
      expect(equalElement(await run(encodeC(value)), p)).toBe(true);
    }
  });
}

const interleaved = `<p>a<br/>b<strong>y</strong>c<br/>z</p>`;

test("branch counter-example: A and C keep order, B reorders", async () => {
  const p = await run(rootOf(interleaved, "p"));
  const expected = "a<br/>b*y*c<br/>z";
  expect((await run(decodeA(p))).content.map(renderA).join("")).toBe(expected);
  expect(renderC(await run(decodeC(p)))).toBe(expected);
  const b = await run(decodeB(p));
  expect(renderB(b)).not.toBe(expected);
  expect(renderB(b)).toBe("a*y*b<br/>c<br/>z");
  expect(equalElement(await run(encodeB(b)), p)).toBe(false);
});

test("qti-simple-choice (bg007) decodes and round-trips under A, B, C", async () => {
  const choices = findAll(
    await run(rootOf(fixture("bg007-true-false.xml"), "qti-assessment-item")),
    "qti-simple-choice",
  );
  expect(choices.length).toBe(2);
  for (const choice of choices) {
    const a = await run(Schema.decodeUnknownEffect(A.SimpleChoice)(choice));
    expect(a.attributes.identifier).toBe(choice.attributes.identifier);
    expect(equalElement(await run(Schema.encodeEffect(A.SimpleChoice)(a)), choice)).toBe(true);
    const b = await run(Schema.decodeUnknownEffect(B.B.SimpleChoice)(choice));
    expect(equalElement(await run(Schema.encodeEffect(B.B.SimpleChoice)(b)), choice)).toBe(true);
    const c = await run(Schema.decodeUnknownEffect(B.C.SimpleChoice)(choice));
    expect(equalElement(await run(Schema.encodeEffect(B.C.SimpleChoice)(c)), choice)).toBe(true);
  }
});

test("nested strong (recursive inline content) decodes under A", async () => {
  const p = await run(
    rootOf(`<p>Choose <strong>one <br/>or <strong>two</strong></strong> answer.</p>`, "p"),
  );
  const a = await run(decodeA(p));
  expect(a.content.map(renderA).join("")).toBe("Choose *one <br/>or *two** answer.");
  expect(equalElement(await run(encodeA(a)), p)).toBe(true);
});

test("an unknown inline element is a Schema issue, not an exception", async () => {
  const p = await run(rootOf(`<p>x<em>y</em></p>`, "p"));
  const a = await run(Effect.flip(decodeA(p)));
  const b = await run(Effect.flip(decodeB(p)));
  console.log(`A unknown child: ${a.message}`);
  console.log(`B unknown child: ${b.message}`);
  expect(a.message).toContain('["content"][1]');
  expect(b.message).toContain("unexpected child element <em>");
});

test("types: A narrows exhaustively on _tag; B exposes named fields", () => {
  expectTypeOf<(typeof A.P)["Type"]["_tag"]>().toEqualTypeOf<"p">();
  expectTypeOf<(typeof A.P)["Type"]["content"][number]>().toEqualTypeOf<A.Inline>();
  expectTypeOf<(typeof A.P)["Type"]["attributes"]>().toEqualTypeOf<
    Readonly<Record<string, string>>
  >();
  expectTypeOf<(typeof A.P)["Encoded"]["name"]>().toEqualTypeOf<"p">();
  expectTypeOf<PB["text"][number]>().toEqualTypeOf<{
    readonly at: number;
    readonly text: string;
  }>();
  expectTypeOf<StrongB["br"][number]["attributes"]>().toEqualTypeOf<
    Readonly<Record<string, string>>
  >();
  expectTypeOf<HottextB["strong"]>().toEqualTypeOf<ReadonlyArray<StrongB>>();
  expectTypeOf<PB["order"][number]>().toEqualTypeOf<readonly [string, number]>();
});
