/**
 * An element whose mixed content lists two members under one wire tag or one Clark name (a
 * collision group) decodes and encodes the standard way. The compiled union picks a group's member
 * by an exact match under `oneOf`: an encoded value goes to the one member whose type side accepts
 * it with no excess key, and a value or document more than one member accepts fails. The faster
 * path selects a member by name or wire alone, so it never sees such an element: the ambiguous root
 * reports `xml.codec` `"element"`, and an ambiguous element in a structural parent's slot leaves
 * the parent structural.
 *
 * Each row pins its `decodeString` outcome and its encoded text as literals. `fromString` and
 * `decodeSchemaString` with positions off and on decode a row's document as `decodeString` does,
 * and `encodeString` and `fromString` both write the pinned text. The rows after them pin the
 * failures inside a group and the stripping of an excess key outside one.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Tracer from "effect/Tracer";

import { decodeString, encodeString } from "../src/codec.ts";
import { XmlSchema as SrcXml } from "../src/index.ts";
import {
  channelDecode,
  decodeErrorSummary,
  documentDecode,
  documentEncode,
  src,
  valueSummary,
} from "./differential/harness.ts";
import type { ChannelOutcome } from "./differential/harness.ts";

/**
 * A root or record definition: an element codec with no services.
 */
type SrcRoot = Schema.Codec<unknown, SrcXml.XmlElement<string>>;

/**
 * The namespace of the first `p` member.
 */
const A = "urn:a";

/**
 * The namespace of the second `p` member.
 */
const B = "urn:b";

/**
 * The definitions the rows decode and encode with.
 */
interface Vocabulary {
  readonly wire: SrcRoot;
  readonly wireRequired: SrcRoot;
  readonly clark: SrcRoot;
  readonly control: SrcRoot;
  readonly holder: SrcRoot;
  readonly holderRequired: SrcRoot;
}

/**
 * The ambiguity vocabulary.
 *
 * `wire` lists `p` in `urn:a` with an optional `x` and `p` in `urn:b` with a required `y`: one wire
 * tag, two Clark names. `wireRequired` is the same pair with `x` required. `clark` lists `q` twice,
 * with an optional `x` and with a required `y`: one Clark name. `control` lists two members with
 * distinct names. `holder` is a structural parent whose `body` slot is the ambiguous `wire` element
 * beside an unambiguous `note` slot, and `holderRequired` is the same parent around
 * `wireRequired`. With `x` optional, the `urn:a` member's structural codec accepts the `urn:b`
 * document, so a selection by wire tag alone decodes another value than the compiled union; with
 * `x` required it rejects that document and only the encode differs.
 */
const srcRoots: Vocabulary = (() => {
  const InA = SrcXml.namespaces({ "": A });
  const InB = SrcXml.namespaces({ "": B });
  const PB = InB.Element("p", { attributes: { y: Schema.String } });
  const Q2 = SrcXml.Element("q", { attributes: { y: Schema.String } });
  const Em = SrcXml.Element("em", { content: SrcXml.text(Schema.String) });

  const WireRequired = SrcXml.Element("r", {
    content: SrcXml.mixed([InA.Element("p", { attributes: { x: Schema.String } }), PB]),
  });

  const Wire = SrcXml.Element("r", {
    content: SrcXml.mixed([
      InA.Element("p", { attributes: { x: Schema.optionalKey(Schema.String) } }),
      PB,
    ]),
  });

  return {
    clark: SrcXml.Element("r", {
      content: SrcXml.mixed([
        SrcXml.Element("q", { attributes: { x: Schema.optionalKey(Schema.String) } }),
        Q2,
      ]),
    }),
    control: SrcXml.Element("r", { content: SrcXml.mixed([Em, Q2]) }),
    holder: SrcXml.Element("holder", {
      content: SrcXml.elements({ body: Wire, note: Em }),
    }),
    holderRequired: SrcXml.Element("holder", {
      content: SrcXml.elements({ body: WireRequired, note: Em }),
    }),
    wire: Wire,
    wireRequired: WireRequired,
  };
})();

/**
 * The `decodeString` outcome a row pins: the decoded value, or the decode error's `_tag`, reason
 * `_tag`, and path.
 */
type Decoded =
  | { readonly value: unknown }
  | { readonly error: { readonly _tag: string; readonly reason: string; readonly path: string } };

/**
 * One row: the definition, a document it decodes and that document's `decodeString` outcome, a
 * value it encodes and the text after the XML declaration that value encodes to, and the
 * `xml.codec` the `decodeString` and `encodeString` spans report.
 */
interface Row {
  readonly title: string;
  readonly root: keyof Vocabulary;
  readonly text: string;
  readonly decoded: Decoded;
  readonly value: unknown;
  readonly encoded: string;
  readonly codec: "structural" | "element";
}

/**
 * The XML declaration every encoded document leads with.
 */
const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';

/**
 * The rows: one wire tag under two namespaces, one Clark name twice, an unambiguous control, and
 * the ambiguous element nested in a structural parent's slot.
 */
const rows: readonly Row[] = [
  {
    codec: "element",
    decoded: {
      value: {
        $children: [
          { _tag: "$text", text: "a" },
          { _tag: "p", value: { y: "1" } },
          { _tag: "$text", text: "b" },
        ],
      },
    },
    encoded: `<r><p xmlns="${B}" y="1"></p></r>`,
    root: "wire",
    text: `<r>a<p xmlns="${B}" y="1"/>b</r>`,
    title: "one wire tag in two namespaces",
    value: { $children: [{ _tag: "p", value: { y: "1" } }] },
  },
  {
    codec: "element",
    decoded: { error: { _tag: "XmlDecodeError", path: "/r/p", reason: "SchemaFailure" } },
    encoded: `<r><p xmlns="${A}"></p></r>`,
    root: "wire",
    text: `<r><p xmlns="${B}"/></r>`,
    title: "one wire tag in two namespaces, the attributes left out",
    value: { $children: [{ _tag: "p", value: {} }] },
  },
  {
    codec: "element",
    decoded: { value: { $children: [{ _tag: "p", value: { y: "1" } }] } },
    encoded: `<r><p xmlns="${B}" y="1"></p></r>`,
    root: "wireRequired",
    text: `<r><p xmlns="${B}" y="1"/></r>`,
    title: "one wire tag in two namespaces, each attribute required",
    value: { $children: [{ _tag: "p", value: { y: "1" } }] },
  },
  {
    codec: "element",
    decoded: {
      value: {
        $children: [
          { _tag: "$text", text: "a" },
          { _tag: "q", value: { y: "1" } },
          { _tag: "$text", text: "b" },
        ],
      },
    },
    encoded: '<r><q y="1"></q></r>',
    root: "clark",
    text: '<r>a<q y="1"/>b</r>',
    title: "one Clark name twice",
    value: { $children: [{ _tag: "q", value: { y: "1" } }] },
  },
  {
    codec: "structural",
    decoded: {
      value: {
        $children: [
          { _tag: "$text", text: "a" },
          { _tag: "q", value: { y: "1" } },
          { _tag: "em", value: { $text: "e" } },
          { _tag: "$text", text: "b" },
        ],
      },
    },
    encoded: '<r>a<q y="1"></q><em>e</em></r>',
    root: "control",
    text: '<r>a<q y="1"/><em>e</em>b</r>',
    title: "an unambiguous control",
    value: {
      $children: [
        { _tag: "$text", text: "a" },
        { _tag: "q", value: { y: "1" } },
        { _tag: "em", value: { $text: "e" } },
      ],
    },
  },
  {
    codec: "structural",
    decoded: {
      value: {
        body: { $children: [{ _tag: "p", value: { y: "1" } }] },
        note: { $text: "n" },
      },
    },
    encoded: `<holder><r><p xmlns="${B}" y="1"></p></r><em>n</em></holder>`,
    root: "holder",
    text: `<holder><r><p xmlns="${B}" y="1"/></r><em>n</em></holder>`,
    title: "an ambiguous slot in a structural parent",
    value: {
      body: { $children: [{ _tag: "p", value: { y: "1" } }] },
      note: { $text: "n" },
    },
  },
  {
    codec: "structural",
    decoded: {
      value: {
        body: { $children: [{ _tag: "p", value: { y: "1" } }] },
        note: { $text: "n" },
      },
    },
    encoded: `<holder><r><p xmlns="${B}" y="1"></p></r><em>n</em></holder>`,
    root: "holderRequired",
    text: `<holder><r><p xmlns="${B}" y="1"/></r><em>n</em></holder>`,
    title: "an ambiguous slot in a structural parent, each attribute required",
    value: {
      body: { $children: [{ _tag: "p", value: { y: "1" } }] },
      note: { $text: "n" },
    },
  },
];

/**
 * Run an effect under a recording tracer and read the attributes the one span named `name` ended
 * with.
 *
 * @param name - The span to read.
 * @param effect - The effect to run.
 * @returns The effect's value and the span's attributes.
 */
const traced = <A, E>(name: string, effect: Effect.Effect<A, E>) =>
  Effect.gen(function* record() {
    const spans: { readonly name: string; readonly attributes: Map<string, unknown> }[] = [];

    const tracer = Tracer.make({
      span: (options) => {
        const attributes = new Map<string, unknown>();
        const span = new Tracer.NativeSpan(options);
        const attribute = span.attribute.bind(span);

        spans.push({ attributes, name: options.name });

        span.attribute = (key, value) => {
          attributes.set(key, value);
          attribute(key, value);
        };

        return span;
      },
    });

    const value = yield* Effect.withTracer(effect, tracer);
    const named = spans.filter((span) => span.name === name);

    expect(named).toHaveLength(1);

    return { attributes: named[0]?.attributes ?? new Map<string, unknown>(), value };
  });

/**
 * Wrap a row's document in a `bank` root, so a record channel reads the row's root as its one
 * record under the path `bank`, then the root's name.
 *
 * @param row - The row.
 * @returns The wrapped text and the record path.
 */
const banked = (row: Row) => ({
  path: ["bank", row.root === "holder" || row.root === "holderRequired" ? "holder" : "r"],
  text: `<bank>${row.text}</bank>`,
});

/**
 * Write a `decodeString` run as the outcome a row pins.
 *
 * @param exit - The run's exit.
 * @returns The decoded value, the error's tags and path, or `undefined` for a defect or an
 *   interruption.
 */
const decodedOf = (exit: Exit.Exit<unknown, SrcXml.DecodeError>): Decoded | undefined =>
  Exit.isSuccess(exit)
    ? { value: exit.value }
    : Cause.findErrorOption(exit.cause).pipe(
        Option.map((error) => ({
          error: { _tag: error._tag, path: error.path, reason: error.reason._tag },
        })),
        Option.getOrUndefined,
      );

/**
 * Write a `decodeString` run as the outcome a `fromString` decode of the same text reports.
 *
 * A success is the same value. A failure is the outer Schema error carrying the decode error, whose
 * tree is one `Encoding` step ending at the `fromString` codec's type side, a passthrough
 * `Declaration`.
 *
 * @param exit - The `decodeString` run's exit.
 * @returns The `fromString` outcome summary, or `undefined` for a defect or an interruption.
 */
const documentOutcomeOf = (exit: Exit.Exit<unknown, SrcXml.DecodeError>) =>
  Exit.isSuccess(exit)
    ? valueSummary(exit.value)
    : Cause.findErrorOption(exit.cause).pipe(
        Option.map((error) => ({
          schema: { message: error.message, tree: "Encoding<Declaration>(InvalidValue)" },
          xml: decodeErrorSummary(error),
        })),
        Option.getOrUndefined,
      );

/**
 * Write a channel run, or the `decodeString` run of the same record, as the parts both report
 * alike: the records, and an error end's `_tag`, path, and reason.
 *
 * A record's error names its record and its position in the bank document, so the message, the
 * position, and the record index differ from the `decodeString` error by design.
 *
 * @param outcome - The channel's outcome.
 * @returns The comparable outcome.
 */
const sharedChannelOutcome = (outcome: ChannelOutcome) => ({
  end:
    outcome.end === "done" || "defect" in outcome.end
      ? outcome.end
      : { _tag: outcome.end._tag, path: outcome.end.path, reason: outcome.end.reason },
  records: outcome.records,
});

/**
 * Write a `decodeString` run as the channel outcome of the same document as a bank's one record.
 *
 * @param exit - The `decodeString` run's exit.
 * @returns The comparable channel outcome, or `undefined` for a defect or an interruption.
 */
const channelOutcomeOf = (exit: Exit.Exit<unknown, SrcXml.DecodeError>) =>
  Exit.isSuccess(exit)
    ? sharedChannelOutcome({ end: "done", records: [valueSummary(exit.value)] })
    : Cause.findErrorOption(exit.cause).pipe(
        Option.map((error) =>
          sharedChannelOutcome({ end: decodeErrorSummary(error), records: [] }),
        ),
        Option.getOrUndefined,
      );

/**
 * The positions settings every channel row runs under.
 */
const positionSettings: readonly boolean[] = [false, true];

describe("ambiguous mixed members", () => {
  it.effect.each(rows)("decodes $title through fromString as decodeString does", (row) =>
    Effect.gen(function* viaFromString() {
      const documented = yield* Effect.exit(decodeString(srcRoots[row.root])(row.text));

      const { attributes, value } = yield* traced(
        "xml.decodeString",
        documentDecode(src, SrcXml.fromString(srcRoots[row.root]), row.text),
      );

      expect(value).toStrictEqual(documentOutcomeOf(documented));
      expect(attributes.get("xml.codec")).toBe(row.codec);
    }),
  );

  it.effect.each(rows)("decodes $title through decodeString", (row) =>
    Effect.gen(function* viaDecodeString() {
      const actual = yield* Effect.exit(decodeString(srcRoots[row.root])(row.text));

      expect(decodedOf(actual)).toStrictEqual(row.decoded);
    }),
  );

  it.effect.each(
    rows.flatMap((row) => positionSettings.map((positions) => ({ ...row, positions }))),
  )(
    "decodes $title through decodeSchemaString with positions $positions as decodeString does",
    (row) =>
      Effect.gen(function* viaChannel() {
        const { path, text } = banked(row);
        const expected = yield* Effect.exit(decodeString(srcRoots[row.root])(row.text));

        const actual = yield* channelDecode(
          SrcXml.decodeSchemaString(srcRoots[row.root], path),
          Stream.make(text),
          { positions: row.positions },
        );

        expect(sharedChannelOutcome(actual)).toStrictEqual(channelOutcomeOf(expected));
      }),
  );

  it.effect.each(rows)("encodes $title through encodeString", (row) =>
    Effect.gen(function* viaEncodeString() {
      const { attributes, value } = yield* traced(
        "xml.encodeString",
        Effect.exit(encodeString(srcRoots[row.root])(row.value)),
      );

      expect(value).toStrictEqual(Exit.succeed(`${DECLARATION}${row.encoded}`));
      expect(attributes.get("xml.codec")).toBe(row.codec);
    }),
  );

  it.effect.each(rows)("encodes $title through fromString", (row) =>
    Effect.gen(function* viaFromStringEncode() {
      const actual = yield* documentEncode(src, SrcXml.fromString(srcRoots[row.root]), row.value);

      expect(actual).toStrictEqual({ text: `${DECLARATION}${row.encoded}` });
    }),
  );
});

/**
 * The `src` definitions only the collision-group rows use: `twin` lists `p` in `urn:a` and `p` in
 * `urn:b`, each with an optional attribute of its own, so the empty value fits both; `duplicate`
 * lists `q` twice the same way, so a bare `<q/>` decodes with both. `triple` lists `q` three times,
 * the middle member with a required `w`, so a bare `<q/>` and the empty value fit the first and
 * the third member only. `suspended` is `twin` with its `urn:b` member written through `suspend`,
 * which the compiled union tries after every named member.
 */
const groups: {
  readonly duplicate: SrcRoot;
  readonly suspended: SrcRoot;
  readonly triple: SrcRoot;
  readonly twin: SrcRoot;
} = (() => {
  const InA = SrcXml.namespaces({ "": A });
  const InB = SrcXml.namespaces({ "": B });
  const PZ = InB.Element("p", { attributes: { z: Schema.optionalKey(Schema.String) } });

  return {
    duplicate: SrcXml.Element("r", {
      content: SrcXml.mixed([
        SrcXml.Element("q", { attributes: { x: Schema.optionalKey(Schema.String) } }),
        SrcXml.Element("q", { attributes: { z: Schema.optionalKey(Schema.String) } }),
      ]),
    }),
    suspended: SrcXml.Element("r", {
      content: SrcXml.mixed([
        InA.Element("p", { attributes: { x: Schema.optionalKey(Schema.String) } }),
        InB.suspend("p", () => PZ),
      ]),
    }),
    triple: SrcXml.Element("r", {
      content: SrcXml.mixed([
        SrcXml.Element("q", { attributes: { x: Schema.optionalKey(Schema.String) } }),
        SrcXml.Element("q", { attributes: { w: Schema.String } }),
        SrcXml.Element("q", { attributes: { z: Schema.optionalKey(Schema.String) } }),
      ]),
    }),
    twin: SrcXml.Element("r", {
      content: SrcXml.mixed([
        InA.Element("p", { attributes: { x: Schema.optionalKey(Schema.String) } }),
        InB.Element("p", { attributes: { z: Schema.optionalKey(Schema.String) } }),
      ]),
    }),
  };
})();

/**
 * The message of an encode an item of `twin` fits under both members.
 */
const AMBIGUOUS_VALUE =
  "the value of element 0 at /r/0: the item matches more than one member of the mixed content of <r>: <p> in urn:a (member 1), <p> in urn:b (member 2); exactly one must match. Give the value a key only one of these members declares, or give the members distinct names.";

describe("collision groups", () => {
  it.effect("fails an excess key inside a group instead of dropping it", () =>
    Effect.gen(function* excessInGroup() {
      const value = { $children: [{ _tag: "p", value: { junk: "2", y: "1" } }] };
      const error = yield* Effect.flip(encodeString(srcRoots.wire)(value));
      const document = yield* documentEncode(src, SrcXml.fromString(srcRoots.wire), value);

      expect({ message: error.message, path: error.path }).toStrictEqual({
        message:
          "the value of element 0 at /r/0: the item matches no member of the mixed content of <r> exactly: <p> in urn:a (member 1) rejects it (junk: Expected no excess property), <p> in urn:b (member 2) rejects it (junk: Expected no excess property). Members that share a tag keep every key of the value, so remove the keys the intended member does not declare.",
        path: "/r/0",
      });

      expect(document).toMatchObject({ xml: { message: error.message, path: error.path } });
    }),
  );

  it.effect("fails a value two members of a group accept with the exactly-one error", () =>
    Effect.gen(function* ambiguousValue() {
      const value = { $children: [{ _tag: "p", value: {} }] };
      const error = yield* Effect.flip(encodeString(groups.twin)(value));
      const document = yield* documentEncode(src, SrcXml.fromString(groups.twin), value);

      expect({ message: error.message, path: error.path }).toStrictEqual({
        message: AMBIGUOUS_VALUE,
        path: "/r/0",
      });

      expect(document).toMatchObject({ xml: { message: AMBIGUOUS_VALUE } });
    }),
  );

  it.effect("fails a document two Clark-duplicate members both decode", () =>
    Effect.gen(function* duplicateDocument() {
      const error = yield* Effect.flip(decodeString(groups.duplicate)("<r>a<q/></r>"));

      expect({ message: error.message, path: error.path }).toStrictEqual({
        message:
          "element q at /r/q (line 1, column 5): the item matches more than one member of the mixed content of <r>: <q> in no namespace (member 1), <q> in no namespace (member 2); exactly one must match. Give the element an attribute or child only one of these members declares, or declare one member for <q> in <r>.",
        path: "/r/q",
      });
    }),
  );

  it.effect("states the type repair when a group member rejects a key's type", () =>
    Effect.gen(function* wrongType() {
      const value = { $children: [{ _tag: "p", value: { y: 1 } }] };
      const error = yield* Effect.flip(encodeString(srcRoots.wire)(value));

      expect(error.message).toBe(
        "the value of element 0 at /r/0: the item matches no member of the mixed content of <r> exactly: <p> in urn:a (member 1) rejects it (y: Expected no excess property), <p> in urn:b (member 2) rejects it (y: Expected string). Members that share a tag keep every key of the value, so remove the keys the intended member does not declare and give each key a value the intended member accepts.",
      );
    }),
  );

  it.effect("names the intended member in the missing-key repair", () =>
    Effect.gen(function* missingKey() {
      const value = { $children: [{ _tag: "p", value: {} }] };
      const error = yield* Effect.flip(encodeString(srcRoots.wireRequired)(value));

      expect(error.message).toBe(
        "the value of element 0 at /r/0: the item matches no member of the mixed content of <r> exactly: <p> in urn:a (member 1) rejects it (x: Missing key), <p> in urn:b (member 2) rejects it (y: Missing key). Add the keys the intended member requires.",
      );
    }),
  );

  it.effect("names the two of three Clark-duplicate members that decode a document", () =>
    Effect.gen(function* tripleDocument() {
      const error = yield* Effect.flip(decodeString(groups.triple)("<r><q/></r>"));

      expect({ message: error.message, path: error.path }).toStrictEqual({
        message:
          "element q at /r/q (line 1, column 4): the item matches more than one member of the mixed content of <r>: <q> in no namespace (member 1), <q> in no namespace (member 3); exactly one must match. Give the element an attribute or child only one of these members declares, or declare one member for <q> in <r>.",
        path: "/r/q",
      });
    }),
  );

  it.effect("names the two of three Clark-duplicate members that accept a value", () =>
    Effect.gen(function* tripleValue() {
      const value = { $children: [{ _tag: "q", value: {} }] };
      const error = yield* Effect.flip(encodeString(groups.triple)(value));

      expect(error.message).toBe(
        "the value of element 0 at /r/0: the item matches more than one member of the mixed content of <r>: <q> in no namespace (member 1), <q> in no namespace (member 3); exactly one must match. Give the value a key only one of these members declares, or give the members distinct names.",
      );
    }),
  );

  it.effect("states the group failure on encode when a group member is a suspend", () =>
    Effect.gen(function* suspendedValue() {
      const ambiguous = yield* Effect.flip(
        encodeString(groups.suspended)({ $children: [{ _tag: "p", value: {} }] }),
      );

      const excess = yield* Effect.flip(
        encodeString(groups.suspended)({ $children: [{ _tag: "p", value: { junk: "1" } }] }),
      );

      expect([ambiguous.message, excess.message]).toStrictEqual([
        AMBIGUOUS_VALUE,
        "the value of element 0 at /r/0: the item matches no member of the mixed content of <r> exactly: <p> in urn:a (member 1) rejects it (junk: Expected no excess property), <p> in urn:b (member 2) rejects it (junk: Expected no excess property). Members that share a tag keep every key of the value, so remove the keys the intended member does not declare.",
      ]);
    }),
  );

  it.effect("still strips an excess key outside a group", () =>
    Effect.gen(function* excessOutsideGroup() {
      const value = { $children: [{ _tag: "q", value: { junk: "2", y: "1" } }] };
      const actual = yield* Effect.exit(encodeString(srcRoots.control)(value));

      expect(actual).toStrictEqual(Exit.succeed(`${DECLARATION}<r><q y="1"></q></r>`));
    }),
  );
});
