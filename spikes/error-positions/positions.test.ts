import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { Xml } from "effect/encoding";
import { LocateError, locate, renderPath, type PathSegment } from "./locate-c.js";
import { decodeStringWithPositions, type Positioned } from "./positions-b.js";

const corpus = new URL("../fixtures/qti/", import.meta.url);
const fixtures: ReadonlyArray<{ readonly name: string; readonly text: string }> = [
  ...readdirSync(corpus)
    .filter((file) => file.endsWith(".xml"))
    .sort()
    .map((file) => ({ name: file, text: readFileSync(new URL(file, corpus), "utf-8") })),
  // Local variant: DOCTYPE with internal subset, comment and CDATA containing
  // `<`, a PI, `>` inside an attribute value, start tags spanning lines.
  {
    name: "edge-cases.xml",
    text: readFileSync(new URL("./edge-cases.xml", import.meta.url), "utf-8"),
  },
];

interface Located {
  readonly name: string;
  readonly path: ReadonlyArray<PathSegment>;
  readonly line: number;
  readonly column: number;
}

const runB = (chunks: ReadonlyArray<string>): Promise<ReadonlyArray<Positioned>> =>
  Effect.runPromise(
    Stream.fromIterable(chunks).pipe(
      Stream.rechunk(1),
      Stream.pipeThroughChannel(decodeStringWithPositions()),
      Stream.runCollect,
    ),
  );

const runPlain = (chunks: ReadonlyArray<string>): Promise<ReadonlyArray<Xml.Event>> =>
  Effect.runPromise(
    Stream.fromIterable(chunks).pipe(
      Stream.rechunk(1),
      Stream.pipeThroughChannel(Xml.decodeString()),
      Stream.runCollect,
    ),
  );

// Every start tag with the path C expects: names, each followed by the
// zero-based index among same-named siblings.
const elementsOf = (events: ReadonlyArray<Positioned>): Array<Located> => {
  const out: Array<Located> = [];
  const stack: Array<{
    readonly path: ReadonlyArray<PathSegment>;
    readonly counts: Map<string, number>;
  }> = [{ path: [], counts: new Map() }];
  for (const { event, line, column } of events) {
    if (event._tag === "StartElement") {
      const parent = stack[stack.length - 1] as (typeof stack)[number];
      const index = parent.counts.get(event.name) ?? 0;
      parent.counts.set(event.name, index + 1);
      const path = [...parent.path, event.name, index];
      out.push({ name: event.name, path, line, column });
      stack.push({ path, counts: new Map() });
    } else if (event._tag === "EndElement") {
      stack.pop();
    }
  }
  return out;
};

const splitEvery = (text: string, size: number): Array<string> => {
  const chunks: Array<string> = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
};

test("B and C agree on the position of every start tag in every fixture", async () => {
  const rows: Array<string> = [];
  for (const fixture of fixtures) {
    const elements = elementsOf(await runB([fixture.text]));
    expect(elements.length).toBeGreaterThan(0);
    let agreed = 0;
    for (const element of elements) {
      const located = await Effect.runPromise(locate(fixture.text, element.path));
      expect(`${renderPath(element.path)} ${located.line}:${located.column}`).toBe(
        `${renderPath(element.path)} ${element.line}:${element.column}`,
      );
      agreed++;
    }
    rows.push(`| ${fixture.name} | ${elements.length} | ${agreed} | yes |`);
  }
  console.log(
    ["| fixture | start tags | B = C | agree |", "| --- | ---: | ---: | --- |", ...rows].join("\n"),
  );
});

test("B tags the same positions whether the input arrives whole or in 7-character chunks", async () => {
  for (const fixture of fixtures) {
    const whole = elementsOf(await runB([fixture.text]));
    const chunked = elementsOf(await runB(splitEvery(fixture.text, 7)));
    expect(chunked).toEqual(whole);
  }
});

test("B forwards exactly the events plain decodeString produces", async () => {
  for (const fixture of fixtures) {
    const plain = await runPlain([fixture.text]);
    const tagged: ReadonlyArray<Xml.Event> = (await runB([fixture.text])).map(
      (positioned) => positioned.event,
    );
    expect(tagged).toEqual(plain);
  }
});

// Two start tags per fixture, located by hand (line from the editor, column by
// counting characters on that line; see RESULT.md). `ordinal` is the one-based
// position of the start tag in document order.
const handChecked: ReadonlyArray<{
  readonly fixture: string;
  readonly ordinal: number;
  readonly name: string;
  readonly line: number;
  readonly column: number;
}> = [
  { fixture: "bg007-true-false.xml", ordinal: 1, name: "qti-assessment-item", line: 2, column: 1 },
  { fixture: "bg007-true-false.xml", ordinal: 9, name: "p", line: 22, column: 5 },
  {
    fixture: "bg010-missing-word.xml",
    ordinal: 1,
    name: "qti-assessment-item",
    line: 2,
    column: 1,
  },
  { fixture: "bg010-missing-word.xml", ordinal: 14, name: "br", line: 25, column: 49 },
  { fixture: "bg011-media.xml", ordinal: 1, name: "qti-assessment-item", line: 2, column: 1 },
  {
    fixture: "bg011-media.xml",
    ordinal: 14,
    name: "qti-extended-text-interaction",
    line: 27,
    column: 3,
  },
  { fixture: "bpig-hotspot.xml", ordinal: 1, name: "qti-assessment-item", line: 2, column: 1 },
  { fixture: "bpig-hotspot.xml", ordinal: 14, name: "qti-hotspot-choice", line: 24, column: 7 },
  { fixture: "bpig-mathml.xml", ordinal: 1, name: "qti-assessment-item", line: 2, column: 1 },
  { fixture: "bpig-mathml.xml", ordinal: 14, name: "mi", line: 26, column: 17 },
  { fixture: "choice-feedback.xml", ordinal: 1, name: "qti-assessment-item", line: 2, column: 1 },
  { fixture: "choice-feedback.xml", ordinal: 14, name: "qti-simple-choice", line: 18, column: 7 },
  {
    fixture: "conformance-adaptive-absent.xml",
    ordinal: 1,
    name: "qti-assessment-item",
    line: 2,
    column: 1,
  },
  {
    fixture: "conformance-adaptive-absent.xml",
    ordinal: 9,
    name: "qti-variable",
    line: 12,
    column: 9,
  },
  {
    fixture: "conformance-read-by-a-rule.xml",
    ordinal: 1,
    name: "qti-assessment-item",
    line: 2,
    column: 1,
  },
  {
    fixture: "conformance-read-by-a-rule.xml",
    ordinal: 5,
    name: "qti-outcome-declaration",
    line: 6,
    column: 3,
  },
  {
    fixture: "extended-text-postcard.xml",
    ordinal: 1,
    name: "qti-assessment-item",
    line: 2,
    column: 1,
  },
  { fixture: "extended-text-postcard.xml", ordinal: 14, name: "br", line: 13, column: 111 },
  { fixture: "hottext.xml", ordinal: 1, name: "qti-assessment-item", line: 2, column: 1 },
  { fixture: "hottext.xml", ordinal: 14, name: "qti-response-processing", line: 19, column: 3 },
  { fixture: "imsmanifest.xml", ordinal: 1, name: "manifest", line: 2, column: 1 },
  { fixture: "imsmanifest.xml", ordinal: 14, name: "resource", line: 21, column: 5 },
  { fixture: "pci-shaded-grid.xml", ordinal: 1, name: "qti-assessment-item", line: 17, column: 1 },
  { fixture: "pci-shaded-grid.xml", ordinal: 14, name: "p", line: 49, column: 7 },
  { fixture: "test-features.xml", ordinal: 1, name: "qti-assessment-test", line: 2, column: 1 },
  { fixture: "test-features.xml", ordinal: 14, name: "qti-test-part", line: 18, column: 3 },
  { fixture: "text-and-media.xml", ordinal: 1, name: "qti-assessment-item", line: 2, column: 1 },
  { fixture: "text-and-media.xml", ordinal: 14, name: "figure", line: 22, column: 5 },
  { fixture: "text-entry-cloze.xml", ordinal: 1, name: "qti-assessment-item", line: 2, column: 1 },
  { fixture: "text-entry-cloze.xml", ordinal: 14, name: "qti-default-value", line: 21, column: 5 },
  { fixture: "edge-cases.xml", ordinal: 1, name: "root", line: 7, column: 1 },
  { fixture: "edge-cases.xml", ordinal: 6, name: "b", line: 12, column: 5 },
  { fixture: "edge-cases.xml", ordinal: 9, name: "e", line: 15, column: 16 },
];

test("B matches hand-checked positions for two start tags per fixture", async () => {
  for (const fixture of fixtures) {
    expect(
      handChecked.filter((entry) => entry.fixture === fixture.name).length,
    ).toBeGreaterThanOrEqual(2);
  }
  for (const entry of handChecked) {
    const fixture = fixtures.find((candidate) => candidate.name === entry.fixture);
    expect(fixture).toBeDefined();
    const elements = elementsOf(await runB([(fixture as (typeof fixtures)[number]).text]));
    const element = elements[entry.ordinal - 1];
    expect(
      `${entry.fixture} #${entry.ordinal} ${element?.name} ${element?.line}:${element?.column}`,
    ).toBe(`${entry.fixture} #${entry.ordinal} ${entry.name} ${entry.line}:${entry.column}`);
  }
});

test("C fails in the error channel for a path with no element", async () => {
  const text = (
    fixtures.find(
      (fixture) => fixture.name === "bg010-missing-word.xml",
    ) as (typeof fixtures)[number]
  ).text;
  const error = await Effect.runPromise(
    Effect.flip(locate(text, ["qti-assessment-item", "qti-item-body", "p", 2])),
  );
  expect(error).toBeInstanceOf(LocateError);
  expect(error.message).toBe("no element at /qti-assessment-item/qti-item-body/p[2]");
});

test("C locates the inline interaction in bg010 by the branch's path shape", async () => {
  const text = (
    fixtures.find(
      (fixture) => fixture.name === "bg010-missing-word.xml",
    ) as (typeof fixtures)[number]
  ).text;
  const position = await Effect.runPromise(
    locate(text, [
      "qti-assessment-item",
      "qti-item-body",
      "div",
      "blockquote",
      "p",
      "qti-text-entry-interaction",
    ]),
  );
  expect(position).toEqual({ line: 26, column: 50 });
});

test("throughput of B relative to plain decodeString on the largest fixture", async () => {
  const largest = fixtures.reduce((best, fixture) =>
    fixture.text.length > best.text.length ? fixture : best,
  );
  const iterations = 300;
  const time = async (run: () => Promise<unknown>): Promise<number> => {
    for (let i = 0; i < 20; i++) await run();
    const start = performance.now();
    for (let i = 0; i < iterations; i++) await run();
    return (performance.now() - start) / iterations;
  };
  const chunked = splitEvery(largest.text, 4096);
  const plainWhole = await time(() => runPlain([largest.text]));
  const bWhole = await time(() => runB([largest.text]));
  const plainChunked = await time(() => runPlain(chunked));
  const bChunked = await time(() => runB(chunked));
  // Synthetic scale-up so per-run stream setup does not dominate: the largest
  // fixture's root content repeated 100 times inside one root (about 480 KB).
  const inner = largest.text.slice(
    largest.text.indexOf(">", largest.text.indexOf("<qti-assessment-test")) + 1,
  );
  const body = inner.slice(0, inner.lastIndexOf("</qti-assessment-test>"));
  const big = `<root>${body.repeat(100)}</root>`;
  const bigChunks = splitEvery(big, 4096);
  const plainBig = await time(() => runPlain(bigChunks));
  const bBig = await time(() => runB(bigChunks));
  console.log(
    [
      `largest fixture: ${largest.name} (${largest.text.length} chars), ${iterations} iterations after 20 warm-up runs`,
      `| input | plain decodeString | B | B / plain |`,
      `| --- | ---: | ---: | ---: |`,
      `| ${largest.name}, one chunk | ${plainWhole.toFixed(3)} ms | ${bWhole.toFixed(3)} ms | ${(bWhole / plainWhole).toFixed(2)}x |`,
      `| ${largest.name}, 4096-char chunks | ${plainChunked.toFixed(3)} ms | ${bChunked.toFixed(3)} ms | ${(bChunked / plainChunked).toFixed(2)}x |`,
      `| synthetic ${(big.length / 1024).toFixed(0)} KB, 4096-char chunks | ${plainBig.toFixed(3)} ms | ${bBig.toFixed(3)} ms | ${(bBig / plainBig).toFixed(2)}x |`,
    ].join("\n"),
  );
  expect(bWhole / plainWhole).toBeLessThan(20);
});
