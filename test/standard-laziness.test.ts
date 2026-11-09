/* oxlint-disable sort-keys -- slot order is decode order; QTI reads the prompt before the choices. */
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Tracer from "effect/Tracer";

import { decodeString, encodeString } from "../src/codec.ts";
import { XmlSchema } from "../src/index.ts";

/**
 * The README's namespace.
 */
const QTI = "http://www.imsglobal.org/xsd/imsqtiasi_v3p0";

/**
 * The README's document.
 */
const xml = `<qti-choice-interaction xmlns="${QTI}" response-identifier="RESPONSE" max-choices="1">
  <qti-prompt>Pick one</qti-prompt>
  <qti-simple-choice identifier="A">First</qti-simple-choice>
  <qti-simple-choice identifier="B">Second</qti-simple-choice>
</qti-choice-interaction>`;

/**
 * The README's document with an undeclared attribute on its last choice, a shape the builder
 * refuses after the prompt, so today's decode runs the prompt leaf before it rejects the choice.
 */
const refused = xml.replace('identifier="B"', 'identifier="B" weight="2"');

/**
 * The README's value.
 */
const value = {
  "max-choices": 1,
  "response-identifier": "RESPONSE",
  prompt: { $text: "Pick one" },
  choices: [
    { identifier: "A", $text: "First" },
    { identifier: "B", $text: "Second" },
  ],
};

/**
 * The entry in a {@link Journal} for one run of the prompt leaf.
 */
const LEAF = "leaf";

/**
 * The entry in a {@link Journal} for the decode or encode entering its standard fallback.
 */
const FALLBACK = "fallback";

/**
 * One row's ordered record of prompt-leaf runs and fallback entries, with the codec and tracer
 * that write to it.
 */
interface Journal {
  readonly entries: string[];
  readonly root: ReturnType<typeof interaction>;
  readonly tracer: Tracer.Tracer;
}

/**
 * Build the README's `ChoiceInteraction` around the given prompt text leaf.
 *
 * @param prompt - The text leaf of the prompt.
 * @returns The root element codec.
 */
const interaction = (prompt: Schema.Codec<string, string>) => {
  const { Element } = XmlSchema.namespaces({ "": QTI });

  const SimpleChoice = Element("qti-simple-choice", {
    attributes: { identifier: Schema.String },
    content: XmlSchema.text(Schema.String),
  });

  return Element("qti-choice-interaction", {
    attributes: { "max-choices": Schema.Int, "response-identifier": Schema.String },
    content: XmlSchema.elements({
      prompt: XmlSchema.optionalKey(Element("qti-prompt", { content: XmlSchema.text(prompt) })),
      choices: XmlSchema.Array(SimpleChoice),
    }),
  });
};

/**
 * Build a fresh journal whose prompt leaf records each run and accepts or rejects by `accept`.
 *
 * The leaf answers with an already-finished `Effect.succeed` or `Effect.fail`, so Effect's parser
 * runs it the moment the parser is called; a run before the attempt therefore shows in the
 * journal ahead of the fallback entry. The tracer records the fallback entry when the span
 * receives `xml.codec` set to `"fallback"`.
 *
 * @param accept - Whether each leaf run succeeds.
 * @returns The journal, its root codec, and its tracer.
 */
const journal = (accept: boolean): Journal => {
  const entries: string[] = [];

  /**
   * Record one leaf run and answer it.
   *
   * @param text - The text the leaf receives.
   * @returns The text, or an issue when the journal's leaf rejects.
   */
  const run = (text: string) => {
    entries.push(LEAF);

    return accept
      ? Effect.succeed(text)
      : Effect.fail(new SchemaIssue.InvalidValue({ message: "the prompt leaf rejects" }, text));
  };

  const leaf = Schema.String.pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transformEffect(run),
      encode: SchemaGetter.transformEffect(run),
    }),
  );

  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      const attribute = span.attribute.bind(span);

      span.attribute = (key, attributeValue) => {
        if (key === "xml.codec" && attributeValue === FALLBACK) {
          entries.push(FALLBACK);
        }

        attribute(key, attributeValue);
      };

      return span;
    },
  });

  return { entries, root: interaction(leaf), tracer };
};

/**
 * One public entry point the rows run through: the codec factory itself or `fromString`.
 */
interface Entry {
  readonly name: string;
  readonly decode: (journal: Journal, text: string) => Effect.Effect<unknown, unknown>;
  readonly encode: (journal: Journal) => Effect.Effect<unknown, unknown>;
}

/**
 * The entry points that share the fast-path attempt and its standard fallback.
 */
const entries: readonly Entry[] = [
  {
    name: "decodeString and encodeString",
    decode: ({ root }, text) => decodeString(root)(text),
    encode: ({ root }) => encodeString(root)(value),
  },
  {
    name: "fromString",
    decode: ({ root }, text) => Schema.decodeUnknownEffect(XmlSchema.fromString(root))(text),
    encode: ({ root }) => Schema.encodeUnknownEffect(XmlSchema.fromString(root))(value),
  },
];

/**
 * Run `effect` under the journal's tracer and return its exit.
 *
 * @param log - The row's journal.
 * @param effect - The decode or encode.
 * @returns The exit of `effect`.
 */
const recorded = <A, E>(log: Journal, effect: Effect.Effect<A, E>) =>
  Effect.exit(effect.pipe(Effect.withTracer(log.tracer)));

for (const entry of entries) {
  describe(`standard path laziness through ${entry.name}`, () => {
    it.effect("runs the leaf once on a successful fast decode", () =>
      Effect.gen(function* fastDecode() {
        const log = journal(true);
        const exit = yield* recorded(log, entry.decode(log, xml));

        expect(Exit.isSuccess(exit)).toBe(true);
        expect(log.entries).toStrictEqual([LEAF]);
      }),
    );

    it.effect("runs the leaf once on a successful fast encode", () =>
      Effect.gen(function* fastEncode() {
        const log = journal(true);
        const exit = yield* recorded(log, entry.encode(log));

        expect(Exit.isSuccess(exit)).toBe(true);
        expect(log.entries).toStrictEqual([LEAF]);
      }),
    );

    it.effect("runs the leaf only in the fallback when the builder refuses the document", () =>
      Effect.gen(function* refusedDecode() {
        const log = journal(true);
        const exit = yield* recorded(log, entry.decode(log, refused));

        expect(Exit.isFailure(exit)).toBe(true);
        expect(log.entries).toStrictEqual([FALLBACK, LEAF]);
      }),
    );

    it.effect("runs the leaf once on each path when the structural codec fails", () =>
      Effect.gen(function* schemaFailure() {
        const log = journal(false);
        const exit = yield* recorded(log, entry.decode(log, xml));

        expect(Exit.isFailure(exit)).toBe(true);
        expect(log.entries).toStrictEqual([LEAF, FALLBACK, LEAF]);
      }),
    );

    it.effect("runs the leaf once on each path when the structural encode fails", () =>
      Effect.gen(function* schemaEncodeFailure() {
        const log = journal(false);
        const exit = yield* recorded(log, entry.encode(log));

        expect(Exit.isFailure(exit)).toBe(true);
        expect(log.entries).toStrictEqual([LEAF, FALLBACK, LEAF]);
      }),
    );
  });
}
