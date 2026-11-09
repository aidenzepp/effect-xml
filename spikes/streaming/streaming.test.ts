import { afterAll, beforeAll, expect, test } from "bun:test";
import * as ChannelSchema from "effect/ChannelSchema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Xml } from "effect/encoding";
import { collectItemRefs, type ItemRef, itemRef, testHeader } from "./mapper.ts";
import { format, type Measurement, measure, retained } from "./measure.ts";
import { events, itemRefPath, rootPath } from "./source.ts";
import { ensureSynthetic, itemRefsPerRepetition, syntheticPath, targetBytes } from "./synthetic.ts";

// SPIKE-04: full tree (A) versus per-record streaming with `Xml.elements` (C)
// on a synthetic ~50 MB `qti-assessment-test`, plus the limits question.
// Everything below is throwaway; see RESULT.md for the scores.

const fixture = new URL("../fixtures/qti/test-features.xml", import.meta.url);
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const measurements: Array<Measurement<unknown>> = [];
const findings: Record<string, unknown> = {};
let synthetic: { path: string; bytes: number; repetitions: number | undefined };

beforeAll(async () => {
  synthetic = await run(ensureSynthetic());
  findings.synthetic = synthetic;
});

afterAll(() => {
  for (const m of measurements) console.log(format(m));
  console.log(JSON.stringify(findings, null, 2));
});

test("A: the whole document as one Element fails the default maxElementSize", async () => {
  const error = await run(
    events(syntheticPath).pipe(
      Stream.pipeThroughChannel(Xml.elements(rootPath)),
      Stream.runCollect,
      Effect.flip,
    ),
  );
  expect(error).toBeInstanceOf(Xml.XmlError);
  expect(error).toMatchObject({ kind: "Limit" });
  findings.aDefaultLimit = String(error);
}, 120_000);

test("A: full tree with maxElementSize raised, peak heap and wall time", async () => {
  const m = await run(
    measure("A tree (maxElementSize: Infinity)", (sampler) =>
      events(syntheticPath).pipe(
        Stream.pipeThroughChannel(
          Xml.elements(rootPath, { maxElementSize: Number.POSITIVE_INFINITY }),
        ),
        Stream.tap(() => Effect.sync(sampler.note)),
        Stream.runCollect,
        Effect.map((roots) => {
          const root = roots[0]!;
          const refs = collectItemRefs(root);
          sampler.note();
          return { header: testHeader(root), count: refs.length, last: refs.at(-1) };
        }),
      ),
    ),
  );
  measurements.push(m);
  expect(m.value.header.identifier).toBe("tide-pool-review");
  expect(m.value.count % itemRefsPerRepetition).toBe(0);
  expect(m.value.count).toBeGreaterThan(100_000);
  findings.aCount = m.value.count;
  findings.aLast = m.value.last;
}, 120_000);

test("C: per-record stream over qti-assessment-item-ref, peak heap and wall time", async () => {
  const m = await run(
    measure("C per-record (Xml.elements item-ref path)", (sampler) =>
      events(syntheticPath).pipe(
        Stream.pipeThroughChannel(Xml.elements(itemRefPath)),
        Stream.map(itemRef),
        Stream.tap(() => Effect.sync(sampler.note)),
        Stream.runFold(
          () => ({ count: 0, last: undefined as ItemRef | undefined }),
          (acc, ref) => ({ count: acc.count + 1, last: ref }),
        ),
      ),
    ),
  );
  measurements.push(m);
  expect(m.value.count).toBe(findings.aCount as number);
  expect(m.value.last).toEqual(findings.aLast as ItemRef);
  findings.cCount = m.value.count;
}, 120_000);

// The upstream seam the branch names for "decode each record through Schema":
// `ChannelSchema.decode` runs a Schema over each chunk of collected Elements.
const ElementShape = Schema.Struct({
  name: Schema.String,
  attributes: Schema.Record(Schema.String, Schema.String),
  children: Schema.Array(Schema.Unknown),
});

test("C': per-record through ChannelSchema.decode, same mapper", async () => {
  const m = await run(
    measure("C' per-record + ChannelSchema.decode", (sampler) =>
      events(syntheticPath).pipe(
        Stream.pipeThroughChannel(Xml.elements(itemRefPath)),
        Stream.pipeThroughChannel(ChannelSchema.decode(ElementShape)()),
        Stream.map((shape) => itemRef(shape as Xml.Element)),
        Stream.tap(() => Effect.sync(sampler.note)),
        Stream.runCount,
      ),
    ),
  );
  measurements.push(m);
  expect(m.value).toBe(findings.cCount as number);
}, 120_000);

test("ancestor scope: a record from Xml.elements carries no xmlns or xml:lang", async () => {
  const text = await Bun.file(fixture).text();
  const records = await run(
    Stream.make(text).pipe(
      Stream.pipeThroughChannel(Xml.decodeString()),
      Stream.pipeThroughChannel(Xml.elements(itemRefPath)),
      Stream.runCollect,
    ),
  );
  expect(records.length).toBe(itemRefsPerRepetition);
  const keys = records.flatMap((record) => Object.keys(record.attributes));
  const inherited = keys.filter(
    (key) => key === "xmlns" || key.startsWith("xmlns:") || key.startsWith("xml:"),
  );
  expect(inherited).toEqual([]);
  expect(Object.keys(records[0]!)).toEqual(["name", "attributes", "children"]);
  findings.recordAttributeKeys = [...new Set(keys)];

  // The scope is still recoverable upstream of `elements`: a tap over the event
  // stream can keep an ancestor stack. Chunking means the stack state is only
  // exact per chunk, not per emitted record, so correlating it with each record
  // needs an in-house collector; the root's declarations are constant and cheap.
  const scope: Array<Record<string, string>> = [];
  let rootScope: Record<string, string> | undefined;
  await run(
    Stream.make(text).pipe(
      Stream.pipeThroughChannel(Xml.decodeString()),
      Stream.tap((event) =>
        Effect.sync(() => {
          if (event._tag === "StartElement") {
            const own: Record<string, string> = {};
            for (const [key, value] of Object.entries(event.attributes)) {
              if (key === "xmlns" || key.startsWith("xmlns:") || key.startsWith("xml:"))
                own[key] = value;
            }
            scope.push(own);
            rootScope ??= own;
          } else if (event._tag === "EndElement") scope.pop();
        }),
      ),
      Stream.pipeThroughChannel(Xml.elements(itemRefPath)),
      Stream.runDrain,
    ),
  );
  expect(rootScope).toMatchObject({
    xmlns: "http://www.imsglobal.org/xsd/imsqtiasi_v3p0",
    "xml:lang": "en-US",
  });
  findings.rootScopeFromTap = rootScope;
});

// Limits: `maxElementSize` counts UTF-16 code units of names, attribute text and
// character data. Two documents with the same counted size but different shapes
// show how far memory diverges from the count.
test("maxElementSize counts characters; retained memory depends on shape", async () => {
  const n = 1_000_000;
  const wide = `<r>${"<a/>".repeat(n)}</r>`; // counted size: 1 + n
  const text = `<r>${"x".repeat(n)}</r>`; // counted size: 1 + n
  const collect = (document: string) =>
    Stream.make(document).pipe(
      Stream.pipeThroughChannel(Xml.decodeString()),
      Stream.pipeThroughChannel(Xml.elements(["r"], { maxElementSize: Number.POSITIVE_INFINITY })),
      Stream.runCollect,
      Effect.map((roots) => roots[0]!),
    );
  const wideTree = retained(() => Effect.runSync(collect(wide)));
  const textTree = retained(() => Effect.runSync(collect(text)));
  expect(wideTree.value.children.length).toBe(n);
  expect(textTree.value.children.length).toBe(1);
  // Both trees are at the same counted size, so the default 16 MiB limit treats
  // them alike; a limit at the counted size would admit both.
  const limited = await run(
    Stream.make(wide).pipe(
      Stream.pipeThroughChannel(Xml.decodeString()),
      Stream.pipeThroughChannel(Xml.elements(["r"], { maxElementSize: n })),
      Stream.runCollect,
      Effect.flip,
    ),
  );
  expect(limited).toMatchObject({ kind: "Limit" });
  const ratio = wideTree.retainedMB / Math.max(textTree.retainedMB, 0.1);
  findings.limits = {
    countedSize: n + 1,
    wideRetainedMB: wideTree.retainedMB,
    textRetainedMB: textTree.retainedMB,
    bytesPerCountedCharWide: Math.round((wideTree.retainedMB * 1024 * 1024) / (n + 1)),
    bytesPerCountedCharText: Math.round((textTree.retainedMB * 1024 * 1024) / (n + 1)),
    ratio: Math.round(ratio),
    limitAtCountedSize: String(limited),
  };
  expect(ratio).toBeGreaterThan(1);
}, 120_000);

test("synthetic document is about 50 MB", () => {
  expect(synthetic.bytes).toBeGreaterThanOrEqual(targetBytes);
  expect(synthetic.bytes).toBeLessThan(targetBytes * 1.1);
});

// Live set, not sampled peak: force a GC every 20k records and read heapUsed.
// Separate from the measured C run so the forced collections do not inflate
// its wall time. If per-record streaming is bounded by the record, these stay
// flat while the document streams past.
test("C: live heap after forced GC stays flat across the document", async () => {
  const live: Array<number> = [];
  let seen = 0;
  Bun.gc(true);
  const baseline = process.memoryUsage().heapUsed;
  await run(
    events(syntheticPath).pipe(
      Stream.pipeThroughChannel(Xml.elements(itemRefPath)),
      Stream.map(itemRef),
      Stream.tap(() =>
        Effect.sync(() => {
          if (++seen % 20_000 === 0) {
            Bun.gc(true);
            live.push(
              Math.round(((process.memoryUsage().heapUsed - baseline) / 1024 / 1024) * 10) / 10,
            );
          }
        }),
      ),
      Stream.runDrain,
    ),
  );
  findings.cLiveHeapDeltaMBAfterGc = live;
  expect(live.length).toBeGreaterThanOrEqual(8);
  expect(Math.max(...live)).toBeLessThan(10);
}, 120_000);
