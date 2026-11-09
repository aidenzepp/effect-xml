/* oxlint-disable sort-keys -- slot order is encode order; QTI writes the prompt before the choices. */
import { describe, expect, it } from "@effect/vitest";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Channel from "effect/Channel";
import * as Effect from "effect/Effect";
import * as Xml from "effect/encoding/Xml";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import * as SchemaGetter from "effect/SchemaGetter";

import { decodeString, encodeString } from "../src/codec.ts";
import type { EncodeOptions } from "../src/codec.ts";
import { namespaces } from "../src/dsl.ts";
import type { ResolvedElement } from "../src/element.ts";
import { attemptEncode } from "../src/fast-encode.ts";
import { isEncodeError } from "../src/issue.ts";
import type { XmlEncodeError } from "../src/issue.ts";
import { elements, many, mixed, optional, text } from "../src/plan.ts";
import type { XmlElement } from "../src/plan.ts";
import { Tokenizer, defaultTokenizer } from "../src/tokenizer.ts";
import { corpus } from "./differential/corpus.cases.ts";
import { standardOf } from "./differential/harness.ts";
import { AssessmentItem } from "./qti/vocabulary.ts";

/**
 * An element codec whose schemas need no services, the shape every row runs.
 */
type Def = Schema.Codec<unknown, XmlElement<string>>;

/**
 * Narrow a vocabulary element to the codec the rows run.
 *
 * @param def - A vocabulary element whose schemas require no services.
 * @returns The same codec, typed with an `unknown` Type and no services.
 */
const asDef = (def: Schema.Top): Def =>
  // SAFETY: every vocabulary schema in this file needs no services, and the Encoded side of an
  // element codec is a resolved element.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- services and the Type exist only at the type level.
  def as Def;

/**
 * Encode a value the way "today" does: the public `encodeString` over {@link standardOf} of the
 * root, which runs the compiled element codec alone.
 *
 * The public `encodeString` tries the fast attempt first, so it measures nothing against
 * `attemptEncode`; the annotated root is opaque to the attempt and always takes the fallback.
 *
 * @param def - The root codec.
 * @param options - The encode options.
 * @returns The standard-path encoder.
 */
const todayEncode = (def: Def, options?: EncodeOptions) => encodeString(standardOf(def), options);

/**
 * Decode a text the way "today" does: the public `decodeString` over {@link standardOf} of the
 * root.
 *
 * @param def - The root codec.
 * @returns The standard-path decoder.
 */
const todayDecode = (def: Def) => decodeString(standardOf(def));

/**
 * The README's namespace.
 */
const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

/**
 * The README's builders.
 */
const readme = namespaces({ "": QTI });

/**
 * The README's choice.
 */
const SimpleChoice = readme.Element("qti-simple-choice", {
  attributes: { identifier: Schema.String },
  content: text(Schema.String),
});

/**
 * The README's prompt.
 */
const Prompt = readme.Element("qti-prompt", { content: text(Schema.String) });

/**
 * The README's `ChoiceInteraction` example.
 */
const ChoiceInteraction = readme.Element("qti-choice-interaction", {
  attributes: { "max-choices": Schema.Int, "response-identifier": Schema.String },
  content: elements({
    prompt: optional(Prompt),
    choices: many(SimpleChoice),
  }),
});

/**
 * The README's document.
 */
const readmeXml = `<qti-choice-interaction xmlns="${QTI}" response-identifier="RESPONSE" max-choices="1">
  <qti-prompt>Pick one</qti-prompt>
  <qti-simple-choice identifier="A">First</qti-simple-choice>
  <qti-simple-choice identifier="B">Second</qti-simple-choice>
</qti-choice-interaction>`;

/**
 * The default namespace of the corruption vocabulary.
 */
const A = "urn:effect-xml:fast-encode:a";

/**
 * A second namespace the vocabulary's map binds to the prefix `b`.
 */
const B = "urn:effect-xml:fast-encode:b";

/**
 * A namespace no map binds, so no prefix spells an attribute in it.
 */
const Z = "urn:effect-xml:fast-encode:z";

/**
 * The builders bound to the vocabulary's map.
 */
const ab = namespaces({ "": A, b: B });

/**
 * A declared member of the open mixed content.
 */
const Em = ab.Element("em", { content: text(Schema.String) });

/**
 * Open mixed content over one declared member.
 */
const Para = ab.Element("p", { content: mixed([Em], { open: true }) });

/**
 * The corruption root: a declared `Int` attribute, `data-*` attributes, a structural child with
 * open mixed content, and open `elements` content.
 */
const Doc = asDef(
  ab.Element("doc", {
    attributes: { "data-*": Schema.String, id: Schema.String, size: Schema.Int },
    content: elements({ para: Para }, { open: true }),
  }),
);

/**
 * The model a `decodeTo`-wrapped root decodes to.
 */
interface Label {
  readonly label: string;
}

/**
 * A root wrapped by `decodeTo`: opaque to the fast path, while today's encode accepts its values.
 */
const Wrapped = asDef(
  ab.Element("label", { content: text(Schema.String) }).pipe(
    Schema.decodeTo(Schema.Struct({ label: Schema.String }), {
      decode: SchemaGetter.transform((leaf: { readonly $text: string }) => ({
        label: leaf.$text,
      })),
      encode: SchemaGetter.transform((model: Label) => ({ $text: model.label })),
    }),
  ),
);

/**
 * The defect a dying leaf raises.
 */
const boom = new Error("the leaf encode died");

/**
 * Build a text element whose leaf counts its encode runs and dies on the text `"die"`.
 *
 * Each call builds a fresh schema and counter, so a test reads only its own runs.
 *
 * @returns The element and the number of times its leaf encode has run.
 */
const countingNote = () => {
  const runs = { count: 0 };

  const Leaf = Schema.String.pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transform((raw: string) => raw),
      encode: SchemaGetter.transformEffect((value: string) =>
        Effect.sync(() => {
          runs.count += 1;
        }).pipe(Effect.andThen(value === "die" ? Effect.die(boom) : Effect.succeed(value))),
      ),
    }),
  );

  return { Note: asDef(ab.Element("note", { content: text(Leaf) })), runs };
};

/**
 * Build a tokenizer that counts how often its `encodeString` channel is built and otherwise
 * behaves as the default tokenizer.
 *
 * @param runs - The counter to increment.
 * @param runs.count - The number of channels built so far.
 * @returns The counting tokenizer.
 */
const countingTokenizer = (runs: { count: number }): Tokenizer => ({
  decode: defaultTokenizer.decode,
  decodeString: defaultTokenizer.decodeString,
  encode: defaultTokenizer.encode,
  positions: defaultTokenizer.positions,
  encodeString: <IE = never, Done = unknown>() => {
    runs.count += 1;

    return defaultTokenizer.encodeString<IE, Done>();
  },
});

/**
 * Stringify every attribute value of an event, so a writer that checks attribute types sees only
 * strings.
 *
 * @param event - One event.
 * @returns The event with string attribute values.
 */
const stringifyAttributes = (event: Xml.Event): Xml.Event =>
  event._tag === "StartElement"
    ? {
        ...event,
        attributes: Object.fromEntries(
          Object.entries<unknown>(event.attributes).map(([key, value]) => [
            key,
            Predicate.isString(value) ? value : JSON.stringify(value),
          ]),
        ),
      }
    : event;

/**
 * A tokenizer that writes a non-string attribute value instead of rejecting it, the seam a
 * provided tokenizer opens: only a check before the writer stops such a value from becoming text.
 */
const laxTokenizer: Tokenizer = {
  decode: defaultTokenizer.decode,
  decodeString: defaultTokenizer.decodeString,
  encode: defaultTokenizer.encode,
  positions: defaultTokenizer.positions,
  encodeString: <IE = never, Done = unknown>() =>
    Xml.encodeString<IE, Done>().pipe(
      Channel.mapInput(([head, ...tail]: Arr.NonEmptyReadonlyArray<Xml.Event>) =>
        Effect.succeed(
          Arr.prepend(
            tail.map((event) => stringifyAttributes(event)),
            stringifyAttributes(head),
          ),
        ),
      ),
    ),
};

/**
 * A value both paths encode: a vocabulary's Type, or a deliberate corruption of one past its Type.
 */
interface Value {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the rows corrupt values by key past their Type on purpose; each path checks what it reads.
  readonly [key: string]: unknown;
}

/**
 * Assert that the fast attempt gives `None` and that today's `encodeString` fails with an
 * `XmlEncodeError` on the same value; the attempt neither dies nor fails.
 *
 * @param def - The root codec.
 * @param value - The value both paths encode, often deliberately corrupted past its Type.
 * @param parseOptions - The parse options both paths receive.
 * @returns An effect yielding today's error.
 */
const declines = (def: Def, value: Value, parseOptions?: SchemaAST.ParseOptions) =>
  Effect.gen(function* declinesBoth() {
    const fast = yield* attemptEncode(def)(value, parseOptions);
    const error = yield* Effect.flip(todayEncode(def)(value, parseOptions));

    expect(Option.isNone(fast)).toBe(true);
    expect(isEncodeError(error)).toBe(true);

    return error;
  });

/**
 * Read the reason tag of an encode error.
 *
 * @param error - The error.
 * @returns The tag of its reason.
 */
const reasonOf = (error: XmlEncodeError): string => error.reason._tag;

/**
 * Assert that the fast attempt gives exactly today's text, with `declaration` true and false.
 *
 * @param def - The root codec.
 * @param value - The value both paths encode.
 * @param parseOptions - The parse options both paths receive.
 * @returns An effect yielding the number of comparisons made.
 */
const agrees = (def: Def, value: Value, parseOptions?: SchemaAST.ParseOptions) =>
  Effect.gen(function* agreesBoth() {
    let compared = 0;

    for (const declaration of [true, false]) {
      const fast = yield* attemptEncode(def, { declaration })(value, parseOptions);
      const today = yield* todayEncode(def, { declaration })(value, parseOptions);

      expect(fast).toStrictEqual(Option.some(today));

      compared += 1;
    }

    return compared;
  });

/**
 * Build a resolved element.
 *
 * @param name - The Clark name.
 * @param children - The children.
 * @param attributes - The attributes.
 * @returns The element.
 */
const node = (
  name: string,
  children: readonly (ResolvedElement | string)[] = [],
  attributes: Readonly<Record<string, string>> = {},
): ResolvedElement => ({ attributes, children, name });

/**
 * The README value, as the README's `decodeString` gives it.
 */
const readmeValue = {
  "max-choices": 1,
  "response-identifier": "RESPONSE",
  prompt: { $text: "Pick one" },
  choices: [
    { identifier: "A", $text: "First" },
    { identifier: "B", $text: "Second" },
  ],
};

/**
 * The text of {@link docValue}.
 */
const docXml = `<doc xmlns="${A}" xmlns:b="${B}" id="d1" size="3" data-x="1"><p>a <em>b</em> <z:span xmlns:z="${Z}">c</z:span></p><z:extra xmlns:z="${Z}" k="v"/></doc>`;

/**
 * A well-formed value of {@link Doc}, the base every corruption row edits: a declared member and an
 * undeclared element in the open mixed content, and one undeclared element of open content.
 */
const docValue = {
  id: "d1",
  size: 3,
  "data-x": "1",
  para: {
    $children: [
      { _tag: "$text", text: "a " },
      { _tag: "em", value: { $text: "b" } },
      { _tag: "$text", text: " " },
      { _tag: "*", element: node(`{${Z}}span`, ["c"]) },
    ],
  },
  "*": [node(`{${Z}}extra`, [], { k: "v" })],
};

/**
 * Append one item to the open mixed content of {@link docValue}.
 *
 * @param item - The item to append, often deliberately corrupted.
 * @returns A copy of the value with the item last.
 */
const withItem = (item: Value) => ({
  ...docValue,
  para: { $children: [...docValue.para.$children, item] },
});

/**
 * Replace the open `elements` content of {@link docValue}.
 *
 * @param open - The undeclared elements, possibly corrupted.
 * @returns A copy of the value with `"*"` replaced.
 */
const withOpen = (open: readonly ResolvedElement[]) => ({ ...docValue, "*": open });

describe("attemptEncode", () => {
  it.effect("gives today's text for the README value, with and without an empty $text", () =>
    Effect.gen(function* readmeRows() {
      const def = asDef(ChoiceInteraction);
      const decoded = yield* todayDecode(def)(readmeXml);

      expect(decoded).toStrictEqual(readmeValue);

      const [first, ...rest] = readmeValue.choices;

      const empty = {
        ...readmeValue,
        prompt: { $text: "" },
        choices: [{ ...first, $text: "" }, ...rest],
      };

      const compared = (yield* agrees(def, readmeValue)) + (yield* agrees(def, empty));

      expect(compared).toBe(4);
    }),
  );

  it.effect("gives today's text for every QTI corpus file AssessmentItem decodes", () =>
    Effect.gen(function* corpusRows() {
      const def = asDef(AssessmentItem);
      let compared = 0;

      for (const file of corpus) {
        const decoded = yield* Effect.option(todayDecode(def)(file.text));

        if (Option.isSome(decoded) && Predicate.isReadonlyObject(decoded.value)) {
          compared += yield* agrees(def, decoded.value);
        }
      }

      expect(compared).toBeGreaterThan(0);
    }),
  );

  it.effect("runs a provided tokenizer's encodeString exactly once", () =>
    Effect.gen(function* tokenizerRow() {
      const def = asDef(ChoiceInteraction);
      const runs = { count: 0 };
      const today = yield* todayEncode(def)(readmeValue);

      const fast = yield* attemptEncode(def)(readmeValue).pipe(
        Effect.provideService(Tokenizer, countingTokenizer(runs)),
      );

      expect(fast).toStrictEqual(Option.some(today));
      expect(runs.count).toBe(1);
    }),
  );

  it.effect("gives today's text for the corruption base, which today's decode gives", () =>
    Effect.gen(function* baseRow() {
      expect(yield* todayDecode(Doc)(docXml)).toStrictEqual(docValue);
      expect(yield* agrees(Doc, docValue)).toBe(2);
    }),
  );

  it.effect("declines a value its leaf schema rejects on encode", () =>
    Effect.gen(function* leafRow() {
      const error = yield* declines(Doc, { ...docValue, size: 1.5 });

      expect(reasonOf(error)).toBe("EncodeSchemaFailure");
    }),
  );

  it.effect("declines a value holding U+0000 after its leaf encodes ran once", () =>
    Effect.gen(function* nulRow() {
      const { Note, runs } = countingNote();
      const value = { $text: "a\u0000b" };
      const fast = yield* attemptEncode(Note)(value);

      expect(Option.isNone(fast)).toBe(true);
      expect(runs.count).toBe(1);

      const error = yield* Effect.flip(todayEncode(Note)(value));

      expect(reasonOf(error)).toBe("InvalidEvent");
      expect(runs.count).toBe(2);
    }),
  );

  it.effect("declines an attribute in a namespace no prefix spells", () =>
    Effect.gen(function* unmappedRow() {
      const open = withOpen([node(`{${Z}}extra`, [], { [`{${Z}}k`]: "v" })]);
      const error = yield* declines(Doc, open);

      expect(reasonOf(error)).toBe("UnmappedNamespace");
    }),
  );

  it.effect("declines an open-mixed * item named after a declared member", () =>
    Effect.gen(function* declaredRow() {
      const item = { _tag: "*", element: node(`{${A}}em`, ["x"]) };
      const error = yield* declines(Doc, withItem(item));

      expect(reasonOf(error)).toBe("EncodeSchemaFailure");
    }),
  );

  it.effect("declines, without dying, a * item whose element has a non-element child", () =>
    Effect.gen(function* childRow() {
      const element = { attributes: {}, children: [5], name: `{${Z}}span` };
      const error = yield* declines(Doc, withItem({ _tag: "*", element }));

      expect(reasonOf(error)).toBe("EncodeSchemaFailure");
    }),
  );

  it.effect("declines a * item with a non-string attribute value, under any tokenizer", () =>
    Effect.gen(function* attributeRow() {
      const element = { attributes: { k: 1 }, children: [], name: `{${Z}}span` };
      const corrupt = withItem({ _tag: "*", element });
      const error = yield* declines(Doc, corrupt);

      expect(reasonOf(error)).toBe("EncodeSchemaFailure");

      const lax = yield* attemptEncode(Doc)(corrupt).pipe(
        Effect.provideService(Tokenizer, laxTokenizer),
      );

      expect(Option.isNone(lax)).toBe(true);
    }),
  );

  it.effect("declines invalid XML names that reach the tokenizer", () =>
    Effect.gen(function* namesRow() {
      const corrupt = [
        withOpen([node(`{${Z}}1bad`)]),
        withOpen([node(`{${Z}}extra`, [], { "a b": "v" })]),
        { ...docValue, "data-a b": "v" },
      ];

      const reasons: string[] = [];

      for (const each of corrupt) {
        reasons.push(reasonOf(yield* declines(Doc, each)));
      }

      expect(reasons).toStrictEqual(["InvalidEvent", "InvalidEvent", "InvalidEvent"]);
    }),
  );

  it.effect("declines attributes the writer cannot spell", () =>
    Effect.gen(function* spellRow() {
      const corrupt = [
        withOpen([node(`{${Z}}extra`, [], { xmlns: "v" })]),
        withOpen([node(`{${Z}}extra`, [], { [`{${B}}x`]: "1", "b:x": "2" })]),
      ];

      const reasons: string[] = [];

      for (const each of corrupt) {
        reasons.push(reasonOf(yield* declines(Doc, each)));
      }

      expect(reasons).toStrictEqual(["InvalidEvent", "InvalidEvent"]);
    }),
  );

  it.effect("passes parse options to the structural encode", () =>
    Effect.gen(function* optionsRow() {
      const excess = { ...docValue, extra: 1 };
      const error = yield* declines(Doc, excess, { onExcessProperty: "error" });

      expect(reasonOf(error)).toBe("EncodeSchemaFailure");
      expect(yield* agrees(Doc, excess)).toBe(2);
    }),
  );

  it.effect("declines a decodeTo-wrapped root, which today's encode accepts", () =>
    Effect.gen(function* opaqueRow() {
      const value: Label = { label: "x" };
      const fast = yield* attemptEncode(Wrapped)(value);
      const today = yield* todayEncode(Wrapped)(value);

      expect(Option.isNone(fast)).toBe(true);
      expect(today).toContain("<label");
    }),
  );

  it.effect("dies with the leaf's defect when a leaf encode dies, after one run", () =>
    Effect.gen(function* dieRow() {
      const { Note, runs } = countingNote();
      const exit = yield* Effect.exit(attemptEncode(Note)({ $text: "die" }));

      expect(Exit.isFailure(exit)).toBe(true);

      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true);
        expect(Cause.squash(exit.cause)).toBe(boom);
      }

      expect(runs.count).toBe(1);
    }),
  );
});
