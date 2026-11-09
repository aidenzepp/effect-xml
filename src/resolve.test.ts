import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Stream from "effect/Stream";
import { Xml } from "effect/encoding";
import { readFileSync } from "node:fs";
import { withPosition } from "./issue.ts";
import { decodeStringWithPositions } from "./positions.ts";
import type { XmlDecodeError } from "./issue.ts";
import {
  collect,
  defaultMaxElementNodes,
  forgetRecordPositions,
  recordPositions,
  resolveEvents,
  toEvents,
} from "./resolve.ts";
import type { ResolvedElement } from "./element.ts";
import type { ResolvedEvent } from "./resolve.ts";

/**
 * Decodes a literal document and resolves its names.
 *
 * @param xml - The XML text to decode.
 * @returns An effect yielding the resolved events.
 */
const resolve = (xml: string) =>
  Stream.make(xml).pipe(
    Stream.pipeThroughChannel(Xml.decodeString()),
    Stream.pipeThroughChannel(resolveEvents()),
    Stream.runCollect,
  );

describe("resolveEvents", () => {
  it.effect("resolves element and attribute names and consumes xmlns declarations", () =>
    Effect.gen(function* resolvesNames() {
      const events = yield* resolve('<a xmlns="u" xmlns:p="v" x="1" p:y="2"><p:b/></a>');

      expect(events).toEqual([
        {
          _tag: "StartElement",
          attributes: { x: "1", "{v}y": "2" },
          name: "{u}a",
          scope: { "": "u", p: "v" },
          size: 21,
        },
        {
          _tag: "StartElement",
          attributes: {},
          name: "{v}b",
          scope: { "": "u", p: "v" },
          size: 3,
        },
        { _tag: "EndElement", name: "{v}b" },
        { _tag: "EndElement", name: "{u}a" },
      ]);
    }),
  );

  it.effect("resolves the xml prefix to the XML namespace", () =>
    Effect.gen(function* resolvesXmlPrefix() {
      const events = yield* resolve('<a xml:lang="en"/>');

      expect(events[0]).toMatchObject({
        attributes: { "{http://www.w3.org/XML/1998/namespace}lang": "en" },
      });
    }),
  );

  it.effect("drops declaration, comment, and processing instruction events", () =>
    Effect.gen(function* dropsNonElements() {
      const events = yield* resolve('<?xml version="1.0"?><!--c--><a/>');

      expect(events.map((event) => event._tag)).toEqual(["StartElement", "EndElement"]);
    }),
  );

  it.effect("passes text events through unchanged", () =>
    Effect.gen(function* passesText() {
      const events = yield* resolve("<a>hi</a>");

      expect(events[1]).toEqual({ _tag: "Text", text: "hi" });
    }),
  );

  it.effect("fails an element with an undeclared prefix, naming the as-written path", () =>
    Effect.gen(function* failsElement() {
      const error = yield* resolve("<root><foo:bar/></root>").pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "XmlDecodeError",
        path: "/root/foo:bar",
        reason: { _tag: "UndeclaredPrefix", prefix: "foo", where: "element <foo:bar>" },
      });
      expect(error.message).toBe(
        "element <foo:bar> at /root/foo:bar: prefix foo is not declared; declare xmlns:foo on this element or an ancestor",
      );
    }),
  );

  it.effect("fails an attribute with an undeclared prefix at its element's path", () =>
    Effect.gen(function* failsAttribute() {
      const error = yield* resolve('<root><a foo:x="1"/></root>').pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "XmlDecodeError",
        path: "/root/a",
        reason: { _tag: "UndeclaredPrefix", prefix: "foo", where: "attribute foo:x of <a>" },
      });
      expect(error.message).toBe(
        "attribute foo:x of <a> at /root/a: prefix foo is not declared; declare xmlns:foo on this element or an ancestor",
      );
    }),
  );

  it.effect("locates an undeclared element prefix with the element path from the root", () =>
    Effect.gen(function* locatesElement() {
      const error = yield* resolve("<root><a/><b><foo:bar/></b></root>").pipe(Effect.flip);

      expect(error).toMatchObject({
        path: "/root/b/foo:bar",
        reason: {
          _tag: "UndeclaredPrefix",
          elementPath: [
            { index: 0, local: "root" },
            { index: 1, local: "b" },
            { index: 0, local: "bar" },
          ],
        },
      });
    }),
  );

  it.effect("locates an undeclared attribute prefix at its element's path", () =>
    Effect.gen(function* locatesAttribute() {
      const error = yield* resolve('<root><x foo:k="1"/></root>').pipe(Effect.flip);

      expect(error).toMatchObject({
        path: "/root/x",
        reason: {
          _tag: "UndeclaredPrefix",
          elementPath: [
            { index: 0, local: "root" },
            { index: 0, local: "x" },
          ],
        },
      });
    }),
  );

  it.effect("fails rather than succeeding after earlier elements resolved", () =>
    Effect.gen(function* failsAfterOk() {
      const exit = yield* Effect.exit(resolve("<root><ok/><foo:bar/></root>"));

      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("emits events before the failing element", () =>
    Effect.gen(function* emitsBefore() {
      const seen: string[] = [];

      yield* Stream.make("<root><ok/><foo:bar/></root>").pipe(
        Stream.pipeThroughChannel(Xml.decodeString()),
        Stream.pipeThroughChannel(resolveEvents()),
        Stream.runForEach((event) => Effect.sync(() => seen.push(event._tag))),
        Effect.ignore,
      );

      expect(seen).toEqual(["StartElement", "StartElement", "EndElement"]);
    }),
  );

  it.effect("accepts a prefix declared on an ancestor", () =>
    Effect.gen(function* acceptsAncestor() {
      const events = yield* resolve('<root xmlns:foo="u"><foo:bar/></root>');

      expect(events[1]).toMatchObject({ name: "{u}bar" });
    }),
  );

  it.effect("does not read Object.prototype for an unbound prefix", () =>
    Effect.gen(function* failsInherited() {
      const error = yield* resolve("<constructor:x/>").pipe(Effect.flip);

      expect(error).toMatchObject({
        reason: {
          _tag: "UndeclaredPrefix",
          prefix: "constructor",
          where: "element <constructor:x>",
        },
      });
    }),
  );

  it.effect("binds a prefix named __proto__ as an ordinary prefix", () =>
    Effect.gen(function* bindsProto() {
      const events = yield* resolve('<r xmlns:__proto__="u"><__proto__:a/></r>');

      expect(events[1]).toMatchObject({ name: "{u}a" });
      expect(Object.keys(events[0]?._tag === "StartElement" ? events[0].scope : {})).toEqual([
        "__proto__",
      ]);
    }),
  );

  it.effect("fails two attributes that expand to the same name", () =>
    Effect.gen(function* failsDuplicate() {
      const error = yield* resolve('<r xmlns:a="u" xmlns:b="u" a:x="1" b:x="2"/>').pipe(
        Effect.flip,
      );

      expect(error).toMatchObject({
        _tag: "XmlDecodeError",
        path: "/r",
        reason: { _tag: "WellFormedness", cause: { kind: "Syntax" } },
      });
      expect(error.message).toBe(
        "attribute b:x of <r> at /r: expands to {u}x, which attribute a:x already uses; remove one attribute or bind the prefixes to different namespaces",
      );
    }),
  );

  it.effect("fails binding the xmlns prefix", () =>
    Effect.gen(function* failsXmlnsPrefix() {
      const error = yield* resolve('<r xmlns:xmlns="u"/>').pipe(Effect.flip);

      expect(error).toMatchObject({ path: "/r", reason: { _tag: "WellFormedness" } });
      expect(error.message).toBe(
        "declaration xmlns:xmlns of <r> at /r: the xmlns prefix is reserved and cannot be declared; remove the declaration",
      );
    }),
  );

  it.effect("fails binding the xml prefix to another namespace", () =>
    Effect.gen(function* failsXmlRebind() {
      const error = yield* resolve('<r xmlns:xml="u"/>').pipe(Effect.flip);

      expect(error.message).toBe(
        "declaration xmlns:xml of <r> at /r: the xml prefix can only be bound to http://www.w3.org/XML/1998/namespace; remove the declaration or use that namespace",
      );
    }),
  );

  it.effect("accepts binding the xml prefix to its own namespace", () =>
    Effect.gen(function* acceptsXmlSelf() {
      const events = yield* resolve(
        '<r xmlns:xml="http://www.w3.org/XML/1998/namespace" xml:lang="en"/>',
      );

      expect(events[0]).toMatchObject({
        attributes: { "{http://www.w3.org/XML/1998/namespace}lang": "en" },
      });
    }),
  );

  it.effect("fails binding another prefix to a reserved namespace", () =>
    Effect.gen(function* failsReservedUri() {
      const xmlUri = yield* resolve('<r xmlns:p="http://www.w3.org/XML/1998/namespace"/>').pipe(
        Effect.flip,
      );

      const xmlnsUri = yield* resolve('<r xmlns="http://www.w3.org/2000/xmlns/"/>').pipe(
        Effect.flip,
      );

      expect(xmlUri.message).toBe(
        "declaration xmlns:p of <r> at /r: http://www.w3.org/XML/1998/namespace is reserved for the xml prefix; bind xmlns:p to a different namespace",
      );
      expect(xmlnsUri.message).toBe(
        "declaration xmlns of <r> at /r: http://www.w3.org/2000/xmlns/ is reserved for the xmlns prefix; bind xmlns to a different namespace",
      );
    }),
  );

  it.effect('puts an unprefixed element in no namespace under xmlns=""', () =>
    Effect.gen(function* undeclaresDefault() {
      const events = yield* resolve('<a xmlns="u"><b xmlns=""><c/></b></a>');
      const names = events.flatMap((event) => (event._tag === "StartElement" ? [event.name] : []));

      expect(names).toEqual(["{u}a", "b", "c"]);
    }),
  );

  it.effect('puts a root in no namespace under xmlns=""', () =>
    Effect.gen(function* emptyRootDefault() {
      const events = yield* resolve('<a xmlns=""/>');

      expect(events[0]).toMatchObject({ name: "a" });
    }),
  );

  it.effect("fails binding a prefix to the empty namespace", () =>
    Effect.gen(function* failsEmptyPrefixed() {
      const error = yield* resolve('<r xmlns:p=""/>').pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "XmlDecodeError",
        path: "/r",
        reason: { _tag: "WellFormedness", cause: { kind: "Syntax" } },
      });
      expect(error.message).toBe(
        "declaration xmlns:p of <r> at /r: a prefix cannot be bound to the empty namespace; bind xmlns:p to a namespace URI or remove the declaration",
      );
    }),
  );
});

const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

const XSI = "http://www.w3.org/2001/XMLSchema-instance";

const MATHML = "http://www.w3.org/1998/Math/MathML";

const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";

/**
 * Reads a QTI fixture document by path.
 *
 * @param relative - The fixture path relative to this file.
 * @returns The fixture text.
 */
const fixture = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf-8");

/**
 * Drops the prefix scope and the as-written size from start events so prefix spelling is not
 * compared.
 *
 * @param events - The resolved events.
 * @returns The events with `scope` and `size` removed from each start.
 */
const withoutScope = (events: readonly ResolvedEvent[]) =>
  events.map((event) => {
    if (event._tag !== "StartElement") {
      return event;
    }

    const { scope: _scope, size: _size, ...rest } = event;

    return rest;
  });

/**
 * Lists the names of start events in document order.
 *
 * @param events - The resolved events.
 * @returns The start element names.
 */
const startNames = (events: readonly ResolvedEvent[]) =>
  events.flatMap((event) => (event._tag === "StartElement" ? [event.name] : []));

describe("resolveEvents on fixture documents", () => {
  const bpig = fixture("../spikes/fixtures/qti/bpig-mathml.xml");

  it.effect("resolves the inner math start and the root attributes in bpig-mathml.xml", () =>
    Effect.gen(function* resolvesBpig() {
      const events = yield* resolve(bpig);
      const root = events.find((event) => event._tag === "StartElement");

      const attributes = root?._tag === "StartElement" ? root.attributes : {};

      expect(Object.keys(attributes)).toContain(`{${XSI}}schemaLocation`);
      expect(startNames(events)).toContain(`{${MATHML}}math`);
      expect(root).toMatchObject({
        attributes: {
          [`{${XML_NAMESPACE}}lang`]: "en",
          identifier: "cube-equation-choice",
        },
        name: `{${QTI}}qti-assessment-item`,
      });
    }),
  );

  it.effect("resolves the manifest default, imsmd, and imsqti vocabularies by URI", () =>
    Effect.gen(function* resolvesManifest() {
      const text = fixture("../spikes/fixtures/qti/imsmanifest.xml");

      const uri = (prefix: string) =>
        new RegExp(`xmlns${prefix}\\s*=\\s*"([^"]+)"`, "u").exec(text)?.[1] ?? "";

      const cp = uri("");
      const lom = uri(":imsmd");
      const metadata = uri(":imsqti");
      const names = startNames(yield* resolve(text));

      expect([cp, lom, metadata].every((value) => value.length > 0)).toBe(true);
      expect(names).toContain(`{${cp}}manifest`);
      expect(names).toContain(`{${lom}}lom`);
      expect(names).toContain(`{${metadata}}qtiMetadata`);
    }),
  );

  it.effect("resolves reprefixed documents to the same events as their originals", () =>
    Effect.gen(function* resolvesReprefixed() {
      const pairs = [
        [
          "../spikes/fixtures/qti/bpig-mathml.xml",
          "../spikes/namespaces/fixtures/bpig-mathml-reprefixed.xml",
        ],
        [
          "../spikes/fixtures/qti/imsmanifest.xml",
          "../spikes/namespaces/fixtures/imsmanifest-reprefixed.xml",
        ],
      ] as const;

      for (const [original, reprefixed] of pairs) {
        const left = yield* resolve(fixture(original));
        const right = yield* resolve(fixture(reprefixed));

        expect(withoutScope(right)).toEqual(withoutScope(left));
      }
    }),
  );

  it.effect("moves math into the QTI namespace once its inner xmlns is deleted", () =>
    Effect.gen(function* resolvesWithoutInnerXmlns() {
      const stripped = bpig.replace('<math xmlns="http://www.w3.org/1998/Math/MathML">', "<math>");
      const names = startNames(yield* resolve(stripped));

      expect(stripped).not.toBe(bpig);
      expect(names).toContain(`{${QTI}}math`);
      expect(names).not.toContain(`{${MATHML}}math`);
    }),
  );

  it.effect("gives an unprefixed attribute under a default namespace a no-namespace key", () =>
    Effect.gen(function* resolvesUnprefixedAttribute() {
      const events = yield* resolve(bpig);
      const root = events.find((event) => event._tag === "StartElement");

      expect(Object.keys(root?._tag === "StartElement" ? root.attributes : {})).toContain(
        "identifier",
      );
    }),
  );
});

describe("collect", () => {
  const document = fixture("../spikes/fixtures/qti/bg007-true-false.xml");

  /**
   * Decodes the true-false fixture, resolves it, and collects the elements at a path.
   *
   * @param path - The root-anchored match path.
   * @returns An effect yielding the collected elements.
   */
  const collected = (path: readonly string[]) =>
    Stream.make(document).pipe(
      Stream.pipeThroughChannel(Xml.decodeString()),
      Stream.pipeThroughChannel(resolveEvents()),
      Stream.pipeThroughChannel(collect(path)),
      Stream.runCollect,
    );

  it.effect("collects the root element with whitespace and nested text intact", () =>
    Effect.gen(function* collectsRoot() {
      const elements = yield* collected(["*"]);

      expect(elements).toHaveLength(1);

      const [root] = elements;

      expect(root?.name).toBe(`{${QTI}}qti-assessment-item`);
      expect(root?.children.some((child) => Predicate.isString(child) && child.trim() === "")).toBe(
        true,
      );

      const choices: string[] = [];

      const visit = (child: ResolvedElement | string): void => {
        if (Predicate.isString(child)) {
          return;
        }

        if (child.name === `{${QTI}}qti-simple-choice`) {
          choices.push(child.children.filter(Predicate.isString).join("").trim());
        }

        for (const grandchild of child.children) {
          visit(grandchild);
        }
      };

      for (const child of root?.children ?? []) {
        visit(child);
      }

      expect(choices.length).toBeGreaterThan(0);
      expect(choices.every((text) => text.length > 0)).toBe(true);
    }),
  );

  it.effect("collects the element at a named path", () =>
    Effect.gen(function* collectsNamedPath() {
      const elements = yield* collected([`{${QTI}}qti-assessment-item`, `{${QTI}}qti-item-body`]);

      expect(elements.map((element) => element.name)).toEqual([`{${QTI}}qti-item-body`]);
    }),
  );

  it.effect("yields nothing and no error when the path matches no element", () =>
    Effect.gen(function* collectsNothing() {
      const elements = yield* collected([`{${QTI}}nope`]);

      expect(elements).toEqual([]);
    }),
  );
});

/**
 * The budgets `collect` accepts as its second argument.
 */
interface Limits {
  readonly maxElementSize?: number;
  readonly maxElementNodes?: number;
}

/**
 * Collects the elements at a path under budgets from text chunks. Parser failures become defects,
 * so the error channel holds only the resolver's and collector's `XmlDecodeError`.
 *
 * @param chunks - The XML text, one stream element per chunk.
 * @param path - The root-anchored match path.
 * @param limits - The budgets passed to `collect`.
 * @returns The stream of collected elements.
 */
const budgeted = (chunks: readonly string[], path: readonly string[], limits: Limits) =>
  Stream.fromIterable(chunks).pipe(
    Stream.rechunk(1),
    Stream.pipeThroughChannel(Xml.decodeString()),
    Stream.orDie,
    Stream.pipeThroughChannel(resolveEvents()),
    Stream.pipeThroughChannel(collect(path, limits)),
  );

/**
 * Decodes a literal document, resolves it, and collects the elements at a path under budgets.
 *
 * @param xml - The XML text to decode.
 * @param path - The root-anchored match path.
 * @param limits - The budgets passed to `collect`.
 * @returns An effect yielding the collected elements.
 */
const limited = (xml: string, path: readonly string[], limits: Limits) =>
  Stream.runCollect(budgeted([xml], path, limits));

/**
 * Reports whether `collect(["{u}r"], { maxElementSize })` fails on a document.
 *
 * @param xml - The XML text to decode.
 * @param maxElementSize - The budget.
 * @returns An effect yielding `true` when the stream fails.
 */
const exceeds = (xml: string, maxElementSize: number) =>
  limited(xml, ["{u}r"], { maxElementSize }).pipe(Effect.exit, Effect.map(Exit.isFailure));

/**
 * Reports whether upstream `Xml.elements(["r"], { maxElementSize })` fails on a document.
 *
 * @param xml - The XML text to decode.
 * @param maxElementSize - The budget.
 * @returns An effect yielding `true` when the stream fails.
 */
const upstreamExceeds = (xml: string, maxElementSize: number) =>
  Stream.make(xml).pipe(
    Stream.pipeThroughChannel(Xml.decodeString()),
    Stream.pipeThroughChannel(Xml.elements(["r"], { maxElementSize })),
    Stream.runCollect,
    Effect.exit,
    Effect.map(Exit.isFailure),
  );

describe("collect budgets", () => {
  it.effect("fails a record over maxElementSize with a Limit naming the record root", () =>
    Effect.gen(function* failsOverSize() {
      const error = yield* Effect.flip(limited("<r>abcdef</r>", ["r"], { maxElementSize: 5 }));

      expect(error.reason).toMatchObject({
        _tag: "Limit",
        element: "r",
        limit: "maxElementSize",
        max: 5,
      });
      expect(error.reason._tag === "Limit" ? error.reason.measured : 0).toBeGreaterThan(5);
      expect(error.record).toBe(1);
      expect(error.path).toBe("/r");
      expect(error.message).toMatch(/^element <r> exceeds maxElementSize at \/r of record 1: /u);
    }),
  );

  it.effect("admits any record size when maxElementSize is Infinity", () =>
    Effect.gen(function* admitsInfinity() {
      const xml = `<r>${"x".repeat(1_000_000)}</r>`;
      const elements = yield* limited(xml, ["r"], { maxElementSize: Infinity });

      expect(elements).toHaveLength(1);
    }),
  );

  it.effect("counts as-written names and xmlns declarations as upstream does", () =>
    Effect.gen(function* countsAsWritten() {
      expect(yield* exceeds('<r xmlns="u"/>', 6)).toBe(true);
      expect(yield* exceeds('<r xmlns="u"/>', 7)).toBe(false);
      expect(yield* exceeds('<p:r xmlns:p="u"/>', 10)).toBe(true);
      expect(yield* exceeds('<p:r xmlns:p="u"/>', 11)).toBe(false);
      expect(yield* upstreamExceeds('<r xmlns="u"/>', 6)).toBe(true);
      expect(yield* upstreamExceeds('<r xmlns="u"/>', 7)).toBe(false);
    }),
  );

  it.effect("emits the records before the one that exceeds and names its ordinal", () =>
    Effect.gen(function* emitsEarlierRecords() {
      const seen: ResolvedElement[] = [];

      const error = yield* budgeted(["<d><r>ab</r><r>abcd</r></d>"], ["d", "r"], {
        maxElementSize: 3,
      }).pipe(
        Stream.tap((element) => Effect.sync(() => seen.push(element))),
        Stream.runDrain,
        Effect.flip,
      );

      expect(seen).toEqual([{ attributes: {}, children: ["ab"], name: "r" }]);
      expect(error.reason).toMatchObject({ _tag: "Limit", measured: 5 });
      expect(error.record).toBe(2);
    }),
  );

  it.effect("keeps one output chunk per input chunk ahead of a Limit failure", () =>
    Effect.gen(function* keepsChunks() {
      const chunks: (readonly ResolvedElement[])[] = [];

      const error = yield* budgeted(["<d><r>ab</r>", "<r>abcd</r></d>"], ["d", "r"], {
        maxElementSize: 3,
      }).pipe(
        Stream.chunks,
        Stream.tap((chunk) => Effect.sync(() => chunks.push(chunk))),
        Stream.runDrain,
        Effect.flip,
      );

      expect(chunks).toEqual([[{ attributes: {}, children: ["ab"], name: "r" }]]);
      expect(error.reason).toMatchObject({ _tag: "Limit" });
      expect(error.record).toBe(2);
    }),
  );

  it.effect("treats a non-positive or NaN maxElementSize as a defect", () =>
    Effect.gen(function* rejectsBadLimits() {
      for (const maxElementSize of [0, Number.NaN]) {
        const exit = yield* Effect.exit(limited("<r/>", ["r"], { maxElementSize }));

        expect(Exit.isFailure(exit)).toBe(true);

        if (Exit.isFailure(exit)) {
          expect(Cause.hasDies(exit.cause)).toBe(true);
          expect(Cause.hasFails(exit.cause)).toBe(false);
        }
      }
    }),
  );
});

/**
 * Collects the `r` record of a document under a node budget and keeps the failure, if any.
 *
 * @param chunks - The XML text, one stream element per chunk.
 * @param maxElementNodes - The budget.
 * @returns An effect yielding the `XmlDecodeError`, or none when the record is admitted.
 */
const nodeFailure = (chunks: readonly string[], maxElementNodes: number) =>
  budgeted(chunks, ["r"], { maxElementNodes }).pipe(Stream.runCollect, Effect.flip, Effect.option);

describe("collect node budget", () => {
  it.effect("fails a record over maxElementNodes with a Limit naming the record root", () =>
    Effect.gen(function* failsOverNodes() {
      const admitted = yield* limited("<r><a/><a/></r>", ["r"], { maxElementNodes: 3 });

      expect(admitted).toHaveLength(1);

      const error = Option.getOrUndefined(yield* nodeFailure(["<r><a/><a/><a/></r>"], 3));

      expect(error?.reason).toMatchObject({
        _tag: "Limit",
        element: "r",
        limit: "maxElementNodes",
        max: 3,
        measured: 4,
      });
      expect(error?.record).toBe(1);
      expect(error?.path).toBe("/r");
    }),
  );

  it.effect("counts each new text child once and merged text not at all", () =>
    Effect.gen(function* countsTextRuns() {
      expect(Option.isSome(yield* nodeFailure(["<r>x<a/>y</r>"], 3))).toBe(true);
      expect(Option.isNone(yield* nodeFailure(["<r>x<a/>y</r>"], 4))).toBe(true);
      expect(Option.isNone(yield* nodeFailure(["<r>xy</r>"], 2))).toBe(true);
      expect(Option.isNone(yield* nodeFailure(["<r>x", "y</r>"], 2))).toBe(true);
    }),
  );

  it.effect("treats a non-positive or NaN maxElementNodes as a defect", () =>
    Effect.gen(function* rejectsBadNodeLimits() {
      for (const maxElementNodes of [0, Number.NaN]) {
        const exit = yield* Effect.exit(limited("<r/>", ["r"], { maxElementNodes }));

        expect(Exit.isFailure(exit)).toBe(true);

        if (Exit.isFailure(exit)) {
          expect(Cause.hasDies(exit.cause)).toBe(true);
          expect(Cause.hasFails(exit.cause)).toBe(false);
        }
      }
    }),
  );

  it("defaults to a positive finite node budget", () => {
    expect(defaultMaxElementNodes).toBeGreaterThan(0);
    expect(Number.isFinite(defaultMaxElementNodes)).toBe(true);
  });
});

describe("toEvents", () => {
  const QTI_URI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";
  const MATHML_URI = "http://www.w3.org/1998/Math/MathML";
  const prefixes = { "": QTI_URI, m: MATHML_URI };

  const tree: ResolvedElement = {
    attributes: {},
    children: ["x", { attributes: {}, children: ["y"], name: `{${MATHML_URI}}math` }],
    name: `{${QTI_URI}}a`,
  };

  it.effect("declares the map on the root and spells names with its prefixes", () =>
    Effect.gen(function* spellsNames() {
      const events = yield* toEvents(tree, { prefixes });

      expect(events).toEqual([
        // oxlint-disable-next-line unicorn/text-encoding-identifier-case -- plan lock 9 fixes the emitted declaration as encoding="UTF-8".
        { _tag: "Declaration", encoding: "UTF-8", version: "1.0" },
        {
          _tag: "StartElement",
          attributes: { xmlns: QTI_URI, "xmlns:m": MATHML_URI },
          name: "a",
        },
        { _tag: "Text", text: "x" },
        { _tag: "StartElement", attributes: {}, name: "m:math" },
        { _tag: "Text", text: "y" },
        { _tag: "EndElement", name: "m:math" },
        { _tag: "EndElement", name: "a" },
      ]);
    }),
  );

  it.effect("omits the declaration when declaration is false", () =>
    Effect.gen(function* omitsDeclaration() {
      const events = yield* toEvents(tree, { declaration: false, prefixes });

      expect(events[0]?._tag).toBe("StartElement");
    }),
  );

  it.effect("spells the XML namespace as xml and skips the default prefix for attributes", () =>
    Effect.gen(function* spellsAttributes() {
      const events = yield* toEvents(
        {
          attributes: { [`{${XML_NAMESPACE}}lang`]: "en", [`{${QTI_URI}}q`]: "1" },
          children: [],
          name: `{${QTI_URI}}a`,
        },
        { declaration: false, prefixes: { "": QTI_URI, p: QTI_URI } },
      );

      expect(events[0]).toMatchObject({
        attributes: { "p:q": "1", "xml:lang": "en" },
      });
    }),
  );
  it.effect("declares a namespace with no map prefix as the default binding on the element", () =>
    Effect.gen(function* declaresDefault() {
      const events = yield* toEvents(
        {
          attributes: {},
          children: [{ attributes: {}, children: [], name: `{${MATHML_URI}}math` }],
          name: `{${QTI_URI}}root`,
        },
        { declaration: false, prefixes: {} },
      );

      expect(events).toEqual([
        { _tag: "StartElement", attributes: { xmlns: QTI_URI }, name: "root" },
        { _tag: "StartElement", attributes: { xmlns: MATHML_URI }, name: "math" },
        { _tag: "EndElement", name: "math" },
        { _tag: "EndElement", name: "root" },
      ]);
    }),
  );

  it.effect("undeclares the default namespace on a no-namespace child", () =>
    Effect.gen(function* undeclares() {
      const events = yield* toEvents(
        {
          attributes: {},
          children: [{ attributes: {}, children: [], name: "br" }],
          name: `{${QTI_URI}}root`,
        },
        { declaration: false, prefixes: { "": QTI_URI } },
      );

      expect(events[1]).toEqual({ _tag: "StartElement", attributes: { xmlns: "" }, name: "br" });
    }),
  );

  it.effect(
    "re-declares the default namespace on each sibling and reuses the root binding after",
    () =>
      Effect.gen(function* redeclares() {
        const math: ResolvedElement = {
          attributes: {},
          children: [],
          name: `{${MATHML_URI}}math`,
        };

        const events = yield* toEvents(
          {
            attributes: {},
            children: [math, math, { attributes: {}, children: [], name: `{${QTI_URI}}p` }],
            name: `{${QTI_URI}}root`,
          },
          { declaration: false, prefixes: {} },
        );

        const starts = events.flatMap((event) => (event._tag === "StartElement" ? [event] : []));

        expect(starts.map((event) => event.attributes)).toEqual([
          { xmlns: QTI_URI },
          { xmlns: MATHML_URI },
          { xmlns: MATHML_URI },
          {},
        ]);
      }),
  );

  it.effect("reuses a map prefix that the root declared instead of re-declaring it", () =>
    Effect.gen(function* reusesMapPrefix() {
      const events = yield* toEvents(
        {
          attributes: {},
          children: [{ attributes: {}, children: [], name: `{${MATHML_URI}}math` }],
          name: `{${QTI_URI}}root`,
        },
        { declaration: false, prefixes: { m: MATHML_URI } },
      );

      expect(events[1]).toEqual({ _tag: "StartElement", attributes: {}, name: "m:math" });
    }),
  );

  it.effect("fails an attribute in a namespace with no prefix, naming the element's path", () =>
    Effect.gen(function* failsUnmappedAttribute() {
      const error = yield* toEvents(
        { attributes: { "{v}y": "1" }, children: [], name: `{${QTI_URI}}a` },
        { prefixes: { "": QTI_URI } },
      ).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "XmlEncodeError",
        path: "/a",
        reason: { _tag: "UnmappedNamespace", namespace: "v", what: "attribute y" },
      });
      expect(error.message).toBe(
        "attribute y at /a: no prefix is bound to namespace v; add a prefix for it to the definition's namespaces map",
      );
    }),
  );

  it.effect("rejects an attribute that spells as an xmlns declaration", () =>
    Effect.gen(function* rejectsXmlnsAttributes() {
      for (const key of ["xmlns", "xmlns:p"]) {
        const error = yield* toEvents(
          { attributes: { [key]: "u" }, children: [], name: "a" },
          { declaration: false, prefixes: {} },
        ).pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "XmlEncodeError",
          path: "/a",
          reason: { _tag: "InvalidEvent" },
        });
        expect(error.message).toContain(key);
      }
    }),
  );

  it.effect("rejects two attributes that spell to the same qualified name", () =>
    Effect.gen(function* rejectsDuplicates() {
      const error = yield* toEvents(
        {
          attributes: { "p:x": "2", "{v}x": "1" },
          children: [],
          name: "a",
        },
        { declaration: false, prefixes: { p: "v" } },
      ).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "XmlEncodeError",
        reason: { _tag: "InvalidEvent" },
      });
      expect(error.message).toContain("p:x");
    }),
  );

  it.effect("rejects an attribute that collides with a generated declaration", () =>
    Effect.gen(function* rejectsDeclarationCollision() {
      const error = yield* toEvents(
        { attributes: { "xmlns:m": "other" }, children: [], name: "a" },
        { declaration: false, prefixes: { m: MATHML_URI } },
      ).pipe(Effect.flip);

      expect(error).toMatchObject({ _tag: "XmlEncodeError", reason: { _tag: "InvalidEvent" } });
      expect(error.message).toContain("xmlns:m");
    }),
  );

  it.effect("produces events that Xml.encodeString accepts and Xml.decodeString re-reads", () =>
    Effect.gen(function* acceptedByWriter() {
      const events = yield* toEvents(
        {
          attributes: { [`{${XML_NAMESPACE}}lang`]: "en" },
          children: [tree, "t"],
          name: `{${QTI_URI}}root`,
        },
        { prefixes },
      );

      const text = yield* Stream.fromIterable(events).pipe(
        Stream.pipeThroughChannel(Xml.encodeString()),
        Stream.mkString,
      );

      const decoded = yield* Stream.make(text).pipe(
        Stream.pipeThroughChannel(Xml.decodeString()),
        Stream.runCollect,
      );

      expect(decoded.length).toBeGreaterThan(0);
    }),
  );

  it.effect("re-reads a no-namespace child under a default-namespaced parent", () =>
    Effect.gen(function* reReadsUndeclared() {
      const events = yield* toEvents(
        {
          attributes: {},
          children: [{ attributes: {}, children: ["t"], name: "c" }],
          name: `{${QTI_URI}}root`,
        },
        { prefixes: { "": QTI_URI } },
      );

      const text = yield* Stream.fromIterable(events).pipe(
        Stream.pipeThroughChannel(Xml.encodeString()),
        Stream.mkString,
      );

      const resolved = yield* resolve(text);

      const names = resolved.flatMap((event) =>
        event._tag === "StartElement" ? [event.name] : [],
      );

      expect(text).toContain('<c xmlns="">');
      expect(names).toEqual([`{${QTI_URI}}root`, "c"]);
    }),
  );
});

/**
 * The namespace-rule violations the resolver reports, each on a `<r>` nested under `<a>` so the
 * element path has two steps, with the `elementPath` the failure must carry.
 */
const namespaceViolations = [
  '<r xmlns:xmlns="u"/>',
  '<r xmlns:p=""/>',
  '<r xmlns:xml="u"/>',
  '<r xmlns:p="http://www.w3.org/XML/1998/namespace"/>',
  '<r xmlns="http://www.w3.org/2000/xmlns/"/>',
  '<r xmlns:a="u" xmlns:b="u" a:x="1" b:x="2"/>',
] as const;

/**
 * Removes the position parenthetical from a positioned message, leaving the unpositioned text.
 *
 * @param error - The positioned decode error.
 * @returns The message without ` (line L, column C)`.
 */
const unpositioned = (error: XmlDecodeError): string =>
  error.message.replace(/ \(line \d+, column \d+\)/u, "");

/**
 * Resolves a literal document that the resolver rejects, treating an upstream parse failure as a
 * defect.
 *
 * @param xml - The XML text to decode.
 * @returns An effect yielding the resolver's decode error.
 */
const resolveFailure = (xml: string) =>
  resolve(xml).pipe(Effect.catchTag("XmlError", Effect.die), Effect.flip);

describe("resolver failures under withPosition", () => {
  const at = { column: 3, line: 2 };

  it.effect("sets elementPath on every namespace-rule failure", () =>
    Effect.gen(function* setsElementPath() {
      for (const violation of namespaceViolations) {
        const error = yield* resolveFailure(`<a>${violation}</a>`);

        expect(error.reason, violation).toMatchObject({
          _tag: "WellFormedness",
          elementPath: [
            { index: 0, local: "a" },
            { index: 0, local: "r" },
          ],
        });
      }
    }),
  );

  it.effect("keeps the namespace-rule message and repair when positioned", () =>
    Effect.gen(function* keepsIllegal() {
      for (const violation of namespaceViolations) {
        const error = yield* resolveFailure(`<a>${violation}</a>`);
        const positioned = withPosition(error, at);

        expect(positioned.message, violation).toContain(" at /a/r (line 2, column 3): ");
        expect(unpositioned(positioned), violation).toBe(error.message);
      }
    }),
  );

  it.effect("keeps the undeclared-prefix message and repair when positioned", () =>
    Effect.gen(function* keepsUndeclared() {
      for (const xml of ["<a><x:b/></a>", '<a><b x:c="1"/></a>']) {
        const error = yield* resolveFailure(xml);
        const positioned = withPosition(error, at);

        expect(error.reason._tag, xml).toBe("UndeclaredPrefix");
        expect(unpositioned(positioned), xml).toBe(error.message);
      }
    }),
  );

  it.effect("keeps the Limit message and repair when positioned", () =>
    Effect.gen(function* keepsLimit() {
      const error = yield* Effect.flip(limited("<r>abcdef</r>", ["r"], { maxElementSize: 5 }));
      const positioned = withPosition(error, at);

      expect(positioned.message).toContain(" of record 1 (line 2, column 3): ");
      expect(unpositioned(positioned)).toBe(error.message);
    }),
  );
});

/**
 * Decodes a literal document with position tags and resolves its names.
 *
 * @param xml - The XML text to decode.
 * @returns An effect yielding the resolved events, each start carrying its tag's position.
 */
const resolvePositioned = (xml: string) =>
  Stream.make(xml).pipe(
    Stream.pipeThroughChannel(decodeStringWithPositions()),
    Stream.pipeThroughChannel(resolveEvents()),
    Stream.runCollect,
  );

/**
 * Keeps the resolved start events of a run.
 *
 * @param events - The resolved events.
 * @returns The `StartElement` events in document order.
 */
const startsOf = (events: readonly ResolvedEvent[]) =>
  events.filter((event) => event._tag === "StartElement");

describe("resolveEvents over positioned events", () => {
  it.effect("stamps an undeclared-prefix failure with its start tag's position", () =>
    Effect.gen(function* stampsFailure() {
      const error = yield* resolvePositioned("<r><foo:bar/></r>").pipe(
        Effect.catchTag("XmlError", Effect.die),
        Effect.flip,
      );

      expect(error.reason._tag).toBe("UndeclaredPrefix");
      expect(error.position).toEqual({ column: 4, line: 1 });
    }),
  );

  it.effect("leaves an undeclared-prefix failure unpositioned on plain events", () =>
    Effect.gen(function* plainFailure() {
      const error = yield* resolveFailure("<r><foo:bar/></r>");

      expect(error.reason._tag).toBe("UndeclaredPrefix");
      expect(Object.hasOwn(error, "position")).toBe(false);
    }),
  );

  it.effect("stamps a namespace-rule failure with its start tag's position", () =>
    Effect.gen(function* stampsWellFormedness() {
      const error = yield* resolvePositioned('<r>\n  <a xmlns:xml="u"/>\n</r>').pipe(
        Effect.catchTag("XmlError", Effect.die),
        Effect.flip,
      );

      expect(error.reason._tag).toBe("WellFormedness");
      expect(error.position).toEqual({ column: 3, line: 2 });
    }),
  );

  it.effect("stamps a duplicate expanded attribute failure with its start tag's position", () =>
    Effect.gen(function* stampsDuplicate() {
      const error = yield* resolvePositioned(
        '<r xmlns:p="u" xmlns:q="u">\n  <a p:x="1" q:x="2"/>\n</r>',
      ).pipe(Effect.catchTag("XmlError", Effect.die), Effect.flip);

      expect(error.reason._tag).toBe("WellFormedness");
      expect(error.position).toEqual({ column: 3, line: 2 });
    }),
  );

  it.effect("leaves a namespace-rule failure unpositioned on plain events", () =>
    Effect.gen(function* plainWellFormedness() {
      const error = yield* resolveFailure('<r>\n  <a xmlns:xml="u"/>\n</r>');

      expect(error.reason._tag).toBe("WellFormedness");
      expect(Object.hasOwn(error, "position")).toBe(false);
    }),
  );

  it.effect("stamps each resolved start with its tag's position", () =>
    Effect.gen(function* stampsStarts() {
      const starts = startsOf(yield* resolvePositioned("<r>\n  <a/>\n</r>"));

      expect(starts.map(({ name, position }) => ({ name, position }))).toEqual([
        { name: "r", position: { column: 1, line: 1 } },
        { name: "a", position: { column: 3, line: 2 } },
      ]);
    }),
  );

  it.effect("adds no position key to starts resolved from plain events", () =>
    Effect.gen(function* plainStarts() {
      const starts = startsOf(yield* resolve("<r>\n  <a/>\n</r>"));

      expect(starts.map(({ name }) => name)).toEqual(["r", "a"]);

      for (const start of starts) {
        expect(Object.hasOwn(start, "position"), start.name).toBe(false);
      }
    }),
  );
});

/**
 * Undeclared prefixes on an element and on an attribute of the second child of `<a>` under the
 * root, so the failing element path has three steps and its start tag begins at column 11.
 */
const deepUndeclared = [
  { local: "bar", where: "element", xml: "<r><a><b/><foo:bar/></a></r>" },
  { local: "c", where: "attribute", xml: '<r><a><b/><c foo:k="1"/></a></r>' },
] as const;

describe("resolveEvents start tag shape", () => {
  it.effect("locates an undeclared prefix at depth 3 with positions off and on", () =>
    Effect.gen(function* locatesDeep() {
      for (const { local, where, xml } of deepUndeclared) {
        const elementPath = [
          { index: 0, local: "r" },
          { index: 0, local: "a" },
          { index: 1, local },
        ];

        const plain = yield* resolveFailure(xml);

        const positioned = yield* resolvePositioned(xml).pipe(
          Effect.catchTag("XmlError", Effect.die),
          Effect.flip,
        );

        expect(plain.reason, where).toEqual(
          expect.objectContaining({ _tag: "UndeclaredPrefix", elementPath }),
        );
        expect(Object.hasOwn(plain, "position"), where).toBe(false);
        expect(positioned.reason, where).toEqual(
          expect.objectContaining({ _tag: "UndeclaredPrefix", elementPath }),
        );
        expect(positioned.position, where).toEqual({ column: 11, line: 1 });
      }
    }),
  );

  it.effect("sizes a start with one attribute, a plain one or a declaration", () =>
    Effect.gen(function* sizesOne() {
      const plain = startsOf(yield* resolve('<a x="12"/>'));
      const declaration = startsOf(yield* resolve('<a xmlns:p="u"/>'));

      expect(plain.map(({ size }) => size)).toEqual([4]);
      expect(declaration.map(({ size }) => size)).toEqual([9]);
    }),
  );

  it.effect("resolves an attribute named __proto__ as an own key", () =>
    Effect.gen(function* ownProto() {
      const [start] = startsOf(yield* resolve('<r __proto__="v" x="1"/>'));

      expect(start?.attributes).toBeDefined();
      expect(Object.keys(start?.attributes ?? {})).toEqual(["__proto__", "x"]);
      expect(Object.hasOwn(start?.attributes ?? {}, "__proto__")).toBe(true);
      expect(Object.getPrototypeOf(start?.attributes)).toBe(Object.prototype);
      expect(start?.size).toBe(13);
    }),
  );

  it.effect("keeps an attribute named __proto__ own after a prefixed attribute", () =>
    Effect.gen(function* ownProtoAfterPrefixed() {
      const xml = '<r xmlns:p="u" p:a="1" __proto__="v"/>';
      const [plain] = startsOf(yield* resolve(xml));
      const [positioned] = startsOf(yield* resolvePositioned(xml).pipe(Effect.orDie));

      for (const start of [plain, positioned]) {
        expect(Object.keys(start?.attributes ?? {})).toEqual(["{u}a", "__proto__"]);
        expect(Object.hasOwn(start?.attributes ?? {}, "__proto__")).toBe(true);
        expect(Object.getPrototypeOf(start?.attributes)).toBe(Object.prototype);
        expect(start?.attributes).toEqual({ ["__proto__"]: "v", "{u}a": "1" });
      }
    }),
  );
});

/**
 * Resolves one start tag given as an upstream event, so its attribute keys need not pass the
 * tokenizer's name rules.
 *
 * @param entries - The start tag's attributes as written, in order.
 * @returns An effect failing with the resolver's error, or yielding the resolved events.
 */
const resolveStart = (entries: readonly (readonly [string, string])[]) =>
  Stream.fromIterable<Xml.Event>([
    { _tag: "StartElement", attributes: Object.fromEntries(entries), name: "r" },
    { _tag: "EndElement", name: "r" },
  ]).pipe(Stream.pipeThroughChannel(resolveEvents()), Stream.runCollect);

/**
 * The duplicate expanded-name message for attribute `key` of `<r>` colliding with `first`.
 *
 * @param key - The later attribute as written.
 * @param first - The earlier attribute as written.
 * @param expanded - The shared Clark name.
 * @returns The caller-facing message.
 */
const duplicateMessage = (key: string, first: string, expanded: string) =>
  `attribute ${key} of <r> at /r: expands to ${expanded}, which attribute ${first} already uses; remove one attribute or bind the prefixes to different namespaces`;

describe("resolveEvents duplicate expanded attributes", () => {
  it.effect("fails two prefixes bound to one namespace after unprefixed attributes", () =>
    Effect.gen(function* failsTwoPrefixes() {
      const error = yield* resolve('<r xmlns:a="u" xmlns:b="u" y="0" x="0" a:x="1" b:x="2"/>').pipe(
        Effect.flip,
      );

      expect(error).toMatchObject({
        message: duplicateMessage("b:x", "a:x", "{u}x"),
        reason: { _tag: "WellFormedness", elementPath: [{ index: 0, local: "r" }] },
      });
    }),
  );

  it.effect("fails an unprefixed key spelled as a Clark name before a prefixed one", () =>
    Effect.gen(function* failsClarkThenPrefixed() {
      const error = yield* resolveStart([
        ["xmlns:a", "u"],
        ["{u}x", "1"],
        ["a:x", "2"],
      ]).pipe(Effect.flip);

      expect(error.reason).toMatchObject({ _tag: "WellFormedness" });
      expect(error.message).toBe(duplicateMessage("a:x", "{u}x", "{u}x"));
    }),
  );

  it.effect("fails an unprefixed key spelled as a Clark name after a prefixed one", () =>
    Effect.gen(function* failsPrefixedThenClark() {
      const error = yield* resolveStart([
        ["xmlns:a", "u"],
        ["a:x", "1"],
        ["{u}x", "2"],
      ]).pipe(Effect.flip);

      expect(error.reason).toMatchObject({ _tag: "WellFormedness" });
      expect(error.message).toBe(duplicateMessage("{u}x", "a:x", "{u}x"));
    }),
  );

  it.effect("accepts an unprefixed and a prefixed attribute with one local name", () =>
    Effect.gen(function* acceptsSameLocal() {
      const [start] = startsOf(yield* resolve('<r xmlns:a="u" x="1" a:x="2" y="3"/>'));

      expect(start?.attributes).toEqual({ x: "1", y: "3", "{u}x": "2" });
    }),
  );
});

/**
 * Decodes a literal document with position tags, resolves it, and collects the elements at a path
 * under budgets. Parser failures become defects, so the error channel holds only `XmlDecodeError`.
 *
 * @param xml - The XML text to decode.
 * @param path - The root-anchored match path.
 * @param limits - The budgets passed to `collect`.
 * @returns An effect yielding the collected elements.
 */
const collectPositioned = (xml: string, path: readonly string[], limits?: Limits) =>
  Stream.make(xml).pipe(
    Stream.pipeThroughChannel(decodeStringWithPositions()),
    Stream.orDie,
    Stream.pipeThroughChannel(resolveEvents()),
    Stream.pipeThroughChannel(collect(path, limits)),
    Stream.runCollect,
  );

describe("collect position trees", () => {
  it.effect("builds a record's element tree from its positioned starts", () =>
    Effect.gen(function* buildsTree() {
      const elements = yield* collectPositioned("<r>\n  <a/>\n  <b><c/></b>\n</r>", ["r"]);

      expect(elements).toHaveLength(1);
      expect(elements.map(recordPositions)).toEqual([
        Option.some({
          children: [
            { children: [], local: "a", position: { column: 3, line: 2 } },
            {
              children: [{ children: [], local: "c", position: { column: 6, line: 3 } }],
              local: "b",
              position: { column: 3, line: 3 },
            },
          ],
          local: "r",
          position: { column: 1, line: 1 },
        }),
      ]);
    }),
  );

  it.effect("drops a record's tree once it is forgotten", () =>
    Effect.gen(function* forgetsTree() {
      const elements = yield* collectPositioned("<r><a/></r>", ["r"]);

      expect(elements.map((element) => Option.isSome(recordPositions(element)))).toEqual([true]);

      for (const element of elements) {
        forgetRecordPositions(element);
      }

      expect(elements.map(recordPositions)).toEqual([Option.none()]);
    }),
  );

  it.effect("has no tree for a record collected from plain events", () =>
    Effect.gen(function* plainTree() {
      const elements = yield* limited("<r>\n  <a/>\n  <b><c/></b>\n</r>", ["r"], {});

      expect(elements).toHaveLength(1);
      expect(elements.map(recordPositions)).toEqual([Option.none()]);
    }),
  );

  it.effect("positions a Limit at the stamped record root", () =>
    Effect.gen(function* positionedLimit() {
      const error = yield* collectPositioned("<r><a/></r>", ["r"], { maxElementNodes: 1 }).pipe(
        Effect.flip,
      );

      expect(error.reason._tag).toBe("Limit");
      expect(error.position).toEqual({ column: 1, line: 1 });
    }),
  );

  it.effect("leaves a Limit from plain events unpositioned", () =>
    Effect.gen(function* plainLimit() {
      const error = yield* limited("<r><a/></r>", ["r"], { maxElementNodes: 1 }).pipe(Effect.flip);

      expect(error.reason._tag).toBe("Limit");
      expect(Object.hasOwn(error, "position")).toBe(false);
    }),
  );
});
