import { readFileSync } from "node:fs";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Xml from "effect/encoding/Xml";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as References from "effect/References";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as Stream from "effect/Stream";
import { expectTypeOf } from "vitest";

import { canonicalize, normalizedNames } from "./canonical.ts";
import { decodeString, decodeTree, encodeString } from "./codec.ts";
import { Element, namespaces } from "./dsl.ts";
import { clark } from "./element.ts";
import { elements, many, mixed, optional, text } from "./plan.ts";
import { toEvents } from "./resolve.ts";
import { Tokenizer } from "./tokenizer.ts";
import {
  ItemRef,
  QTI,
  Upper,
  expectFailedSpan,
  fixtureText,
  issueCount,
  spanNames,
} from "../test/support.ts";
import { honestNativeTokenizer, shiftedNativeTokenizer } from "../test/tokenizer/fakes.ts";

const XSI = "http://www.w3.org/2001/XMLSchema-instance";

/**
 * The text of the QTI true/false item that the definition below covers.
 */
const bg007 = readFileSync(
  new URL("../spikes/fixtures/qti/bg007-true-false.xml", import.meta.url),
  "utf-8",
);

const qti = namespaces({ "": QTI, xsi: XSI });

const Value = qti.Element("qti-value", { content: text(Schema.String) });

const declarationAttributes = {
  "base-type": Schema.String,
  cardinality: Schema.String,
  identifier: Schema.String,
};

const ResponseDeclaration = qti.Element("qti-response-declaration", {
  attributes: declarationAttributes,
  content: elements({
    correct: qti.Element("qti-correct-response", { content: elements({ value: Value }) }),
  }),
});

const OutcomeDeclaration = qti.Element("qti-outcome-declaration", {
  attributes: declarationAttributes,
  content: elements({
    default: qti.Element("qti-default-value", { content: elements({ value: Value }) }),
  }),
});

const Paragraph = qti.Element("p", { content: mixed([]) });

const ChoiceInteraction = qti.Element("qti-choice-interaction", {
  attributes: { "max-choices": Schema.Int, "response-identifier": Schema.String },
  content: elements({
    choices: many(
      qti.Element("qti-simple-choice", {
        attributes: { identifier: Schema.String },
        content: mixed([]),
      }),
    ),
    prompt: optional(qti.Element("qti-prompt", { content: mixed([]) })),
  }),
});

const AssessmentItem = qti.Element("qti-assessment-item", {
  attributes: {
    identifier: Schema.String,
    "time-dependent": Schema.Boolean,
    title: Schema.String,
    "xml:lang": Schema.optionalKey(Schema.String),
    "xsi:schemaLocation": Schema.optionalKey(Schema.String),
  },
  content: elements({
    body: qti.Element("qti-item-body", { content: mixed([Paragraph, ChoiceInteraction]) }),
    outcome: OutcomeDeclaration,
    processing: qti.Element("qti-response-processing", {
      attributes: { template: Schema.String },
    }),
    response: ResponseDeclaration,
  }),
});

/**
 * Cut the item ref with identifier `identifier` out of the fixture as a standalone document,
 * declaring the QTI default namespace on its start tag so its root resolves to {@link ItemRef}.
 *
 * @param identifier - The item ref's `identifier` attribute value.
 * @returns The item ref's text from its start tag to the end of its end tag.
 */
const itemRefText = (identifier: string): string => {
  const start = fixtureText.indexOf(`<qti-assessment-item-ref identifier="${identifier}"`);
  const endTag = "</qti-assessment-item-ref>";
  const end = fixtureText.indexOf(endTag, start) + endTag.length;
  const tag = "<qti-assessment-item-ref";

  return `${tag} xmlns="${QTI}"${fixtureText.slice(start + tag.length, end)}`;
};

/**
 * Decode `xml` with the assessment item definition expecting a failure.
 *
 * @param xml - The XML text to decode.
 * @returns The decode error.
 */
const decodeFailure = (xml: string) => decodeString(AssessmentItem)(xml).pipe(Effect.flip);

/**
 * The item ref with identifier `sea-stars` as a document whose root start tag opens after a
 * declaration and a comment, so its position is neither the first line nor the first column.
 */
const budgetText = `<?xml version="1.0"?>\n<!-- budget -->  ${itemRefText("sea-stars")}`;

/**
 * The line and column of the root start tag of {@link budgetText}.
 */
const budgetRootPosition = { column: 18, line: 2 };

describe("decodeString", () => {
  it.effect("decodes a real QTI item into its declared value", () =>
    Effect.gen(function* decodesItem() {
      const item = yield* decodeString(AssessmentItem)(bg007);

      expect(item.identifier).toBe("example-true-false-water");
      expect(item["time-dependent"]).toBe(false);
    }),
  );

  it.effect("fails malformed XML with reason WellFormedness carrying the XmlError", () =>
    Effect.gen(function* failsMalformed() {
      const error = yield* decodeFailure("<a><b></a>");

      expect(error.reason._tag).toBe("WellFormedness");
      expect(error.path).toBe("/");
      expect(error.reason._tag === "WellFormedness" && Xml.isXmlError(error.reason.cause)).toBe(
        true,
      );
    }),
  );

  it.effect("fails an undeclared prefix with reason UndeclaredPrefix", () =>
    Effect.gen(function* failsPrefix() {
      const error = yield* decodeFailure("<a><x:b/></a>");

      expect(error.reason._tag).toBe("UndeclaredPrefix");
    }),
  );

  it.effect("fails a rejected attribute value with reason Schema at its XML path", () =>
    Effect.gen(function* failsAttribute() {
      const error = yield* decodeFailure(bg007.replace('max-choices="1"', 'max-choices="x"'));

      expect(error.reason._tag).toBe("SchemaFailure");
      expect(
        error.reason._tag === "SchemaFailure" && Schema.isSchemaError(error.reason.cause),
      ).toBe(true);
      expect(error.path).toBe(
        "/qti-assessment-item/qti-item-body/qti-choice-interaction/@max-choices",
      );
      expect(error.message).toContain(error.path);
    }),
  );
});

describe("decodeString limits", () => {
  it.effect("fails a root over maxElementNodes with reason Limit on record 1", () =>
    Effect.gen(function* failsNodeBudget() {
      const error = yield* decodeString(ItemRef, { maxElementNodes: 2 })(
        itemRefText("sea-stars"),
      ).pipe(Effect.flip);

      expect(error.reason._tag).toBe("Limit");
      expect(error.reason._tag === "Limit" && error.reason.limit).toBe("maxElementNodes");
      expect(error.reason._tag === "Limit" && error.reason.measured).toBe(3);
      expect(error.record).toBe(1);
      expect(error.path).toBe("/qti-assessment-item-ref");
    }),
  );

  it.effect("positions a root over maxElementNodes at the root's start tag", () =>
    Effect.gen(function* positionsNodeBudget() {
      const error = yield* decodeString(ItemRef, { maxElementNodes: 2 })(budgetText).pipe(
        Effect.flip,
      );

      expect(error.reason._tag).toBe("Limit");
      expect(error.position).toStrictEqual(budgetRootPosition);
    }),
  );

  it.effect("decodes the same root with maxElementNodes Infinity", () =>
    Effect.gen(function* decodesUnbounded() {
      const ref = yield* decodeString(ItemRef, { maxElementNodes: Infinity })(
        itemRefText("sea-stars"),
      );

      expect(ref.weights).toHaveLength(1);
      expect(ref.weights[0]?.value).toBe(1.5);
    }),
  );
});

describe("decodeString positions", () => {
  it.effect("positions a rejected attribute value at its element's start tag", () =>
    Effect.gen(function* positionsAttribute() {
      const error = yield* decodeFailure(bg007.replace('max-choices="1"', 'max-choices="x"'));

      expect(error.reason._tag).toBe("SchemaFailure");
      expect(error.position).toStrictEqual({ column: 5, line: 23 });
      expect(error.message).toMatch(
        / at \/qti-assessment-item\/qti-item-body\/qti-choice-interaction\/@max-choices \(line 23, column 5\): /u,
      );
    }),
  );

  it.effect("positions an undeclared prefix at the element that carries it", () =>
    Effect.gen(function* positionsPrefix() {
      const error = yield* decodeFailure(
        bg007.replace("<qti-item-body>", "<qti-item-body><foo:bar/>"),
      );

      expect(error.reason._tag).toBe("UndeclaredPrefix");
      expect(error.position).toStrictEqual({ column: 18, line: 21 });
    }),
  );

  // A malformed document whose XmlError lacks line and column is not constructible through
  // decodeString on this version (the parser always sets both), so no such case is written.
  it.effect("copies the upstream line and column onto a WellFormedness failure", () =>
    Effect.gen(function* positionsWellFormedness() {
      const error = yield* decodeFailure("<a><b></a>");
      const { reason } = error;

      expect(reason._tag).toBe("WellFormedness");

      if (reason._tag !== "WellFormedness") {
        return;
      }

      const { column, line } = reason.cause;

      expect(error.position).toStrictEqual({ column, line });
      expect(error.message).toMatch(/ \(line \d+, column \d+\): /u);
      expect(error.message).not.toMatch(/ at line \d+, column \d+$/u);
      expect(error.message.split("line ")).toHaveLength(2);
    }),
  );
});

describe("decodeString positioned messages", () => {
  it.effect("keeps the WellFormedness repair when it adds the upstream position", () =>
    Effect.gen(function* keepsWellFormednessRepair() {
      const error = yield* decodeFailure("<a><b></a>");

      expect(error.message).toBe(
        "document at / (line 1, column 7): the text is not well-formed XML (end tag </a> does not match <b>); fix the markup at the reported position",
      );
    }),
  );

  it.effect("renders an undeclared prefix the same way whether or not it is positioned", () =>
    Effect.gen(function* keepsUndeclaredWording() {
      const error = yield* decodeFailure("<a>\n  <x:b/>\n</a>");

      expect(error.position).toStrictEqual({ column: 3, line: 2 });
      expect(error.message).toBe(
        "element <x:b> at /a/x:b (line 2, column 3): prefix x is not declared; declare xmlns:x on this element or an ancestor",
      );
    }),
  );

  it.effect("positions every namespace-rule failure at the declaring element", () =>
    Effect.gen(function* positionsNamespaceRules() {
      const violations = [
        '<r xmlns:xmlns="u"/>',
        '<r xmlns:p=""/>',
        '<r xmlns:xml="u"/>',
        '<r xmlns:p="http://www.w3.org/XML/1998/namespace"/>',
        '<r xmlns="http://www.w3.org/2000/xmlns/"/>',
        '<r xmlns:a="u" xmlns:b="u" a:x="1" b:x="2"/>',
      ];

      for (const violation of violations) {
        const error = yield* decodeFailure(`<a>\n  ${violation}\n</a>`);

        expect(error.reason._tag, violation).toBe("WellFormedness");
        expect(error.position, violation).toStrictEqual({ column: 3, line: 2 });
        expect(error.message, violation).toMatch(/^\S.* at \/a\/r \(line 2, column 3\): .+; .+$/u);
        expect(error.message.match(/ at \/a\/r/gu), violation).toHaveLength(1);
      }
    }),
  );
});

describe("decodeTree", () => {
  it.effect("decodes a QTI item to the tree its raw round-trip re-encoding canonicalizes to", () =>
    Effect.gen(function* decodesTree() {
      const options = { normalize: normalizedNames(AssessmentItem) };
      const tree = yield* decodeTree()(bg007);
      const events = yield* toEvents(tree, { prefixes: { "": QTI, xsi: XSI } });

      const encoded = yield* Stream.fromIterable(events).pipe(
        Stream.pipeThroughChannel(Xml.encodeString()),
        Stream.mkString,
      );

      const reencoded = yield* decodeTree()(encoded);

      expect(tree.name).toBe(clark(Option.some(QTI), "qti-assessment-item"));
      expect(canonicalize(tree, options)).toBe(canonicalize(reencoded, options));
    }),
  );

  it.effect("decodes a document its root codec would reject, since no codec applies", () =>
    Effect.gen(function* ignoresSchema() {
      const tree = yield* decodeTree()(bg007.replace('max-choices="1"', 'max-choices="x"'));

      expect(tree.name).toBe(clark(Option.some(QTI), "qti-assessment-item"));
    }),
  );

  it.effect("fails malformed XML with reason WellFormedness at the upstream position", () =>
    Effect.gen(function* failsMalformedTree() {
      const error = yield* decodeTree()("<a><b></a>").pipe(Effect.flip);

      expect(error.reason._tag).toBe("WellFormedness");
      expect(error.path).toBe("/");
      expect(error.position).toStrictEqual({ column: 7, line: 1 });
    }),
  );

  it.effect("fails a root over maxElementNodes with reason Limit on record 1", () =>
    Effect.gen(function* failsTreeBudget() {
      const error = yield* decodeTree({ maxElementNodes: 2 })(itemRefText("sea-stars")).pipe(
        Effect.flip,
      );

      expect(error.reason._tag).toBe("Limit");
      expect(error.reason._tag === "Limit" && error.reason.limit).toBe("maxElementNodes");
      expect(error.record).toBe(1);
      expect(error.path).toBe("/qti-assessment-item-ref");
    }),
  );

  it.effect("positions a root over maxElementNodes at the root's start tag", () =>
    Effect.gen(function* positionsTreeBudget() {
      const error = yield* decodeTree({ maxElementNodes: 2 })(budgetText).pipe(Effect.flip);

      expect(error.reason._tag).toBe("Limit");
      expect(error.position).toStrictEqual(budgetRootPosition);
    }),
  );
});

describe("encodeString", () => {
  it.effect("round-trips a no-namespace child under a default-namespaced parent", () =>
    Effect.gen(function* roundTripsUndeclared() {
      const Parent = namespaces({ "": QTI }).Element("parent", {
        content: elements({ child: Element("child", { content: text(Schema.String) }) }),
      });

      const value = yield* decodeString(Parent)(
        `<parent xmlns="${QTI}"><child xmlns="">hi</child></parent>`,
      );

      const xml = yield* encodeString(Parent, { declaration: false })(value);

      expect(xml).toContain('<child xmlns="">');
      expect(yield* decodeString(Parent)(xml)).toStrictEqual(value);
    }),
  );

  it.effect("encodes a decoded QTI item to text that decodes back to the same value", () =>
    Effect.gen(function* roundTrips() {
      const item = yield* decodeString(AssessmentItem)(bg007);

      const xml = yield* encodeString(AssessmentItem)(item);

      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);

      const events = yield* Stream.make(xml).pipe(
        Stream.pipeThroughChannel(Xml.decodeString()),
        Stream.runCollect,
      );

      expect(events.length).toBeGreaterThan(0);
      expect(yield* decodeString(AssessmentItem)(xml)).toStrictEqual(item);
    }),
  );

  it.effect("omits the XML declaration with declaration false", () =>
    Effect.gen(function* omitsDeclaration() {
      const item = yield* decodeString(AssessmentItem)(bg007);

      const xml = yield* encodeString(AssessmentItem, { declaration: false })(item);

      expect(xml.startsWith("<?xml")).toBe(false);
      expect(xml.startsWith("<qti-assessment-item")).toBe(true);
    }),
  );

  it.effect("fails a value the codec rejects with reason Schema", () =>
    Effect.gen(function* failsEncode() {
      const item = yield* decodeString(AssessmentItem)(bg007);

      const children = item.body.$children.map((child) =>
        child._tag === "qti-choice-interaction"
          ? { ...child, value: { ...child.value, "max-choices": 1.5 } }
          : child,
      );

      const error = yield* encodeString(AssessmentItem)({
        ...item,
        body: { ...item.body, $children: children },
      }).pipe(Effect.flip);

      expect(error._tag).toBe("XmlEncodeError");
      expect(error.reason._tag).toBe("EncodeSchemaFailure");
    }),
  );
});

describe("spans", () => {
  it.effect("opens one xml.decodeString span per decode, on success", () =>
    Effect.gen(function* spansSuccess() {
      expect(yield* spanNames(decodeString(AssessmentItem)(bg007))).toStrictEqual([
        "xml.decodeString",
      ]);
    }),
  );

  it.effect("opens one xml.decodeString span per decode, on malformed input", () =>
    Effect.gen(function* spansFailure() {
      expect(yield* spanNames(decodeString(AssessmentItem)("<a><b></a>"))).toStrictEqual([
        "xml.decodeString",
      ]);
    }),
  );

  it.effect("opens one xml.decodeString span per decode, on a positioned failure", () =>
    Effect.gen(function* spansPositioned() {
      const xml = bg007.replace('max-choices="1"', 'max-choices="x"');

      expect(yield* spanNames(decodeString(AssessmentItem)(xml))).toStrictEqual([
        "xml.decodeString",
      ]);
    }),
  );

  it.effect("ends the xml.decodeString span in failure on a failing decode", () =>
    expectFailedSpan("xml.decodeString", decodeString(AssessmentItem)("<a><b></a>")),
  );

  it.effect("ends the xml.decodeTree span in failure on a failing tree decode", () =>
    expectFailedSpan("xml.decodeTree", decodeTree()("<a><b></a>")),
  );

  it.effect("opens one xml.decodeTree span per tree decode, on success and on failure", () =>
    Effect.gen(function* spansTree() {
      expect(yield* spanNames(decodeTree()(bg007))).toStrictEqual(["xml.decodeTree"]);
      expect(yield* spanNames(decodeTree()("<a><b></a>"))).toStrictEqual(["xml.decodeTree"]);
    }),
  );

  it.effect("opens one xml.encodeString span per encode", () =>
    Effect.gen(function* spansEncode() {
      const item = yield* decodeString(AssessmentItem)(bg007);

      expect(yield* spanNames(encodeString(AssessmentItem)(item))).toStrictEqual([
        "xml.encodeString",
      ]);
    }),
  );
});

describe("logging", () => {
  it.effect("logs one debug entry with the root local name after a successful decode", () =>
    Effect.gen(function* logsOnce() {
      const entries: { readonly level: string; readonly root: unknown }[] = [];

      const logger = Logger.make<unknown, undefined>((options) => {
        entries.push({
          level: options.logLevel,
          root: options.fiber.getRef(References.CurrentLogAnnotations).root,
        });
      });

      yield* decodeString(AssessmentItem)(bg007).pipe(
        Effect.provideService(References.MinimumLogLevel, "Debug"),
        Effect.provide(Logger.layer([logger])),
      );

      expect(entries).toStrictEqual([{ level: "Debug", root: "qti-assessment-item" }]);
    }),
  );

  it.effect("logs nothing when the decode fails", () =>
    Effect.gen(function* logsNothing() {
      const entries: string[] = [];

      const logger = Logger.make<unknown, undefined>((options) => {
        entries.push(options.logLevel);
      });

      yield* decodeString(AssessmentItem)("<a><b></a>").pipe(
        Effect.flip,
        Effect.provideService(References.MinimumLogLevel, "Debug"),
        Effect.provide(Logger.layer([logger])),
      );

      expect(entries).toStrictEqual([]);
    }),
  );
});

describe("whole-document options", () => {
  const Nested = Element("r", {
    content: elements({ i: Element("i", { content: text(Schema.String) }) }),
  });

  it.effect("fails a document deeper than maxDepth with reason Limit naming maxDepth", () =>
    Effect.gen(function* failsMaxDepth() {
      const decoded = yield* decodeString(Nested)("<r><i>x</i></r>");

      expect(decoded.i.$text).toBe("x");

      const error = yield* decodeString(Nested, { maxDepth: 1 })("<r><i>x</i></r>").pipe(
        Effect.flip,
      );

      expect(error.reason._tag).toBe("Limit");
      expect(error.reason._tag === "Limit" && error.reason.limit).toBe("maxDepth");
    }),
  );

  it.effect("fails a tree with a token longer than maxTokenSize with reason Limit", () =>
    Effect.gen(function* failsMaxTokenSize() {
      const error = yield* decodeTree({ maxTokenSize: 4 })("<r><i>longer-text</i></r>").pipe(
        Effect.flip,
      );

      expect(error.reason._tag).toBe("Limit");
      expect(error.reason._tag === "Limit" && error.reason.limit).toBe("maxTokenSize");
    }),
  );

  it.effect("reports every schema issue under errors all and the first one by default", () =>
    Effect.gen(function* reportsAllIssues() {
      const Pair = Element("r", { attributes: { a: Schema.Int, b: Schema.Int } });
      const xml = '<r a="x" b="x"/>';

      const all = yield* decodeString(Pair)(xml, { errors: "all" }).pipe(Effect.flip);
      const first = yield* decodeString(Pair)(xml).pipe(Effect.flip);

      expect(issueCount(all)).toBeGreaterThanOrEqual(2);
      expect(all.path).toBe("/r/@a");
      expect(issueCount(first)).toBe(1);
    }),
  );

  it.effect("threads the codec's decoding services into the decode's requirements", () =>
    Effect.gen(function* threadsServices() {
      const Svc = Schema.String.pipe(
        Schema.decodeTo(Schema.String, {
          decode: SchemaGetter.transformEffect((s: string) =>
            Effect.gen(function* readUpper() {
              const upper = yield* Upper;

              return upper.f(s);
            }),
          ),
          encode: SchemaGetter.passthrough(),
        }),
      );

      // SAFETY: `element` fixes the decoding services to `never`; the attribute schema reads
      // `Upper`, so the cast states the services the codec actually requires.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- services exist only at the type level.
      const P = Element("p", { attributes: { a: Svc } }) as Element<
        "p",
        { readonly a: string },
        Upper
      >;

      const decoded = decodeString(P)('<p a="hi"/>');

      expectTypeOf<Effect.Services<typeof decoded>>().toEqualTypeOf<Upper>();

      const value = yield* decoded.pipe(
        Effect.provideService(Upper, { f: (s) => s.toUpperCase() }),
      );

      expect(value).toStrictEqual({ a: "HI" });
    }),
  );
});

/**
 * The README definitions: the choice interaction the README decodes and its two child codecs.
 */
const readme = namespaces({ "": QTI });

const ReadmeSimpleChoice = readme.Element("qti-simple-choice", {
  attributes: { identifier: Schema.String },
  content: text(Schema.String),
});

const ReadmePrompt = readme.Element("qti-prompt", { content: text(Schema.String) });

const ReadmeChoiceInteraction = readme.Element("qti-choice-interaction", {
  attributes: { "max-choices": Schema.Int, "response-identifier": Schema.String },
  content: elements({ choices: many(ReadmeSimpleChoice), prompt: optional(ReadmePrompt) }),
});

/**
 * The README document with its `max-choices` value replaced by one `Schema.Int` rejects.
 */
const readmeRejected = `<qti-choice-interaction xmlns="${QTI}" response-identifier="RESPONSE" max-choices="x">
  <qti-prompt>Pick one</qti-prompt>
  <qti-simple-choice identifier="A">First</qti-simple-choice>
  <qti-simple-choice identifier="B">Second</qti-simple-choice>
</qti-choice-interaction>`;

/**
 * Decode {@link readmeRejected} with the README choice interaction expecting a failure.
 *
 * @returns The decode error.
 */
const readmeFailure = () => decodeString(ReadmeChoiceInteraction)(readmeRejected).pipe(Effect.flip);

describe("decodeString native positions", () => {
  it.effect("reads a native tokenizer's start-tag position instead of scanning the text", () =>
    Effect.gen(function* readsNativePosition() {
      const error = yield* readmeFailure().pipe(
        Effect.provideService(Tokenizer, shiftedNativeTokenizer),
      );

      expect(error.reason._tag).toBe("SchemaFailure");
      expect(error.position?.line).toBeGreaterThanOrEqual(1000);
    }),
  );

  it.effect("reports the scanned position when the native positions are honest", () =>
    Effect.gen(function* matchesScannedPosition() {
      const scanned = yield* readmeFailure();

      const native = yield* readmeFailure().pipe(
        Effect.provideService(Tokenizer, honestNativeTokenizer),
      );

      expect(scanned.position).toStrictEqual({ column: 1, line: 1 });
      expect(native.position).toStrictEqual(scanned.position);
    }),
  );
});
