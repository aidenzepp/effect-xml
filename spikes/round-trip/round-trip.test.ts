import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import type { Xml } from "effect/encoding";
import { canonicalize, defaultInline } from "./canonical.ts";
import { type LossSummary, roundTrip, summarize } from "./pipeline.ts";

// SPIKE-03: canonical equivalence (A) across the corpus, byte identity (B) as a loss inventory.
// Run: bun test spikes/round-trip

const corpus = new URL("../fixtures/qti/", import.meta.url);
const fixtures: Array<[name: string, url: URL]> = readdirSync(corpus)
  .filter((file) => file.endsWith(".xml"))
  .sort()
  .map((file) => [file, new URL(file, corpus)]);
// The corpus has no CDATA (SOURCES.md), so the spike adds its own; see cdata.xml.
fixtures.push(["cdata.xml (spike-owned)", new URL("./cdata.xml", import.meta.url)]);

const losses: Array<LossSummary> = [];

describe("A. canonical equivalence holds across the corpus", () => {
  for (const [name, url] of fixtures) {
    test(`${name}: decode -> elements -> events -> encode -> decode -> elements is canonically equal`, async () => {
      const input = readFileSync(url, "utf-8");
      const trip = await Effect.runPromise(roundTrip(input));
      expect(canonicalize(trip.second)).toBe(canonicalize(trip.first));
      // Stability after one pass: the encoded text is a fixed point of the tree path.
      const again = await Effect.runPromise(roundTrip(trip.encoded));
      expect(again.encoded).toBe(trip.encoded);
      losses.push(await Effect.runPromise(summarize(name, trip)));
    });
  }
});

describe("B. byte identity, measured as a loss inventory", () => {
  test("no fixture survives the tree path byte-for-byte; the table is printed for RESULT.md", () => {
    expect(losses.length).toBe(fixtures.length);
    const header =
      "| fixture | bytes= (tree) | bytes= (events) | declaration | comments | self-closing lost | char refs | &apos;/&quot; | single-quoted | CDATA | multi-line tags | attr order |";
    const rows = losses.map(
      (l) =>
        `| ${l.fixture} | ${l.byteEqualTree} | ${l.byteEqualEvents} | ${l.declaration} | ${l.comments} | ${l.selfClosing} | ${l.charRefs} | ${l.namedRefsLost} | ${l.singleQuoted} | ${l.cdata} | ${l.multiLineTags} | ${l.attributeOrderKept ? "kept" : "changed"} |`,
    );
    console.log(["", header, "| --- |".repeat(1) + " --- |".repeat(11), ...rows].join("\n"));
    expect(losses.every((l) => !l.byteEqualTree)).toBe(true);
    expect(losses.every((l) => !l.byteEqualEvents)).toBe(true);
    // Attribute order is the one lexical fact the upstream codec does keep.
    expect(losses.every((l) => l.attributeOrderKept)).toBe(true);
  });
});

describe("character data the lexical losses do not touch", () => {
  const textOf = (element: Xml.Element, name: string): Array<string> => {
    const out: Array<string> = [];
    const walk = (node: Xml.Element): void => {
      if (node.name === name) {
        out.push(
          node.children.filter((child): child is string => typeof child === "string").join(""),
        );
      }
      for (const child of node.children) if (typeof child !== "string") walk(child);
    };
    walk(element);
    return out;
  };

  test("a significant &#9; in qti-value survives both decodes as a tab character", async () => {
    const input = readFileSync(new URL("conformance-read-by-a-rule.xml", corpus), "utf-8");
    const trip = await Effect.runPromise(roundTrip(input));
    const before = textOf(trip.first, "qti-value");
    expect(before.some((text) => text.includes("\t"))).toBe(true);
    expect(textOf(trip.second, "qti-value")).toEqual(before);
    expect(trip.encoded.includes("&#9;")).toBe(false);
  });

  test("CDATA, entity references and literal characters decode to the same text", async () => {
    const input = readFileSync(new URL("./cdata.xml", import.meta.url), "utf-8");
    const trip = await Effect.runPromise(roundTrip(input));
    const [raw, refs] = textOf(trip.first, "p");
    expect(raw).toBe("Raw: a < b && c > d and escaped: a < b && c > d");
    expect(refs).toBe("Apostrophe 'quoted' and \"double\" and e\u0301 and \u00e9 and \u00e9");
    expect(textOf(trip.second, "p")).toEqual(textOf(trip.first, "p"));
    expect(trip.encoded.includes("<![CDATA[")).toBe(false);
  });
});

describe("comparator semantics", () => {
  const el = (
    name: string,
    attributes: Record<string, string>,
    children: ReadonlyArray<Xml.Element | string>,
  ): Xml.Element => ({ name, attributes, children });

  test("attribute order is not significant", () => {
    expect(canonicalize(el("a", { y: "2", x: "1" }, []))).toBe(
      canonicalize(el("a", { x: "1", y: "2" }, [])),
    );
  });

  test("whitespace-only children are dropped outside the inline set", () => {
    expect(canonicalize(el("qti-item-body", {}, ["\n  ", el("p", {}, ["x"]), "\n"]))).toBe(
      canonicalize(el("qti-item-body", {}, [el("p", {}, ["x"])])),
    );
  });

  test("whitespace-only children are kept (normalized) inside the inline set", () => {
    const spaced = el("p", {}, ["a", el("b", {}, ["b"]), " ", el("i", {}, ["c"])]);
    const tight = el("p", {}, ["a", el("b", {}, ["b"]), el("i", {}, ["c"])]);
    expect(defaultInline.has("p")).toBe(true);
    expect(canonicalize(spaced)).not.toBe(canonicalize(tight));
    expect(canonicalize(el("p", {}, ["a", el("b", {}, ["b"]), "\n\t ", el("i", {}, ["c"])]))).toBe(
      canonicalize(spaced),
    );
  });

  test("text whitespace runs are normalized, markup characters are escaped", () => {
    expect(canonicalize(el("p", {}, ["a  <\n b"]))).toBe("<p>a &lt; b</p>");
    expect(canonicalize(el("a", { q: 'x"y' }, []))).toBe('<a q="x&quot;y"></a>');
  });

  test("different attribute values or element names are not equal", () => {
    expect(canonicalize(el("a", { x: "1" }, []))).not.toBe(canonicalize(el("a", { x: "2" }, [])));
    expect(canonicalize(el("a", {}, []))).not.toBe(canonicalize(el("b", {}, [])));
  });
});
