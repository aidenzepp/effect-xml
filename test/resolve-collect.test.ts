import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Predicate from "effect/Predicate";
import * as Stream from "effect/Stream";
import { Xml } from "effect/encoding";
import { readFileSync, readdirSync } from "node:fs";

import type { ResolvedElement } from "../src/element.ts";
import { decodeStringWithPositions } from "../src/positions.ts";
import type { PositionedEvent } from "../src/positions.ts";
import { collect, recordPositions, resolveCollect, resolveEvents } from "../src/resolve.ts";

/**
 * The per-record budgets both pipelines receive.
 */
interface Limits {
  readonly maxElementSize?: number;
  readonly maxElementNodes?: number;
}

/**
 * The event source of a run: upstream's plain events or the positioned events of
 * `decodeStringWithPositions`.
 */
type Source = "plain" | "positioned";

/**
 * What a caller of either pipeline can observe: every record emitted before the stream ended, each
 * record's position tree, and how the stream ended.
 */
interface Observed {
  readonly records: readonly ResolvedElement[];
  readonly trees: readonly unknown[];
  readonly end: Ending;
}

/**
 * The chunk sizes each comparison re-chunks the events to; `undefined` keeps the tokenizer's
 * chunks.
 */
const chunkings = [undefined, 1, 3] as const;

/**
 * Decode a document into the events of one source, re-chunked when a size is given.
 *
 * @param xml - The document text.
 * @param source - The event source.
 * @param chunk - The chunk size, or `undefined` for the tokenizer's chunks.
 * @returns The event stream.
 */
const events = (
  xml: string,
  source: Source,
  chunk: number | undefined,
): Stream.Stream<Xml.Event | PositionedEvent, Xml.XmlError> => {
  const decoded: Stream.Stream<Xml.Event | PositionedEvent, Xml.XmlError> =
    source === "plain"
      ? Stream.make(xml).pipe(Stream.pipeThroughChannel(Xml.decodeString()))
      : Stream.make(xml).pipe(Stream.pipeThroughChannel(decodeStringWithPositions()));

  return chunk === undefined ? decoded : decoded.pipe(Stream.rechunk(chunk));
};

/**
 * One reason a stream failed: an error with its message, a defect's text, or an interruption.
 */
type EndReason =
  | { readonly fail: unknown; readonly message: string }
  | { readonly die: string }
  | "interrupt";

/**
 * How a stream ended: success, or the reasons of its failure cause.
 */
type Ending = "success" | readonly EndReason[];

/**
 * Describe how a stream ended, as a plain value equal for equal endings.
 *
 * @param exit - The exit of the run.
 * @returns The ending.
 */
const describeExit = (exit: Exit.Exit<void, unknown>): Ending =>
  Exit.isSuccess(exit)
    ? "success"
    : exit.cause.reasons.map((reason): EndReason => {
        if (Cause.isFailReason(reason)) {
          const { error } = reason;

          return { fail: error, message: Predicate.isError(error) ? error.message : "" };
        }

        return Cause.isDieReason(reason) ? { die: String(reason.defect) } : "interrupt";
      });

/**
 * Run records through to the end and observe them.
 *
 * @param records - The record stream of one pipeline.
 * @returns An effect yielding what a caller observes.
 */
const observe = (records: Stream.Stream<ResolvedElement, unknown>) =>
  Effect.gen(function* observeRecords() {
    const seen: ResolvedElement[] = [];

    const exit = yield* records.pipe(
      Stream.runForEach((record) =>
        Effect.sync(() => {
          seen.push(record);
        }),
      ),
      Effect.exit,
    );

    return { end: describeExit(exit), records: seen, trees: seen.map(recordPositions) };
  });

/**
 * Observe the fused channel and the resolver piped into the collector on the same events.
 *
 * @param xml - The document text.
 * @param source - The event source.
 * @param chunk - The chunk size, or `undefined` for the tokenizer's chunks.
 * @param path - The root-anchored match path.
 * @param limits - The per-record budgets.
 * @returns An effect yielding both observations, the fused one first.
 */
const both = (
  xml: string,
  source: Source,
  chunk: number | undefined,
  path: readonly string[],
  limits: Limits,
) =>
  Effect.all([
    observe(
      events(xml, source, chunk).pipe(Stream.pipeThroughChannel(resolveCollect(path, limits))),
    ),
    observe(
      events(xml, source, chunk).pipe(
        Stream.pipeThroughChannel(resolveEvents()),
        Stream.pipeThroughChannel(collect(path, limits)),
      ),
    ),
  ]);

/**
 * Assert the fused channel matches the resolver piped into the collector for every source and
 * chunking of a document.
 *
 * @param xml - The document text.
 * @param path - The root-anchored match path.
 * @param limits - The per-record budgets.
 * @returns An effect yielding the separate pipeline's observations, to assert the case is not
 *   vacuous.
 */
const compare = (xml: string, path: readonly string[], limits: Limits = {}) =>
  Effect.gen(function* compareDocument() {
    const observed: Observed[] = [];

    for (const source of ["plain", "positioned"] as const) {
      for (const chunk of chunkings) {
        const [fused, separate] = yield* both(xml, source, chunk, path, limits);

        expect(fused, `${source}, chunk ${String(chunk)}: ${xml.slice(0, 80)}`).toEqual(separate);
        observed.push(separate);
      }
    }

    return observed;
  });

/**
 * Report whether every observation ended in a failure.
 *
 * @param observed - The observations of one document.
 * @returns `true` when no run succeeded.
 */
const allFailed = (observed: readonly Observed[]): boolean =>
  observed.every((run) => run.end !== "success");

/**
 * Documents that resolve: prefixed and default namespaces, `xml:lang`, `xmlns=""`, and
 * `__proto__` and `constructor` attributes.
 */
const resolving = [
  '<a xmlns="u" xmlns:p="v" x="1" p:y="2"><p:b/>text<c>more</c><c/></a>',
  '<r xml:lang="en"><a xmlns=""><b/></a><p:x xmlns:p="w" p:k="1" k="2"/></r>',
  '<r __proto__="1" constructor="2"><c __proto__="x">t<!-- c -->u</c></r>',
  '<r xmlns:p="u" a="1" p:a="2"><i/><i>x</i><i><j/></i></r>',
  "<r>\n  <i>a</i>\n  <i>b<b/>c</i>\n</r>",
];

/**
 * Documents a namespace rule rejects, some after records have completed.
 */
const namespaceFailures = [
  "<root><foo:bar/></root>",
  '<root><a foo:x="1"/></root>',
  "<root><a/><b/><c><foo:bar/></c></root>",
  '<r xmlns:p="u" xmlns:q="u" p:a="1" q:a="2"/>',
  '<r><ok/><ok>t</ok><x xmlns:p="u" xmlns:q="u" p:a="1" q:a="2"/></r>',
  '<r xmlns:xmlns="u"/>',
  '<r xmlns:xml="u"/>',
  '<r xmlns:p=""/>',
  '<r xmlns:p="http://www.w3.org/XML/1998/namespace"/>',
  '<r><i/><i/><i a:b="1"/></r>',
];

/**
 * Documents the tokenizer rejects.
 */
const malformed = ["<a><b></a>", "<a>", "<a></b>", '<a x="1" x="2"/>', "<r><i/><i/><i></r>"];

/**
 * A document of several records with growing text and element counts.
 */
const records = `<r><i>aaaa</i><i>bb<b/>cc</i><i>${"x".repeat(50)}</i><i><j/><j/><j/><j/></i></r>`;

describe("resolveCollect", () => {
  it.effect("collects what the resolver piped into the collector collects", () =>
    Effect.gen(function* resolves() {
      for (const xml of resolving) {
        for (const path of [["*"], ["*", "*"], ["{u}a", "{u}c"], ["r", "i"]]) {
          const observed = yield* compare(xml, path);

          expect(observed.some((run) => run.end === "success")).toBe(true);
        }
      }
    }),
  );

  it.effect("fails a namespace rule as the resolver does, after the same records", () =>
    Effect.gen(function* namespaceRules() {
      for (const xml of namespaceFailures) {
        for (const path of [["*"], ["*", "*"]]) {
          expect(allFailed(yield* compare(xml, path))).toBe(true);
        }
      }
    }),
  );

  it.effect("passes malformed input's tokenizer failure through", () =>
    Effect.gen(function* malformedInput() {
      for (const xml of malformed) {
        expect(allFailed(yield* compare(xml, ["*", "*"]))).toBe(true);
      }
    }),
  );

  it.effect("fails a budget as the collector does, after the same records", () =>
    Effect.gen(function* budgets() {
      for (const limits of [
        { maxElementSize: 30 },
        { maxElementNodes: 4 },
        { maxElementNodes: 1 },
        { maxElementSize: 3 },
      ]) {
        const observed = yield* compare(records, ["*", "*"], limits);

        expect(allFailed(observed)).toBe(true);
      }

      expect(allFailed(yield* compare(records, ["*"], { maxElementNodes: 6 }))).toBe(true);
    }),
  );

  it.effect("keeps the earlier event's failure when a budget and a namespace rule both fail", () =>
    Effect.gen(function* precedence() {
      const long = "x".repeat(50);

      for (const xml of [
        `<r><i>${long}</i><foo:bar/></r>`,
        `<r><foo:bar/><i>${long}</i></r>`,
        `<r><i>${long}<foo:bar/></i></r>`,
        `<r><i><foo:bar/>${long}</i></r>`,
      ]) {
        expect(allFailed(yield* compare(xml, ["*", "*"], { maxElementSize: 20 }))).toBe(true);
      }
    }),
  );

  it.effect("dies on a budget that is not positive, as the collector does", () =>
    Effect.gen(function* badBudget() {
      const observed = yield* compare("<r/>", ["*"], { maxElementNodes: 0 });

      expect(observed[0]?.end).toEqual([
        { die: "Error: collect: maxElementNodes must be positive, got 0" },
      ]);
    }),
  );

  it.effect("matches on the QTI corpus, with and without small budgets", () =>
    Effect.gen(function* corpus() {
      const directory = new URL("../spikes/fixtures/qti/", import.meta.url);
      const files = readdirSync(directory).filter((file) => file.endsWith(".xml"));

      expect(files.length).toBeGreaterThan(10);

      for (const file of files) {
        const xml = readFileSync(new URL(file, directory), "utf-8");

        yield* compare(xml, ["*", "*"]);
        yield* compare(xml, ["*", "*"], { maxElementNodes: 40, maxElementSize: 2000 });
        yield* compare(xml, ["*"], { maxElementNodes: 40, maxElementSize: 2000 });
      }
    }),
  );
});
